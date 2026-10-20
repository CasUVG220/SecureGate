/**
 * I-ANPR · ANPR continuo (Sprint 10): vehículos de residentes, snapshot versionado, accesos y salidas automáticos, eventos y
 * evidencia — integración contra Postgres real (sin mocks).
 *
 * Componentes: Express (app.ts) → /api/anpr/* y /api/sync/garita (verifyToken + verifyLicencia) → Postgres (vehiculos_residentes
 *   con su versión y sus disparadores, registros_acceso con origen 'anpr', anpr_eventos, evidencias_anpr, audit_logs).
 * Condición: licencias A1 y B1 activadas; agente y administración de A1 (y de B1 para el aislamiento).
 * Resultado esperado: ver cada `it`. Lo importante: la garita SOLO registra vehículos autorizados y vigentes de SU sucursal; un
 *   bloqueo por placa, la baja del vehículo o del residente y la empresa suspendida se respetan aunque la garita haya decidido sin
 *   red; cada reintento es idempotente; la bitácora distingue automático, verificado, alerta y evidencia.
 */
import request from 'supertest';
import { randomUUID, createHash } from 'crypto';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';
import { esperarAuditoriaDe } from '../helpers/audit';
import { purgarEvidenciasAnpr, MAX_EVIDENCIA_BYTES } from '../../controllers/anpr.controller';

let fx: Fixtures;
let licA1: string;
let licB1: string;
let agente: string;
let agenteB: string;
let admin: string;
let adminB: string;

/** JPEG mínimo (cabecera y fin): el servidor solo mira la firma, el tamaño y el SHA-256. */
const jpeg = (relleno = 64) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: relleno }, (_, i) => i % 251), 0xff, 0xd9]);

const activar = async (l: Fixtures['licencias']['A1']) =>
  (await request(app).post('/api/licencias/activar').send({ codigo: l.codigo, fingerprint: l.fingerprint, nombre_dispositivo: 'INT-anpr' })).body.token_licencia as string;

const garita = (ruta: string, body: Record<string, unknown>, token = agente, lic = licA1) =>
  request(app).post(`/api/anpr${ruta}`).set(bearer(token)).set('X-Licencia-Token', lic).send(body);

const snapshot = (desde?: string, token = agente, lic = licA1) =>
  request(app).get('/api/sync/garita').query(desde === undefined ? {} : { vehiculos_desde: desde }).set(bearer(token)).set('X-Licencia-Token', lic);

const nuevoVehiculo = async (placa: string, extra: Record<string, unknown> = {}, residente = fx.residentes.A1, token = admin) =>
  request(app).post('/api/anpr/vehiculos').set(bearer(token)).send({ residente_id: residente, placa, ...extra });

/** Placa única por corrida (P + 3 dígitos + 3 letras). */
let n = 100;
const placaNueva = () => `P${++n}${fx.sufijo.replace(/[^a-z]/g, 'x').slice(0, 3).toUpperCase().padEnd(3, 'X')}`;

beforeAll(async () => {
  fx = await sembrar();
  licA1 = await activar(fx.licencias.A1);
  licB1 = await activar(fx.licencias.B1);
  agente = (await login(app, fx.email.agenteA1)).token!;
  agenteB = (await login(app, fx.email.agenteB1)).token!;
  admin = (await login(app, fx.email.adminSucA1)).token!;
  adminB = (await login(app, fx.email.adminSucB1)).token!;
  // El residente sembrado está «activo» y en A1.
});
afterAll(cerrarPool);

