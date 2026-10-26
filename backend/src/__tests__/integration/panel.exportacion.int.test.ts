/**
 * I-27 · Panel del cliente, panel del owner y exportación de datos — T12, Sprint 9 continuación
 *
 * Componentes: Express (app.ts) → /api/empresas/:id/{panel,exportar}, /api/planes/uso → planes.controller + services/{suscripciones,facturacion,exportacion} →
 *   Postgres real (y un lector ZIP independiente en la prueba).
 * Resultado esperado:
 *   - el panel de una empresa trae plan, consumo vs incluido, proyección, límites y facturas; el admin solo ve el de la suya (cruce = 404);
 *   - el panel del owner lista todas las empresas con plan, estado, consumo y lo que deben;
 *   - la exportación es un .zip válido con los datos de ESA empresa y nada de otra, sin secretos, con fórmulas neutralizadas, auditada y con tope de tasa;
 *   - owner y admin de esa empresa pueden exportar; sucursal, residente y el admin de otra empresa no.
 */
import request from 'supertest';
import { randomUUID, randomBytes } from 'crypto';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer, PASSWORD } from '../helpers/auth';
import { leerZip, comoBuffer } from '../helpers/leerZip';

let fx: Fixtures;
const token: Record<string, string> = {};
const uid = () => randomUUID().slice(0, 8);
const as = (k: string) => bearer(token[k]);

beforeAll(async () => {
  fx = await sembrar();
  for (const k of ['owner', 'adminEmpA', 'adminEmpB', 'adminSucA1', 'resA1']) token[k] = (await login(app, fx.email[k])).token!;
});
afterAll(cerrarPool);

const planNuevo = async (extra: Record<string, unknown> = {}) =>
  (await request(app).post('/api/planes').set(as('owner')).send({
    codigo: `pan-${uid()}`, nombre: 'Plan PAN', precio_mensual_centavos: 20000, visitas_incluidas: 10, precio_visita_extra_centavos: 100, ...extra,
  })).body as { id: string; codigo: string };
const visitante = async (nombre = 'PAN visitante') =>
  (await uno<{ id: string }>(`INSERT INTO visitantes (nombre, numero_dpi) VALUES ($1, $2) RETURNING id`, [nombre, `PAN-${randomUUID()}`.slice(0, 20)]))!.id;
const visita = async (sucursal: string, residente: string, agente: string, cuando: string, nombre?: string, autorizado = true) =>
  q(`INSERT INTO registros_acceso (sucursal_id, visitante_id, residente_id, agente_id, tipo, timestamp_entrada, autorizado) VALUES ($1, $2, $3, $4, 'entrada', $5::timestamptz, $6)`,
    [sucursal, await visitante(nombre), residente, agente, cuando, autorizado]);
const descargar = (k: string, empresaId: string) =>
  request(app).get(`/api/empresas/${empresaId}/exportar`).set(as(k)).buffer(true).parse(comoBuffer);

