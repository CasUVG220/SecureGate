/**
 * I-5 · Lista negra por DPI y por placa (integración) — SCRUM-110 / H03
 *
 * Componentes: Express (app.ts) → /api/blacklist, /api/accesos, /api/visitantes,
 *   /api/sync/garita → blacklist/accesos/visitantes/sync controllers → Postgres real
 *   (visitante_blacklist, visitantes, vehiculos, registros_acceso, audit_logs). Sin mocks.
 * Modelo (decisión documentada en docs/sprint9_noche.md): una entrada de
 *   `visitante_blacklist` identifica al visitante (DPI) o, sin conocerlo, solo a un
 *   vehículo (placa normalizada). Misma vigencia, auditoría y aislamiento por sucursal.
 * Resultado esperado:
 *   - bloquear una placa (en cualquier formato) la guarda normalizada y rechaza el
 *     acceso con 403 «Visitante en blacklist» (motivo: placa), igual que el DPI;
 *   - la misma placa en OTRA sucursal/empresa no se bloquea ni se ve ni se puede quitar;
 *   - un bloqueo vencido o quitado ya no bloquea; no hay duplicados;
 *   - «Buscar visitante por DPI o placa» respeta el alcance del usuario.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';
import { esperarAuditoria, esperarAuditoriaDe } from '../helpers/audit';

let fx: Fixtures;
let n = 0;
beforeAll(async () => { fx = await sembrar(); });
afterAll(cerrarPool);

/** Una placa distinta por prueba (letras+dígitos), para que los bloqueos no se crucen. */
const placaUnica = () => {
  const i = ++n;
  return { normal: `Q${String(i).padStart(3, '0')}${fx.sufijo.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X').padEnd(3, 'X')}` };
};
const dpiUnico = () => `INT-DPI-${randomUUID().slice(0, 8)}`;

const bloquear = (token: string | undefined, body: object) =>
  request(app).post('/api/blacklist').set(bearer(token)).send({ razon: 'Prueba de integración', duracion: 'indefinido', ...body });

const acceso = (token: string | undefined, residenteId: string, body: object) =>
  request(app).post('/api/accesos').set(bearer(token)).send({
    nombre_visitante: 'Visitante Integración', numero_dpi: dpiUnico(), residente_id: residenteId, ...body,
  });