describe('vehículos de residentes (administración)', () => {
  it('alta con la placa normalizada, una placa activa por sucursal y bitácora', async () => {
    const placa = placaNueva();
    const r = await nuevoVehiculo(`${placa.slice(0, 1)}-${placa.slice(1).toLowerCase()}`, { descripcion: 'Sedán gris' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ placa, residente_id: fx.residentes.A1, activo: true, descripcion: 'Sedán gris', vigente_hasta: null });
    // La bitácora del alta se espera ANTES del duplicado: las dos filas se escriben sin esperar y la más reciente podía ser la del 409.
    const audit = await esperarAuditoriaDe('VEHICULO_RESIDENTE_CREADO', fx.usuarios.adminSucA1);
    expect(audit[0]).toMatchObject({ status_code: 201, tabla_afectada: 'vehiculos_residentes' });
    expect(audit[0].datos_nuevos.placa).toBe(placa);
    expect((await nuevoVehiculo(placa)).status).toBe(409);
  });

  it('aislamiento: otra empresa no ve ni registra vehículos de A1; el agente no administra', async () => {
    expect((await nuevoVehiculo(placaNueva(), {}, fx.residentes.A1, adminB)).status).toBe(404);
    const lista = await request(app).get('/api/anpr/vehiculos').set(bearer(adminB));
    expect(lista.status).toBe(200);
    expect(lista.body.every((v: { sucursal_id: string }) => v.sucursal_id === fx.sucursales.B1)).toBe(true);
    expect((await request(app).get('/api/anpr/vehiculos').set(bearer(agente))).status).toBe(403);
    expect((await nuevoVehiculo('X1', {})).status).toBe(400);
    expect((await nuevoVehiculo(placaNueva(), { vigente_desde: '2026-10-10', vigente_hasta: '2026-10-01' })).status).toBe(400);
  });

  it('editar y dar de baja (baja suave)', async () => {
    const v = (await nuevoVehiculo(placaNueva())).body;
    const e = await request(app).patch(`/api/anpr/vehiculos/${v.id}`).set(bearer(admin)).send({ descripcion: 'Pickup roja', vigente_hasta: '2099-12-31' });
    expect(e.status).toBe(200);
    expect(e.body).toMatchObject({ descripcion: 'Pickup roja', vigente_hasta: '2099-12-31' });
    expect((await request(app).patch(`/api/anpr/vehiculos/${v.id}`).set(bearer(admin)).send({ vigente_hasta: '1999-01-01' })).status).toBe(400);
    expect((await request(app).patch(`/api/anpr/vehiculos/${v.id}`).set(bearer(adminB)).send({ descripcion: 'x' })).status).toBe(404);
    const b = await request(app).delete(`/api/anpr/vehiculos/${v.id}`).set(bearer(admin));
    expect(b.status).toBe(200);
    expect((await uno('SELECT activo FROM vehiculos_residentes WHERE id = $1', [v.id])).activo).toBe(false);
  });
});