describe('I-27 panel del cliente', () => {
  it('trae plan, consumo del mes, proyección, límites y facturas de SU empresa', async () => {
    const plan = await planNuevo({ visitas_incluidas: 4, precio_visita_extra_centavos: 100, max_sucursales: 5, max_garitas: 3 });
    await request(app).put(`/api/empresas/${fx.empresas.A}/suscripcion`).set(as('owner')).send({ plan_id: plan.id, estado: 'activa' });
    const hoy = await uno<{ d: number; n: number }>(`SELECT EXTRACT(DAY FROM NOW() AT TIME ZONE 'America/Guatemala')::int AS d, EXTRACT(DAY FROM (date_trunc('month', NOW() AT TIME ZONE 'America/Guatemala') + interval '1 month - 1 day'))::int AS n`);
    for (let i = 0; i < 3; i++) await visita(fx.sucursales.A1, fx.residentes.A1, fx.usuarios.agenteA1, new Date().toISOString());
    await visita(fx.sucursales.A1, fx.residentes.A1, fx.usuarios.agenteA1, new Date().toISOString(), 'PAN rechazado', false);   // rechazada: no cuenta

    const r = await request(app).get(`/api/empresas/${fx.empresas.A}/panel`).set(as('adminEmpA'));
    expect(r.status).toBe(200);
    expect(r.body.empresa.id).toBe(fx.empresas.A);
    expect(r.body.suscripcion).toMatchObject({ estado: 'activa', plan: { codigo: plan.codigo, visitas_incluidas: 4 } });
    expect(r.body.uso).toMatchObject({ visitas: 3, incluidas: 4, excedente: 0, dia_del_mes: hoy!.d, dias_del_mes: hoy!.n });
    const proyectadas = Math.ceil(3 * hoy!.n / hoy!.d);
    expect(r.body.proyeccion).toMatchObject({ visitas_proyectadas: proyectadas, excedente_proyectado: Math.max(0, proyectadas - 4), excedente_proyectado_centavos: Math.max(0, proyectadas - 4) * 100 });
    expect(r.body.limites.sucursales).toEqual({ usadas: 2, maximo: 5 });
    expect(r.body.limites.garitas.maximo).toBe(3);
    expect(Array.isArray(r.body.facturas)).toBe(true);
    expect(r.body.progreso.pasos.map((p: any) => p.id)).toEqual(['empresa', 'sucursal', 'plan', 'admin', 'garita']);
    expect(JSON.stringify(r.body)).not.toContain(fx.empresas.B);

    await q(`DELETE FROM suscripcion_historial WHERE empresa_id = $1`, [fx.empresas.A]);
    await q(`DELETE FROM suscripciones WHERE empresa_id = $1`, [fx.empresas.A]);
  });

  it('sin suscripción: panel vacío de plan, sin proyección ni errores', async () => {
    const r = await request(app).get(`/api/empresas/${fx.empresas.B}/panel`).set(as('adminEmpB'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ suscripcion: null, proyeccion: null, pendiente_centavos: 0 });
    expect(r.body.uso).toMatchObject({ plan: null, incluidas: null });
  });

  it('suma lo que se debe y cuenta las vencidas', async () => {
    const e = (await uno<{ id: string }>(`INSERT INTO empresas (nombre) VALUES ($1) RETURNING id`, [`PAN Deuda ${uid()}`]))!.id;
    const admin = `pan.${uid()}@inttest.local`;
    await q(`INSERT INTO usuarios (nombre, email, password_hash, rol, empresa_id, activo) VALUES ('PAN admin', $1, crypt($2, gen_salt('bf', 4)), 'admin_empresa', $3, TRUE)`, [admin, PASSWORD, e]);
    const fila = (estado: string, total: number, periodo: string) =>
      uno(`INSERT INTO facturas_saas (numero, empresa_id, periodo, plan_codigo, plan_nombre, dias_del_mes, dias_facturados, cuota_centavos, visitas, visitas_incluidas, excedente_visitas,
              precio_visita_extra_centavos, excedente_centavos, total_centavos, detalle, vence_en, estado)
           VALUES ((SELECT valor + 1 FROM saas_contadores WHERE clave = 'factura_saas'), $1, $2, 'x', 'X', 30, 30, $3, 0, 0, 0, 0, 0, $3, '{}'::jsonb, CURRENT_DATE, $4)
           RETURNING id`, [e, periodo, total, estado]).then(() => q(`UPDATE saas_contadores SET valor = valor + 1 WHERE clave = 'factura_saas'`));
    await fila('pendiente', 10000, '2024-01'); await fila('vencida', 25000, '2024-02'); await fila('pagada', 99000, '2024-03'); await fila('anulada', 55000, '2024-04');
    const s = await login(app, admin);
    const r = await request(app).get(`/api/empresas/${e}/panel`).set(bearer(s.token));
    expect(r.body.pendiente_centavos).toBe(35000);                       // pendiente + vencida; ni pagada ni anulada
    expect(r.body.facturas_vencidas).toBe(1);
    expect(r.body.facturas.map((f: any) => f.periodo)).toEqual(['2024-04', '2024-03', '2024-02', '2024-01']);
  });

  it('aislamiento: el cruce es 404 y los demás roles no entran', async () => {
    expect((await request(app).get(`/api/empresas/${fx.empresas.B}/panel`).set(as('adminEmpA'))).status).toBe(404);
    expect((await request(app).get(`/api/empresas/${fx.empresas.A}/panel`).set(as('adminEmpB'))).status).toBe(404);
    expect((await request(app).get(`/api/empresas/${fx.empresas.A}/panel`).set(as('adminSucA1'))).status).toBe(403);
    expect((await request(app).get(`/api/empresas/${fx.empresas.A}/panel`).set(as('resA1'))).status).toBe(403);
    expect((await request(app).get(`/api/empresas/${fx.empresas.A}/panel`)).status).toBe(401);
    expect((await request(app).get(`/api/empresas/${randomUUID()}/panel`).set(as('owner'))).status).toBe(404);
    expect((await request(app).get('/api/empresas/no-uuid/panel').set(as('owner'))).status).toBe(400);
    expect((await request(app).get(`/api/empresas/${fx.empresas.B}/panel`).set(as('owner'))).status).toBe(200);
  });
});