describe('I-5 bloqueo por PLACA', () => {
  it('crea la entrada con la placa normalizada, sin visitante, y la audita', async () => {
    const { normal } = placaUnica();
    const admin = await login(app, fx.email.adminSucA1);
    const crear = await bloquear(admin.token, { placa: `${normal.slice(0, 1)}-${normal.slice(1, 4)} ${normal.slice(4).toLowerCase()}` });
    expect(crear.status).toBe(201);
    expect(crear.body).toMatchObject({ placa: normal, visitante_id: null, sucursal_id: fx.sucursales.A1, activo: true });

    const db = await uno('SELECT placa, visitante_id, sucursal_id, creado_por FROM visitante_blacklist WHERE id = $1', [crear.body.id]);
    expect(db).toMatchObject({ placa: normal, visitante_id: null, sucursal_id: fx.sucursales.A1, creado_por: fx.usuarios.adminSucA1 });

    // El alta no trae :id en la ruta (registro_id queda vacío): se busca por usuario y acción.
    const filas = await esperarAuditoriaDe('BLACKLIST_AGREGADO', fx.usuarios.adminSucA1);
    expect(filas[0]).toMatchObject({ status_code: 201, usuario_id: fx.usuarios.adminSucA1, tabla_afectada: 'visitante_blacklist' });
    expect(filas[0].ip_address).toBeTruthy();
  });

  it('rechaza el acceso por esa placa en cualquier formato (403, motivo placa) y no escribe nada', async () => {
    const { normal } = placaUnica();
    const admin = await login(app, fx.email.adminSucA1);
    const agente = await login(app, fx.email.agenteA1);
    expect((await bloquear(admin.token, { placa: normal, razon: 'Vehículo robado' })).status).toBe(201);

    const dpi = dpiUnico();
    const antes = (await q('SELECT count(*)::int AS n FROM registros_acceso WHERE sucursal_id = $1', [fx.sucursales.A1]))[0].n;
    for (const formato of [normal, `${normal.slice(0, 1)}-${normal.slice(1)}`, normal.toLowerCase(), ` ${normal.slice(0, 2)} ${normal.slice(2)} `]) {
      const r = await acceso(agente.token, fx.residentes.A1, { numero_dpi: dpi, placa: formato });
      expect([formato, r.status]).toEqual([formato, 403]);
      expect(r.body).toMatchObject({ error: 'Visitante en blacklist', razon: 'Vehículo robado', fecha_fin: null, motivo: 'placa' });
    }
    expect((await q('SELECT count(*)::int AS n FROM registros_acceso WHERE sucursal_id = $1', [fx.sucursales.A1]))[0].n).toBe(antes);
    expect(await uno('SELECT 1 FROM visitantes WHERE numero_dpi = $1', [dpi])).toBeUndefined(); // ni siquiera se crea el visitante
  });

  it('otra placa y un acceso sin placa siguen entrando', async () => {
    const { normal } = placaUnica();
    const admin = await login(app, fx.email.adminSucA1);
    const agente = await login(app, fx.email.agenteA1);
    await bloquear(admin.token, { placa: normal });
    const otra = placaUnica().normal;
    expect((await acceso(agente.token, fx.residentes.A1, { placa: otra })).status).toBe(201);
    expect((await acceso(agente.token, fx.residentes.A1, {})).status).toBe(201);
  });

  it('el bloqueo por DPI sigue funcionando y responde con motivo dpi', async () => {
    const dpi = dpiUnico();
    const admin = await login(app, fx.email.adminSucA1);
    const agente = await login(app, fx.email.agenteA1);
    const v = await uno<{ id: string }>('INSERT INTO visitantes (nombre, numero_dpi) VALUES ($1, $2) RETURNING id', ['Vetado por DPI', dpi]);
    expect((await bloquear(admin.token, { visitante_id: v!.id, razon: 'Altercado' })).status).toBe(201);
    const r = await acceso(agente.token, fx.residentes.A1, { numero_dpi: dpi, placa: placaUnica().normal });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: 'Visitante en blacklist', razon: 'Altercado', motivo: 'dpi' });
  });

  it('un bloqueo vencido (fecha_fin en el pasado) ya no bloquea', async () => {
    const { normal } = placaUnica();
    const admin = await login(app, fx.email.adminSucA1);
    const agente = await login(app, fx.email.agenteA1);
    const crear = await bloquear(admin.token, { placa: normal });
    await q(`UPDATE visitante_blacklist SET fecha_fin = NOW() - interval '1 day' WHERE id = $1`, [crear.body.id]);
    expect((await acceso(agente.token, fx.residentes.A1, { placa: normal })).status).toBe(201);
  });

  it('quitar el bloqueo (DELETE) vuelve a permitir la placa y queda auditado', async () => {
    const { normal } = placaUnica();
    const admin = await login(app, fx.email.adminSucA1);
    const agente = await login(app, fx.email.agenteA1);
    const crear = await bloquear(admin.token, { placa: normal });
    expect((await acceso(agente.token, fx.residentes.A1, { placa: normal })).status).toBe(403);

    const quitar = await request(app).delete(`/api/blacklist/${crear.body.id}`).set(bearer(admin.token));
    expect(quitar.status).toBe(200);
    expect(quitar.body).toMatchObject({ id: crear.body.id, removed: true });
    expect((await acceso(agente.token, fx.residentes.A1, { placa: normal })).status).toBe(201);

    const [a] = await esperarAuditoria('BLACKLIST_REMOVIDO', crear.body.id);
    expect(a).toMatchObject({ usuario_id: fx.usuarios.adminSucA1, status_code: 200 });
  });
});