describe('GET /sync/garita: vehículos autorizados con versión', () => {
  it('completo la primera vez, solo cambios después; un bloqueo por placa y la baja del residente suben la versión', async () => {
    const placa = placaNueva();
    const v = (await nuevoVehiculo(placa)).body;
    const s1 = await snapshot();
    expect(s1.status).toBe(200);
    expect(s1.body.vehiculos.modo).toBe('completo');
    const fila = s1.body.vehiculos.filas.find((f: { id: string }) => f.id === v.id);
    expect(fila).toMatchObject({ placa, residente_id: fx.residentes.A1, activo: true, en_lista_negra: false });
    expect(fila.numero_casa).toMatch(/^INT-A1-/);
    const version = s1.body.vehiculos.version as string;
    expect(Number(version)).toBeGreaterThan(0);

    const s2 = await snapshot(version);
    expect(s2.body.vehiculos).toMatchObject({ modo: 'cambios', version, filas: [] });

    // Bloqueo por placa → el vehículo vuelve a venir, marcado.
    await q(`INSERT INTO visitante_blacklist (sucursal_id, placa, razon, creado_por) VALUES ($1, $2, 'INT robo', $3)`,
      [fx.sucursales.A1, placa, fx.usuarios.adminSucA1]);
    const s3 = await snapshot(version);
    expect(s3.body.vehiculos.filas.map((f: { id: string; en_lista_negra: boolean }) => [f.id, f.en_lista_negra])).toEqual([[v.id, true]]);
    expect(Number(s3.body.vehiculos.version)).toBeGreaterThan(Number(version));

    // Baja del usuario del residente → el vehículo viene como no activo (la garita lo borra de su copia).
    const res = (await uno<{ id: string }>(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id, activo) VALUES ('INT res ANPR', $1, 'x', 'residente', $2, TRUE) RETURNING id`,
      [`anpr.res.${randomUUID().slice(0, 8)}@inttest.local`, fx.sucursales.A1]))!.id;
    const residente = (await uno<{ id: string }>(
      `INSERT INTO residentes (usuario_id, sucursal_id, numero_casa) VALUES ($1, $2, $3) RETURNING id`,
      [res, fx.sucursales.A1, `ANPR-${randomUUID().slice(0, 6)}`]))!.id;
    const otro = (await nuevoVehiculo(placaNueva(), {}, residente)).body;
    const antes = (await snapshot()).body.vehiculos.version;
    await q('UPDATE usuarios SET activo = FALSE WHERE id = $1', [res]);
    const s4 = await snapshot(antes);
    expect(s4.body.vehiculos.filas.map((f: { id: string; activo: boolean }) => [f.id, f.activo])).toEqual([[otro.id, false]]);
    // En el pull completo ya no aparece.
    expect((await snapshot()).body.vehiculos.filas.some((f: { id: string }) => f.id === otro.id)).toBe(false);
  });

  it('cada sucursal ve solo sus vehículos; un valor de versión inválido se toma como pull completo', async () => {
    const s = await snapshot(undefined, agenteB, licB1);
    expect(s.status).toBe(200);
    const a1 = (await q('SELECT id FROM vehiculos_residentes WHERE sucursal_id = $1', [fx.sucursales.A1])).map(r => r.id);
    expect(s.body.vehiculos.filas.some((f: { id: string }) => a1.includes(f.id))).toBe(false);
    const raro = await snapshot('1; DROP TABLE x');
    expect(raro.status).toBe(200);
    expect(raro.body.vehiculos.modo).toBe('completo');
  });
});

describe('POST /anpr/accesos (entrada automática o verificada)', () => {
  let vehiculo: { id: string; placa: string };
  beforeAll(async () => {
    vehiculo = (await nuevoVehiculo(placaNueva())).body;
  });

  const acceso = (extra: Record<string, unknown> = {}) => ({
    id_cliente: randomUUID(), vehiculo_id: vehiculo.id, placa: vehiculo.placa, confianza: 0.9712, track_id: 'carril1-mgx1-3',
    carril: 'carril1', modo: 'automatico', registrado_en: new Date(Date.now() - 60_000).toISOString(), ...extra,
  });

  it('automático: crea el acceso del residente (sin visitante) con origen anpr, confianza, pista y evidencia', async () => {
    const body = acceso();
    const r = await garita('/accesos', body);
    expect(r.status).toBe(201);
    expect(r.body.registro).toMatchObject({
      origen: 'anpr', visitante_id: null, vehiculo_residente_id: vehiculo.id, residente_id: fx.residentes.A1, tipo: 'entrada',
      track_id: 'carril1-mgx1-3', evidencia_ref: `anpr:${body.id_cliente}`, verificado_por: null, licencia_id: fx.licencias.A1.id,
      agente_id: fx.usuarios.agenteA1, sucursal_id: fx.sucursales.A1,
    });
    expect(Number(r.body.registro.confianza)).toBeCloseTo(0.9712, 4);
    const audit = await esperarAuditoriaDe('ANPR_ACCESO_AUTOMATICO', fx.usuarios.agenteA1);
    expect(audit[0]).toMatchObject({ status_code: 201, tabla_afectada: 'registros_acceso' });
    expect(audit[0].datos_nuevos).toMatchObject({ placa: vehiculo.placa, track_id: 'carril1-mgx1-3', modo: 'automatico' });

    // Reintento de la cola offline: mismo id_cliente, ni una fila más.
    const otra = await garita('/accesos', body);
    expect([otra.status, otra.body.duplicado]).toEqual([200, true]);
    expect(await q('SELECT 1 FROM registros_acceso WHERE id_cliente = $1', [body.id_cliente])).toHaveLength(1);
  });

  it('verificación: queda quién confirmó y la bitácora lo dice', async () => {
    const r = await garita('/accesos', acceso({ modo: 'verificacion' }));
    expect(r.status).toBe(201);
    expect(r.body.registro.verificado_por).toBe(fx.usuarios.agenteA1);
    const audit = await esperarAuditoriaDe('ANPR_ACCESO_VERIFICADO', fx.usuarios.agenteA1);
    expect(audit[0].status_code).toBe(201);
  });

  it('el servidor vuelve a validar: otra sucursal, placa distinta, baja, vigencia, residente de baja, lista negra', async () => {
    const vB = (await nuevoVehiculo(placaNueva(), {}, fx.residentes.B1, adminB)).body;
    expect((await garita('/accesos', acceso({ vehiculo_id: vB.id, placa: vB.placa }))).status).toBe(404);
    expect((await garita('/accesos', acceso({ placa: 'C999ZZZ' }))).status).toBe(409);

    const vencido = (await nuevoVehiculo(placaNueva(), { vigente_desde: '2026-01-01', vigente_hasta: '2026-01-31' })).body;
    const r1 = await garita('/accesos', acceso({ vehiculo_id: vencido.id, placa: vencido.placa }));
    expect([r1.status, r1.body.motivo]).toEqual([409, 'vehiculo_no_vigente']);

    const baja = (await nuevoVehiculo(placaNueva())).body;
    await request(app).delete(`/api/anpr/vehiculos/${baja.id}`).set(bearer(admin));
    const r2 = await garita('/accesos', acceso({ vehiculo_id: baja.id, placa: baja.placa }));
    expect([r2.status, r2.body.motivo]).toEqual([409, 'vehiculo_inactivo']);

    const bloqueado = (await nuevoVehiculo(placaNueva())).body;
    await q(`INSERT INTO visitante_blacklist (sucursal_id, placa, razon, creado_por) VALUES ($1, $2, 'INT', $3)`,
      [fx.sucursales.A1, bloqueado.placa, fx.usuarios.adminSucA1]);
    const r3 = await garita('/accesos', acceso({ vehiculo_id: bloqueado.id, placa: bloqueado.placa }));
    expect([r3.status, r3.body.motivo]).toEqual([403, 'placa']);
    expect(await q("SELECT 1 FROM registros_acceso WHERE vehiculo_residente_id = $1", [bloqueado.id])).toHaveLength(0);
  });

  it('doble llave: sin licencia 401, licencia de otra sucursal 403, datos inválidos 400', async () => {
    expect((await request(app).post('/api/anpr/accesos').set(bearer(agente)).send(acceso())).status).toBe(401);
    expect((await garita('/accesos', acceso(), agente, licB1)).status).toBe(403);
    expect((await garita('/accesos', acceso({ id_cliente: 'no-uuid' }))).status).toBe(400);
    expect((await garita('/accesos', acceso({ confianza: 2 }))).status).toBe(400);
    expect((await garita('/accesos', acceso({ modo: 'turbo' }))).status).toBe(400);
    expect((await garita('/accesos', acceso({ track_id: 'x'.repeat(65) }))).status).toBe(400);
  });
});

describe('POST /anpr/salidas (carril de salida)', () => {
  it('cierra el acceso abierto de la placa (residente o visitante), es idempotente y responde 404 si no hay nada abierto', async () => {
    const v = (await nuevoVehiculo(placaNueva())).body;
    const entrada = await garita('/accesos', { id_cliente: randomUUID(), vehiculo_id: v.id, placa: v.placa, modo: 'automatico' });
    expect(entrada.status).toBe(201);
    const id = randomUUID();
    const s = await garita('/salidas', { id_cliente: id, placa: v.placa, confianza: 0.95, track_id: 'salida-1', carril: 'salida' });
    expect(s.status).toBe(201);
    expect(s.body.registro).toMatchObject({ id: entrada.body.registro.id, tipo: 'salida', id_cliente_salida: id });
    expect(s.body.registro.timestamp_salida).not.toBeNull();
    expect((await garita('/salidas', { id_cliente: id, placa: v.placa })).body.duplicado).toBe(true);
    expect((await garita('/salidas', { id_cliente: randomUUID(), placa: v.placa })).status).toBe(404);

    // Visitante con vehículo registrado por el flujo de siempre.
    const placaVisita = placaNueva();
    const visita = await request(app).post('/api/accesos').set(bearer(agente)).set('X-Licencia-Token', licA1).send({
      nombre_visitante: 'INT visita ANPR', numero_dpi: `ANPR${randomUUID().slice(0, 8)}`, residente_id: fx.residentes.A1, placa: placaVisita, id_cliente: randomUUID(),
    });
    expect(visita.status).toBe(201);
    const sv = await garita('/salidas', { id_cliente: randomUUID(), placa: placaVisita.toLowerCase() });
    expect([sv.status, sv.body.registro.id]).toEqual([201, visita.body.registro.id]);
    const audit = await esperarAuditoriaDe('ANPR_SALIDA', fx.usuarios.agenteA1);
    expect(audit.some(a => a.status_code === 201)).toBe(true);
  });
});

describe('POST /anpr/eventos', () => {
  it('alerta de lista negra: queda en anpr_eventos y en la bitácora con su acción; el reintento no duplica', async () => {
    const id = randomUUID();
    const body = { id_cliente: id, tipo: 'alerta_lista_negra', placa: 'p-999 xyz', carril: 'entrada', track_id: 'entrada-1', detalle: { razon: 'Robo', confianza: 0.95 } };
    const r = await garita('/eventos', body);
    expect(r.status).toBe(201);
    expect(await uno('SELECT tipo, placa, sucursal_id FROM anpr_eventos WHERE id_cliente = $1', [id])).toEqual({ tipo: 'alerta_lista_negra', placa: 'P999XYZ', sucursal_id: fx.sucursales.A1 });
    const audit = await esperarAuditoriaDe('ANPR_ALERTA_LISTA_NEGRA', fx.usuarios.agenteA1);
    expect(audit[0].datos_nuevos).toMatchObject({ placa: 'P999XYZ', razon: 'Robo' });
    const otra = await garita('/eventos', body);
    expect([otra.status, otra.body.duplicado]).toEqual([200, true]);
    expect(await q('SELECT 1 FROM anpr_eventos WHERE id_cliente = $1', [id])).toHaveLength(1);
  });

  it('verificación resuelta y falla del actuador también se auditan; tipo o detalle inválidos → 400', async () => {
    expect((await garita('/eventos', { id_cliente: randomUUID(), tipo: 'verificacion_resuelta', placa: 'P123ABC', detalle: { resolucion: 'descartado' } })).status).toBe(201);
    expect((await esperarAuditoriaDe('ANPR_VERIFICACION_RESUELTA', fx.usuarios.agenteA1))[0].status_code).toBe(201);
    expect((await garita('/eventos', { id_cliente: randomUUID(), tipo: 'actuador_fallo', detalle: { error: 'timeout' } })).status).toBe(201);
    expect((await esperarAuditoriaDe('ANPR_ACTUADOR_FALLO', fx.usuarios.agenteA1))[0].status_code).toBe(201);
    expect((await garita('/eventos', { id_cliente: randomUUID(), tipo: 'abrir_todo' })).status).toBe(400);
    expect((await garita('/eventos', { id_cliente: randomUUID(), tipo: 'ilegible', detalle: { x: 'y'.repeat(5000) } })).status).toBe(400);
  });
});

describe('POST /anpr/evidencias y su lectura', () => {
  let idCliente: string;
  beforeAll(async () => {
    const v = (await nuevoVehiculo(placaNueva())).body;
    idCliente = randomUUID();
    expect((await garita('/accesos', { id_cliente: idCliente, vehiculo_id: v.id, placa: v.placa })).status).toBe(201);
  });

  it('sube una vez (idempotente), valida firma, tamaño y SHA-256, y solo de lo que esta sucursal registró', async () => {
    const img = jpeg(500);
    const sha256 = createHash('sha256').update(img).digest('hex');
    const ok = await garita('/evidencias', { id_cliente: idCliente, tipo: 'placa', jpeg: img.toString('base64'), sha256 });
    expect(ok.status).toBe(201);
    const caduca = new Date(ok.body.expira_en).getTime() - Date.now();
    expect(caduca).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
    expect(caduca).toBeLessThan(7.1 * 24 * 3600 * 1000);
    expect((await garita('/evidencias', { id_cliente: idCliente, tipo: 'placa', jpeg: img.toString('base64'), sha256 })).body.duplicado).toBe(true);
    expect((await garita('/evidencias', { id_cliente: idCliente, tipo: 'vehiculo', jpeg: img.toString('base64'), sha256: 'a'.repeat(64) })).status).toBe(400);
    expect((await garita('/evidencias', { id_cliente: idCliente, tipo: 'vehiculo', jpeg: Buffer.from('no es jpeg').toString('base64') })).status).toBe(400);
    expect((await garita('/evidencias', { id_cliente: idCliente, tipo: 'vehiculo', jpeg: jpeg(MAX_EVIDENCIA_BYTES).toString('base64') })).status).toBe(413);
    expect((await garita('/evidencias', { id_cliente: randomUUID(), tipo: 'placa', jpeg: img.toString('base64') })).status).toBe(404);
    expect((await garita('/evidencias', { id_cliente: idCliente, tipo: 'placa', jpeg: img.toString('base64') }, agenteB, licB1)).status).toBe(404);
    expect((await esperarAuditoriaDe('ANPR_EVIDENCIA', fx.usuarios.agenteA1))[0].datos_nuevos).toMatchObject({ tipo: 'placa', bytes: img.length });

    const ver = await request(app).get(`/api/anpr/evidencias/${idCliente}/placa`).set(bearer(agente));
    expect(ver.status).toBe(200);
    expect(ver.headers['content-type']).toBe('image/jpeg');
    expect(ver.headers['cache-control']).toBe('no-store');
    expect(Buffer.compare(Buffer.from(ver.body), img)).toBe(0);
    expect((await request(app).get(`/api/anpr/evidencias/${idCliente}/placa`).set(bearer(adminB))).status).toBe(404);
    expect((await request(app).get(`/api/anpr/evidencias/${idCliente}/vehiculo`).set(bearer(agente))).status).toBe(404);
  });

  it('la purga borra la evidencia vencida (7 días) y deja de servirse', async () => {
    await q(`UPDATE evidencias_anpr SET expira_en = NOW() - INTERVAL '1 minute' WHERE id_cliente = $1`, [idCliente]);
    const r = await purgarEvidenciasAnpr();
    expect(r.purgadas).toBeGreaterThanOrEqual(1);
    expect(await q('SELECT 1 FROM evidencias_anpr WHERE id_cliente = $1', [idCliente])).toHaveLength(0);
    expect((await request(app).get(`/api/anpr/evidencias/${idCliente}/placa`).set(bearer(agente))).status).toBe(404);
  });
});

describe('empresa suspendida', () => {
  it('423 en el snapshot y en lo que sube la garita: nada se registra', async () => {
    const v = (await nuevoVehiculo(placaNueva())).body;
    await q('UPDATE empresas SET suspendida = TRUE, suspension_motivo = $2, suspendida_en = NOW() WHERE id = $1', [fx.empresas.A, 'INT impago']);
    try {
      expect((await snapshot()).status).toBe(423);
      const id = randomUUID();
      expect((await garita('/accesos', { id_cliente: id, vehiculo_id: v.id, placa: v.placa })).status).toBe(423);
      expect(await q('SELECT 1 FROM registros_acceso WHERE id_cliente = $1', [id])).toHaveLength(0);
    } finally {
      await q('UPDATE empresas SET suspendida = FALSE, suspension_motivo = NULL, suspendida_en = NULL WHERE id = $1', [fx.empresas.A]);
    }
  });
});