describe('I-27 panel del owner', () => {
  it('lista las empresas con plan, estado, consumo y facturas pendientes', async () => {
    const plan = await planNuevo({ visitas_incluidas: 1, precio_visita_extra_centavos: 200 });
    const e = (await uno<{ id: string }>(`INSERT INTO empresas (nombre) VALUES ($1) RETURNING id`, [`PAN Owner ${uid()}`]))!.id;
    const s = (await uno<{ id: string }>(`INSERT INTO sucursales (empresa_id, nombre) VALUES ($1, 'S') RETURNING id`, [e]))!.id;
    await request(app).put(`/api/empresas/${e}/suscripcion`).set(as('owner')).send({ plan_id: plan.id, estado: 'activa' });
    for (let i = 0; i < 3; i++) await visita(s, fx.residentes.A1, fx.usuarios.agenteA1, new Date().toISOString());
    await q(`INSERT INTO facturas_saas (numero, empresa_id, periodo, plan_codigo, plan_nombre, dias_del_mes, dias_facturados, cuota_centavos, visitas, visitas_incluidas, excedente_visitas,
              precio_visita_extra_centavos, excedente_centavos, total_centavos, detalle, vence_en, estado)
             VALUES ((SELECT valor + 1 FROM saas_contadores WHERE clave = 'factura_saas'), $1, '2024-05', 'x', 'X', 30, 30, 700, 0, 0, 0, 0, 0, 700, '{}'::jsonb, CURRENT_DATE, 'vencida')`, [e]);
    await q(`UPDATE saas_contadores SET valor = valor + 1 WHERE clave = 'factura_saas'`);

    const r = await request(app).get('/api/planes/uso').set(as('owner'));
    expect(r.status).toBe(200);
    const fila = r.body.empresas.find((x: any) => x.empresa_id === e);
    expect(fila).toMatchObject({ plan: plan.codigo, plan_nombre: 'Plan PAN', estado: 'activa', suspendida: false, visitas: 3, incluidas: 1, excedente: 2, excedente_centavos: 400,
      facturas_pendientes: 1, facturas_vencidas: 1, pendiente_centavos: 700 });
    const sinPlan = r.body.empresas.find((x: any) => x.empresa_id === fx.empresas.B);
    expect(sinPlan).toMatchObject({ plan: null, estado: null, facturas_pendientes: 0, pendiente_centavos: 0 });
  });
});