describe('I-5 validaciones y duplicados', () => {
  it('sin visitante ni placa, con placa muy corta o con razón vacía → 400', async () => {
    const admin = await login(app, fx.email.adminSucA1);
    expect((await bloquear(admin.token, {})).status).toBe(400);
    expect((await bloquear(admin.token, { placa: 'P1' })).status).toBe(400);
    expect((await bloquear(admin.token, { placa: '---' })).status).toBe(400);
    expect((await bloquear(admin.token, { placa: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' })).status).toBe(400);
    expect((await bloquear(admin.token, { placa: placaUnica().normal, razon: '   ' })).status).toBe(400);
    expect((await bloquear(admin.token, { visitante_id: 'no-es-uuid' })).status).toBe(400);
  });

  it('la misma placa (en otro formato) o el mismo visitante dos veces → 409', async () => {
    const { normal } = placaUnica();
    const admin = await login(app, fx.email.adminSucA1);
    expect((await bloquear(admin.token, { placa: normal })).status).toBe(201);
    const dup = await bloquear(admin.token, { placa: `${normal.slice(0, 1)}-${normal.slice(1).toLowerCase()}` });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/placa ya está bloqueada/);

    const v = await uno<{ id: string }>('INSERT INTO visitantes (nombre, numero_dpi) VALUES ($1, $2) RETURNING id', ['Doble', dpiUnico()]);
    expect((await bloquear(admin.token, { visitante_id: v!.id })).status).toBe(201);
    expect((await bloquear(admin.token, { visitante_id: v!.id })).status).toBe(409);
    expect((await q('SELECT 1 FROM visitante_blacklist WHERE visitante_id = $1', [v!.id])).length).toBe(1);
  });

  it('agente y residente no pueden bloquear (403)', async () => {
    for (const quien of ['agenteA1', 'resA1']) {
      const s = await login(app, fx.email[quien]);
      expect((await bloquear(s.token, { placa: placaUnica().normal })).status).toBe(403);
    }
  });

  it('el CHECK de la base impide una entrada sin visitante ni placa', async () => {
    await expect(q(
      `INSERT INTO visitante_blacklist (sucursal_id, razon, creado_por) VALUES ($1, 'x', $2)`,
      [fx.sucursales.A1, fx.usuarios.adminSucA1],
    )).rejects.toThrow(/visitante_blacklist_objetivo_chk/);
    await expect(q(
      `INSERT INTO visitante_blacklist (sucursal_id, placa, razon, creado_por) VALUES ($1, 'p-123abc', 'x', $2)`,
      [fx.sucursales.A1, fx.usuarios.adminSucA1],
    )).rejects.toThrow(/visitante_blacklist_placa_chk/); // la base exige la forma normalizada
  });
});

describe('I-5 aislamiento entre sucursales y empresas', () => {
  it('una placa bloqueada en A1 NO bloquea en B1 (otra empresa) ni en A2', async () => {
    const { normal } = placaUnica();
    const adminA1 = await login(app, fx.email.adminSucA1);
    await bloquear(adminA1.token, { placa: normal });

    const agenteB1 = await login(app, fx.email.agenteB1);
    expect((await acceso(agenteB1.token, fx.residentes.B1, { placa: normal })).status).toBe(201);

    const agenteA1 = await login(app, fx.email.agenteA1);
    expect((await acceso(agenteA1.token, fx.residentes.A1, { placa: normal })).status).toBe(403);
  });

  it('el listado solo muestra lo del alcance de cada usuario', async () => {
    const { normal } = placaUnica();
    const adminA1 = await login(app, fx.email.adminSucA1);
    const crear = await bloquear(adminA1.token, { placa: normal });
    const ids = async (quien: string) =>
      ((await request(app).get('/api/blacklist').set(bearer((await login(app, fx.email[quien])).token))).body as any[]).map(e => e.id);

    expect(await ids('adminSucA1')).toContain(crear.body.id);
    expect(await ids('adminEmpA')).toContain(crear.body.id);
    expect(await ids('owner')).toContain(crear.body.id);
    expect(await ids('adminSucA2')).not.toContain(crear.body.id);   // otra sucursal de la misma empresa
    expect(await ids('adminSucB1')).not.toContain(crear.body.id);   // otra empresa
    expect(await ids('adminEmpB')).not.toContain(crear.body.id);

    const fila = ((await request(app).get('/api/blacklist').set(bearer(adminA1.token))).body as any[]).find(e => e.id === crear.body.id);
    expect(fila).toMatchObject({ placa: normal, visitante_id: null, visitante_nombre: null, numero_dpi: null });
  });

  it('otra empresa NO puede quitar un bloqueo ajeno (404) y el bloqueo sigue vigente', async () => {
    const { normal } = placaUnica();
    const adminA1 = await login(app, fx.email.adminSucA1);
    const crear = await bloquear(adminA1.token, { placa: normal });
    for (const quien of ['adminSucB1', 'adminEmpB', 'adminSucA2']) {
      const s = await login(app, fx.email[quien]);
      const r = await request(app).delete(`/api/blacklist/${crear.body.id}`).set(bearer(s.token));
      expect([quien, r.status]).toEqual([quien, 404]);
    }
    expect((await uno('SELECT activo FROM visitante_blacklist WHERE id = $1', [crear.body.id])).activo).toBe(true);
    const agenteA1 = await login(app, fx.email.agenteA1);
    expect((await acceso(agenteA1.token, fx.residentes.A1, { placa: normal })).status).toBe(403);
  });

  it('el body no permite escribir en otra sucursal: admin de sucursal ignora sucursal_id; admin de empresa ajeno recibe 403', async () => {
    const adminA1 = await login(app, fx.email.adminSucA1);
    const propia = await bloquear(adminA1.token, { placa: placaUnica().normal, sucursal_id: fx.sucursales.B1 });
    expect(propia.status).toBe(201);
    expect(propia.body.sucursal_id).toBe(fx.sucursales.A1);   // se ignoró el B1 del body

    const adminEmpA = await login(app, fx.email.adminEmpA);
    expect((await bloquear(adminEmpA.token, { placa: placaUnica().normal, sucursal_id: fx.sucursales.B1 })).status).toBe(403);
    expect((await bloquear(adminEmpA.token, { placa: placaUnica().normal })).status).toBe(400);                         // debe indicar sucursal
    const conSuc = await bloquear(adminEmpA.token, { placa: placaUnica().normal, sucursal_id: fx.sucursales.A2 });
    expect(conSuc.status).toBe(201);
    expect(conSuc.body.sucursal_id).toBe(fx.sucursales.A2);
  });
});

describe('I-5 «Buscar visitante por DPI o placa»', () => {
  const dpi = dpiUnico();
  const placaTecleada = 'P-777ZZZ';

  beforeAll(async () => {
    const agente = await login(app, fx.email.agenteA1);
    const r = await acceso(agente.token, fx.residentes.A1, { numero_dpi: dpi, nombre_visitante: 'Buscable Por Placa', placa: placaTecleada });
    expect(r.status).toBe(201);
  });

  const buscar = async (quien: string, qs: string) => {
    const s = await login(app, fx.email[quien]);
    return request(app).get(`/api/visitantes?${qs}`).set(bearer(s.token));
  };

  it('encuentra al visitante por placa sin importar el formato tecleado', async () => {
    for (const p of ['p777zzz', 'P-777', '777ZZ', 'p 777 zzz']) {
      const r = await buscar('adminSucA1', `placa=${encodeURIComponent(p)}`);
      expect([p, r.status]).toEqual([p, 200]);
      expect(r.body).toHaveLength(1);
      expect(r.body[0]).toMatchObject({ nombre: 'Buscable Por Placa', numero_dpi: dpi, placa: placaTecleada });
    }
  });

  it('por DPI sigue funcionando', async () => {
    const r = await buscar('adminSucA1', `dpi=${dpi.slice(0, 12)}`);
    expect(r.status).toBe(200);
    expect(r.body.map((v: any) => v.numero_dpi)).toContain(dpi);
  });

  it('respeta el alcance: el admin de la empresa A lo ve; otras sucursales y empresas no', async () => {
    expect((await buscar('adminEmpA', 'placa=777ZZZ')).body).toHaveLength(1);
    expect((await buscar('adminSucA2', 'placa=777ZZZ')).body).toHaveLength(0);
    expect((await buscar('adminSucB1', 'placa=777ZZZ')).body).toHaveLength(0);
    expect((await buscar('adminEmpB', 'placa=777ZZZ')).body).toHaveLength(0);
    expect((await buscar('adminSucB1', `dpi=${dpi.slice(0, 12)}`)).body).toHaveLength(0);
  });

  it('parámetros inválidos → 400 y los comodines de LIKE no se interpretan', async () => {
    expect((await buscar('adminSucA1', 'placa=P')).status).toBe(400);
    expect((await buscar('adminSucA1', 'dpi=ab')).status).toBe(400);
    expect((await buscar('adminSucA1', '')).status).toBe(400);
    expect((await buscar('adminSucA1', `dpi=${dpi}&placa=777ZZZ`)).status).toBe(400);
    const comodin = await buscar('adminSucA1', 'dpi=%25%25%25');
    expect(comodin.status).toBe(200);
    expect(comodin.body).toHaveLength(0);
  });

  it('un residente no puede buscar visitantes (403)', async () => {
    expect((await buscar('resA1', 'placa=777ZZZ')).status).toBe(403);
  });
});

describe('I-5 espejo de la garita (sync) incluye las placas bloqueadas', () => {
  it('el snapshot de A1 trae la placa bloqueada de A1 y no la de B1', async () => {
    const pA = placaUnica().normal;
    const pB = placaUnica().normal;
    const adminA1 = await login(app, fx.email.adminSucA1);
    const adminB1 = await login(app, fx.email.adminSucB1);
    await bloquear(adminA1.token, { placa: pA, razon: 'Placa A' });
    await bloquear(adminB1.token, { placa: pB, razon: 'Placa B' });

    const act = await request(app).post('/api/licencias/activar')
      .send({ codigo: fx.licencias.A1.codigo, fingerprint: fx.licencias.A1.fingerprint, nombre_dispositivo: 'INT-pc' });
    expect(act.status).toBe(200);
    const agente = await login(app, fx.email.agenteA1);
    const snap = await request(app).get('/api/sync/garita').set(bearer(agente.token)).set('X-Licencia-Token', act.body.token_licencia);
    expect(snap.status).toBe(200);

    const placas = (snap.body.blacklist as any[]).map(b => b.placa).filter(Boolean);
    expect(placas).toContain(pA);
    expect(placas).not.toContain(pB);
    const fila = (snap.body.blacklist as any[]).find(b => b.placa === pA);
    expect(fila).toMatchObject({ numero_dpi: null, visitante_nombre: null, razon: 'Placa A', fecha_fin: null, residente_id: null });
  });
});
