/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * Las invitaciones crean cuentas administrativas sin que nadie más las
 * revise. Un fallo aquí es una escalada de privilegios: un admin de empresa
 * invitando admins de otra empresa, un enlace vencido o ya usado que sigue
 * creando usuarios, o un alcance que se toma del body en vez del JWT. Se
 * prueba el enrutado de decisiones (403/409/410 y qué INSERT sale), con el
 * pool mockeado como en el resto de la suite.
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import jwt from 'jsonwebtoken';
import pool from '../db/pool';
import {
  crearInvitacion, getInvitacionPorToken, aceptarInvitacion, revocarInvitacion, getInvitaciones,
  generarToken, hashToken, estadoEfectivo,
} from '../controllers/invitaciones.controller';
import { _usarTransporte, type Mensaje } from '../services/email';

process.env.JWT_SECRET = 'test-secret';

const mockPool = pool as unknown as { query: jest.Mock; connect: jest.Mock };

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  return res;
};

const OWNER   = { id: 'u-owner', nombre: 'Owner', email: 'o@sg.com', rol: 'owner', sucursal_id: null, empresa_id: null };
const ADMIN_E = { id: 'u-ae', nombre: 'Admin E', email: 'ae@sg.com', rol: 'admin_empresa', sucursal_id: null, empresa_id: 'emp-1' };

const enUnDia = new Date(Date.now() + 24 * 3600 * 1000);
const ayer    = new Date(Date.now() - 24 * 3600 * 1000);

const fila = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1', email: 'nuevo@sg.com', rol_invitado: 'admin_sucursal', empresa_id: 'emp-1', empresa_nombre: null,
  sucursal_id: 'suc-1', invitado_por: 'u-ae', estado: 'pendiente', expira_en: enUnDia, created_at: new Date(),
  aceptada_en: null, revocada_en: null, empresa_nombre_actual: 'Condominio X', sucursal_nombre: 'Torre A',
  invitado_por_nombre: 'Admin E', ...over,
});

const correos: Mensaje[] = [];
beforeAll(() => _usarTransporte({ nombre: 'test', enviar: async m => { correos.push(m); } }));
beforeEach(() => { mockPool.query.mockReset(); mockPool.connect.mockReset(); correos.length = 0; });

describe('generarToken / estadoEfectivo', () => {
  it('genera tokens base64url de 256 bits, distintos entre sí', () => {
    const a = generarToken(); const b = generarToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(hashToken(a)).toHaveLength(64);
  });
  it('una pendiente vencida se reporta expirada aunque el job no haya corrido', () => {
    expect(estadoEfectivo({ estado: 'pendiente', expira_en: ayer })).toBe('expirada');
    expect(estadoEfectivo({ estado: 'pendiente', expira_en: enUnDia })).toBe('pendiente');
    expect(estadoEfectivo({ estado: 'aceptada', expira_en: ayer })).toBe('aceptada');
  });
});