describe('I-27 exportación de datos', () => {
  it('es un .zip válido con los datos de la empresa y NADA de otra', async () => {
    // Datos propios de A (marcados) y de B (que no deben salir).
    const marcaA = `MARCA-A-${uid()}`; const marcaB = `MARCA-B-${uid()}`;
    await visita(fx.sucursales.A1, fx.residentes.A1, fx.usuarios.agenteA1, new Date().toISOString(), marcaA);
    await visita(fx.sucursales.B1, fx.residentes.B1, fx.usuarios.agenteB1, new Date().toISOString(), marcaB);
    await q(`INSERT INTO pagos (sucursal_id, residente_id, monto, metodo, estado, referencia, registrado_por) VALUES ($1, $2, 99.5, 'efectivo', 'aprobado', $3, $4)`, [fx.sucursales.B1, fx.residentes.B1, marcaB, fx.usuarios.resB1]);

    const r = await descargar('adminEmpA', fx.empresas.A);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/zip');
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="securegate-datos-INT-Empresa-A-[a-f0-9]+-\d{4}-\d{2}-\d{2}\.zip"$/);
    expect(r.headers['cache-control']).toBe('no-store');

    const e = leerZip(r.body as Buffer);                                   // valida CRC y tamaños de cada archivo
    expect(e.map(x => x.nombre)).toEqual(['empresa.csv', 'sucursales.csv', 'usuarios.csv', 'residentes.csv', 'visitas.csv', 'pagos.csv', 'garitas.csv', 'facturas_saas.csv', 'LEEME.txt']);
    const por = Object.fromEntries(e.map(x => [x.nombre, x.texto]));
    for (const csv of e.filter(x => x.nombre.endsWith('.csv'))) expect(csv.texto.startsWith('﻿')).toBe(true);

    expect(por['empresa.csv']).toContain(`INT Empresa A`);
    expect(por['sucursales.csv']).toContain('INT Sucursal A1');
    expect(por['sucursales.csv']).toContain('INT Sucursal A2');
    expect(por['sucursales.csv']).not.toContain('INT Sucursal B1');
    expect(por['visitas.csv']).toContain(marcaA);
    // Sprint 10: cada visita dice cómo se capturó (manual, clic, qr; anpr solo en entradas de residentes, que no son visitas).
    expect(por['visitas.csv'].replace('\ufeff', '').split('\r\n')[0]).toBe('id,sucursal_id,residente_id,visitante,dpi,tipo,entrada,salida,autorizado,notas,metodo');
    expect(por['usuarios.csv']).toContain(fx.email.adminEmpA);
    expect(por['residentes.csv']).toContain(fx.email.resA1);
    expect(por['garitas.csv'].split('\r\n').length).toBeGreaterThan(2);    // encabezado + la garita sembrada de A1 + línea final vacía

    // Aislamiento: ni una sola fila, nombre ni correo de la empresa B.
    const todo = e.map(x => x.texto).join('\n');
    expect(todo).not.toContain(marcaB);
    expect(todo).not.toContain('INT Empresa B');
    expect(todo).not.toContain(fx.email.adminEmpB);
    expect(todo).not.toContain(fx.email.resB1);
    expect(todo).not.toContain(fx.sucursales.B1);
    expect(por['LEEME.txt']).toMatch(/DATOS PERSONALES/);
    expect(por['LEEME.txt']).toMatch(/visitas\.csv: [1-9]\d* fila/);
  });

  it('no incluye secretos: contraseñas, hashes, códigos de activación ni huellas', async () => {
    const e = leerZip((await descargar('owner', fx.empresas.A)).body as Buffer);
    const todo = e.map(x => x.texto).join('\n');
    const hash = await uno<{ password_hash: string }>(`SELECT password_hash FROM usuarios WHERE id = $1`, [fx.usuarios.adminEmpA]);
    expect(todo).not.toContain(hash!.password_hash);
    expect(todo).not.toMatch(/password|\$2[aby]\$|twofa|totp|secreto/i);
    expect(todo).not.toContain(fx.licencias.A1.codigo);
    expect(todo).not.toContain(fx.licencias.A1.fingerprint);
    expect(e.find(x => x.nombre === 'garitas.csv')!.texto.split('\r\n')[0]).not.toMatch(/codigo|fingerprint|huella/i);
  });

  it('neutraliza fórmulas en los CSV (un visitante llamado =HYPERLINK…)', async () => {
    const peligroso = `=HYPERLINK("http://malo.example","clic ${uid()}")`;
    await visita(fx.sucursales.A1, fx.residentes.A1, fx.usuarios.agenteA1, new Date().toISOString(), peligroso);
    const visitas = leerZip((await descargar('owner', fx.empresas.A)).body as Buffer).find(x => x.nombre === 'visitas.csv')!.texto;
    expect(visitas).not.toMatch(/(^|,)"?=HYPERLINK/m);
    expect(visitas).toContain(`"'=HYPERLINK(""http://malo.example"",""clic`);
  });

  it('las fechas salen en hora de Guatemala', async () => {
    await visita(fx.sucursales.A1, fx.residentes.A1, fx.usuarios.agenteA1, '2024-02-01 05:59:00+00', 'PAN hora');
    const fila = leerZip((await descargar('owner', fx.empresas.A)).body as Buffer).find(x => x.nombre === 'visitas.csv')!.texto.split('\r\n').find(l => l.includes('PAN hora'))!;
    expect(fila).toContain('2024-01-31 23:59:00');                         // 05:59 UTC = 23:59 del día anterior en Guatemala
  });

  it('un lote grande (más de 2 000 filas) sale completo y en orden, sin repetir', async () => {
    const e = (await uno<{ id: string }>(`INSERT INTO empresas (nombre) VALUES ($1) RETURNING id`, [`PAN Grande ${uid()}`]))!.id;
    const s = (await uno<{ id: string }>(`INSERT INTO sucursales (empresa_id, nombre) VALUES ($1, 'S') RETURNING id`, [e]))!.id;
    const v = await visitante('PAN masivo');
    await q(`INSERT INTO registros_acceso (sucursal_id, visitante_id, residente_id, agente_id, tipo, timestamp_entrada, notas)
             SELECT $1, $2, $3, $4, 'entrada', NOW(), 'fila-' || g FROM generate_series(1, 4500) g`, [s, v, fx.residentes.A1, fx.usuarios.agenteA1]);
    const zip = leerZip((await descargar('owner', e)).body as Buffer);
    const lineas = zip.find(x => x.nombre === 'visitas.csv')!.texto.split('\r\n').filter(Boolean);
    expect(lineas).toHaveLength(4501);                                      // encabezado + 4 500
    const iNotas = lineas[0].replace('\ufeff', '').split(',').indexOf('notas');          // por nombre: la columna `metodo` va después
    const notas = lineas.slice(1).map(l => l.split(',')[iNotas]);
    expect(new Set(notas).size).toBe(4500);
    expect(zip.find(x => x.nombre === 'LEEME.txt')!.texto).toContain('visitas.csv: 4500 fila(s)');
  });

  it('permisos y cruce: el admin de otra empresa recibe 404; sucursal, residente y anónimo no exportan', async () => {
    expect((await descargar('adminEmpB', fx.empresas.A)).status).toBe(404);
    expect((await descargar('adminSucA1', fx.empresas.A)).status).toBe(403);
    expect((await descargar('resA1', fx.empresas.A)).status).toBe(403);
    expect((await request(app).get(`/api/empresas/${fx.empresas.A}/exportar`)).status).toBe(401);
    expect((await descargar('owner', randomUUID())).status).toBe(404);
    expect((await descargar('owner', 'no-uuid')).status).toBe(400);
    expect((await descargar('owner', fx.empresas.A)).status).toBe(200);
  });

  it('la descarga queda auditada con quién, desde dónde y cuántas filas por archivo', async () => {
    await descargar('adminEmpA', fx.empresas.A);
    const limite = Date.now() + 3000;
    let fila: any;
    do {
      fila = await uno(`SELECT usuario_id, ip_address, status_code, datos_nuevos FROM audit_logs WHERE accion = 'DATOS_EMPRESA_EXPORTADOS' AND usuario_id = $1 AND registro_id = $2 ORDER BY created_at DESC LIMIT 1`, [fx.usuarios.adminEmpA, fx.empresas.A]);
      if (fila) break;
      await new Promise(r => setTimeout(r, 50));
    } while (Date.now() < limite);
    expect(fila).toMatchObject({ usuario_id: fx.usuarios.adminEmpA, status_code: 200 });
    expect(fila.ip_address).toBeTruthy();
    expect(fila.datos_nuevos.archivos['sucursales.csv']).toBe(2);
  });
});

describe('I-27 panel y exportación: nombre de archivo', () => {
  it('el nombre del archivo no puede inyectar encabezados ni rutas', async () => {
    const e = (await uno<{ id: string }>(`INSERT INTO empresas (nombre) VALUES ($1) RETURNING id`, [`Ñandú "Ltda" ../../etc\\passwd ${randomBytes(2).toString('hex')}`]))!.id;
    const r = await descargar('owner', e);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="securegate-datos-[A-Za-z0-9-]+-\d{4}-\d{2}-\d{2}\.zip"$/);
  });
});