describe('crearInvitacion — jerarquía y alcance', () => {
  it('admin_empresa NO puede invitar admin_empresa (sólo owner)', async () => {
    const res = mockRes();
    await crearInvitacion({ user: ADMIN_E, body: { email: 'x@sg.com', rol_invitado: 'admin_empresa', empresa_nombre: 'Nueva' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('owner NO puede saltarse un nivel e invitar admin_sucursal', async () => {
    const res = mockRes();
    await crearInvitacion({ user: OWNER, body: { email: 'x@sg.com', rol_invitado: 'admin_sucursal', sucursal_id: 'suc-1' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('admin_empresa NO puede invitar admin_sucursal para una sucursal de otra empresa (403)', async () => {
    // El SELECT de pertenencia (sucursal ∧ empresa del JWT) no devuelve nada.
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await crearInvitacion({ user: ADMIN_E, body: { email: 'x@sg.com', rol_invitado: 'admin_sucursal', sucursal_id: 'suc-ajena' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/no pertenece/) }));
    expect(mockPool.query.mock.calls[0][1]).toEqual(['suc-ajena', 'emp-1']);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('admin_empresa invita admin_sucursal de su empresa: empresa_id sale del JWT, se guarda el hash y se envía el correo', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'suc-1', empresa_id: 'emp-1' }] }) // pertenencia
      .mockResolvedValueOnce({ rows: [] })                                    // usuario existente
      .mockResolvedValueOnce({ rows: [] })                                    // pendiente previa
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1' }] })                     // INSERT
      .mockResolvedValueOnce({ rows: [fila()] });                             // SELECT completo
    const res = mockRes();
    await crearInvitacion({ user: ADMIN_E, body: { email: 'Nuevo@SG.com', rol_invitado: 'admin_sucursal', sucursal_id: 'suc-1', empresa_id: 'emp-OTRA' } } as any, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const insert = mockPool.query.mock.calls[3];
    expect(insert[0]).toMatch(/INSERT INTO invitaciones/);
    const [email, rol, empresaId, empresaNombre, sucursalId, tokenHash, invitadoPor] = insert[1];
    expect(email).toBe('nuevo@sg.com');
    expect(rol).toBe('admin_sucursal');
    expect(empresaId).toBe('emp-1');          // del JWT, no el 'emp-OTRA' del body
    expect(empresaNombre).toBeNull();
    expect(sucursalId).toBe('suc-1');
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/); // nunca el token en claro
    expect(invitadoPor).toBe('u-ae');

    const cuerpo = res.json.mock.calls[0][0];
    expect(cuerpo.enlace).toMatch(/\/invitacion\/[A-Za-z0-9_-]{43}$/);
    expect(cuerpo.token_hash).toBeUndefined();
    expect(hashToken(cuerpo.enlace.split('/').pop())).toBe(tokenHash);

    expect(correos).toHaveLength(1);
    expect(correos[0].to).toBe('nuevo@sg.com');
    expect(correos[0].text).toContain(cuerpo.enlace);
  });

  it('owner invita admin_empresa de una empresa NUEVA: guarda empresa_nombre sin empresa_id', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })                  // usuario existente
      .mockResolvedValueOnce({ rows: [] })                  // pendiente previa
      .mockResolvedValueOnce({ rows: [{ id: 'inv-2' }] })   // INSERT
      .mockResolvedValueOnce({ rows: [fila({ id: 'inv-2', rol_invitado: 'admin_empresa', empresa_id: null, empresa_nombre: 'Residencial Sur', sucursal_id: null, sucursal_nombre: null, empresa_nombre_actual: null })] });
    const res = mockRes();
    await crearInvitacion({ user: OWNER, body: { email: 'ceo@sur.com', rol_invitado: 'admin_empresa', empresa_nombre: 'Residencial Sur' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(201);
    const [, rol, empresaId, empresaNombre, sucursalId] = mockPool.query.mock.calls[2][1];
    expect(rol).toBe('admin_empresa');
    expect(empresaId).toBeNull();
    expect(empresaNombre).toBe('Residencial Sur');
    expect(sucursalId).toBeNull();
    expect(res.json.mock.calls[0][0].crea_empresa).toBe(true);
  });

  it('rechaza si el correo ya es de un usuario (409)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'u-x' }] });
    const res = mockRes();
    await crearInvitacion({ user: OWNER, body: { email: 'ya@sg.com', rol_invitado: 'admin_empresa', empresa_nombre: 'Nueva' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('getInvitacionPorToken (público)', () => {
  const TOKEN = generarToken();
  it('expirada → 410', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [fila({ expira_en: ayer })] });
    const res = mockRes();
    await getInvitacionPorToken({ params: { token: TOKEN } } as any, res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(mockPool.query.mock.calls[0][1]).toEqual([hashToken(TOKEN)]);
  });
  it('aceptada / revocada → 409', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [fila({ estado: 'aceptada' })] });
    const res = mockRes();
    await getInvitacionPorToken({ params: { token: TOKEN } } as any, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
  it('pendiente → datos para la pantalla, sin ids ni quién invitó', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [fila()] });
    const res = mockRes();
    await getInvitacionPorToken({ params: { token: TOKEN } } as any, res);
    expect(res.status).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual(expect.objectContaining({ rol_invitado: 'admin_sucursal', empresa_nombre: 'Condominio X', sucursal_nombre: 'Torre A', crea_empresa: false }));
    expect(body.id).toBeUndefined();
    expect(body.invitado_por).toBeUndefined();
    expect(body.token_hash).toBeUndefined();
  });
});

describe('aceptarInvitacion (público)', () => {
  const TOKEN = generarToken();
  const client = { query: jest.fn(), release: jest.fn() };
  beforeEach(() => { client.query.mockReset(); client.release.mockReset(); mockPool.connect.mockResolvedValue(client); });

  const req = (over: Record<string, unknown> = {}) =>
    ({ params: { token: TOKEN }, body: { nombre: 'Ana López', password: 'secreta123' }, headers: {}, ip: '1.2.3.4', ...over }) as any;

  it('expirada → 410 y ROLLBACK, sin crear nada', async () => {
    client.query
      .mockResolvedValueOnce({})                                  // BEGIN
      .mockResolvedValueOnce({ rows: [fila({ expira_en: ayer })] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({});                                 // ROLLBACK
    const res = mockRes();
    await aceptarInvitacion(req(), res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(client.query.mock.calls.map(c => c[0])).toContain('ROLLBACK');
    expect(client.query.mock.calls.some(c => /INSERT INTO usuarios/.test(c[0]))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  it('ya aceptada → 409', async () => {
    client.query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [fila({ estado: 'aceptada' })] }).mockResolvedValueOnce({});
    const res = mockRes();
    await aceptarInvitacion(req(), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('revocada → 409 (el enlace deja de servir)', async () => {
    client.query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [fila({ estado: 'revocada' })] }).mockResolvedValueOnce({});
    const res = mockRes();
    await aceptarInvitacion(req(), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('válida → crea el usuario con rol/empresa/sucursal de la invitación, la marca aceptada y devuelve un JWT válido', async () => {
    client.query
      .mockResolvedValueOnce({})                         // BEGIN
      .mockResolvedValueOnce({ rows: [fila()] })         // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] })               // usuario existente
      .mockResolvedValueOnce({ rows: [{ id: 'u-new', nombre: 'Ana López', email: 'nuevo@sg.com', rol: 'admin_sucursal', sucursal_id: 'suc-1', empresa_id: 'emp-1', idioma: 'es', tema: 'dark' }] }) // INSERT usuarios
      .mockResolvedValueOnce({})                         // UPDATE invitaciones
      .mockResolvedValueOnce({});                        // COMMIT
    mockPool.query.mockResolvedValueOnce({});            // INSERT refresh_tokens (emitirSesion)
    const res = mockRes();
    await aceptarInvitacion(req(), res);

    const sqls = client.query.mock.calls.map(c => c[0]);
    expect(sqls).toContain('COMMIT');
    expect(sqls.some(s => /INSERT INTO empresas/.test(s))).toBe(false); // empresa ya existía
    const insertUsuario = client.query.mock.calls.find(c => /INSERT INTO usuarios/.test(c[0]))!;
    expect(insertUsuario[1]).toEqual(['Ana López', 'nuevo@sg.com', 'secreta123', 'admin_sucursal', 'suc-1', 'emp-1']);
    const update = client.query.mock.calls.find(c => /UPDATE invitaciones SET estado = 'aceptada'/.test(c[0]))!;
    expect(update[1]).toEqual(['inv-1', 'u-new', 'emp-1']);

    expect(res.cookie).toHaveBeenCalledWith('refresh_token', expect.any(String), expect.objectContaining({ httpOnly: true }));
    const body = res.json.mock.calls[0][0];
    const payload = jwt.verify(body.token, 'test-secret') as any;
    expect(payload).toEqual(expect.objectContaining({ id: 'u-new', rol: 'admin_sucursal', sucursal_id: 'suc-1', empresa_id: 'emp-1' }));
    expect(body.usuario).toEqual(expect.objectContaining({ email: 'nuevo@sg.com', rol: 'admin_sucursal' }));
  });

  it('admin_empresa de empresa nueva: crea la empresa dentro de la misma transacción', async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [fila({ rol_invitado: 'admin_empresa', empresa_id: null, empresa_nombre: 'Residencial Sur', sucursal_id: null, empresa_nombre_actual: null })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'emp-new' }] })   // INSERT empresas
      .mockResolvedValueOnce({ rows: [{ id: 'u-new', nombre: 'Ana López', email: 'nuevo@sg.com', rol: 'admin_empresa', sucursal_id: null, empresa_id: 'emp-new' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    mockPool.query.mockResolvedValueOnce({});
    const res = mockRes();
    await aceptarInvitacion(req(), res);
    const insertEmpresa = client.query.mock.calls.find(c => /INSERT INTO empresas/.test(c[0]))!;
    expect(insertEmpresa[1]).toEqual(['Residencial Sur']);
    const insertUsuario = client.query.mock.calls.find(c => /INSERT INTO usuarios/.test(c[0]))!;
    expect(insertUsuario[1]).toEqual(['Ana López', 'nuevo@sg.com', 'secreta123', 'admin_empresa', null, 'emp-new']);
    const payload = jwt.verify(res.json.mock.calls[0][0].token, 'test-secret') as any;
    expect(payload.empresa_id).toBe('emp-new');
  });

  it('password corta → 400 sin tocar la base', async () => {
    const res = mockRes();
    await aceptarInvitacion(req({ body: { nombre: 'Ana', password: '123' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });
});

describe('revocarInvitacion y alcance de listado', () => {
  it('revoca una pendiente dentro del alcance', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [fila()] })                                   // cargarEnAlcance
      .mockResolvedValueOnce({ rows: [{ estado: 'revocada', revocada_en: new Date() }] }); // UPDATE
    const res = mockRes();
    await revocarInvitacion({ user: ADMIN_E, params: { id: 'inv-1' } } as any, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].estado).toBe('revocada');
    // El alcance del admin_empresa filtra por su empresa, no por el id que venga.
    expect(mockPool.query.mock.calls[0][0]).toMatch(/i\.empresa_id = \$1/);
    expect(mockPool.query.mock.calls[0][1]).toEqual(['emp-1', 'inv-1']);
  });

  it('fuera del alcance → 404 (no se revela que existe)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await revocarInvitacion({ user: ADMIN_E, params: { id: 'inv-de-otra-empresa' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('ya aceptada → 409', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [fila({ estado: 'aceptada' })] });
    const res = mockRes();
    await revocarInvitacion({ user: ADMIN_E, params: { id: 'inv-1' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('owner lista sólo invitaciones de admin_empresa; admin_empresa sólo las de su empresa', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await getInvitaciones({ user: OWNER } as any, mockRes());
    expect(mockPool.query.mock.calls[0][0]).toMatch(/i\.rol_invitado = 'admin_empresa'/);

    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await getInvitaciones({ user: ADMIN_E } as any, mockRes());
    expect(mockPool.query.mock.calls[1][0]).toMatch(/i\.rol_invitado = 'admin_sucursal' AND i\.empresa_id = \$1/);
    expect(mockPool.query.mock.calls[1][1]).toEqual(['emp-1']);
  });

  it('admin_sucursal no tiene alcance (403)', async () => {
    const res = mockRes();
    await getInvitaciones({ user: { ...ADMIN_E, rol: 'admin_sucursal', sucursal_id: 'suc-1' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
