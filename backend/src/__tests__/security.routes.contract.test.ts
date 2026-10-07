/**
 * ── Por qué existe este test ─────────────────────────────────────────────────
 * La revisión de seguridad de septiembre 2026 encontró que /api/ocr y /api/cargos
 * estaban montados SIN autenticación y que media docena de rutas de
 * administración sólo pedían `verifyToken` (un residente podía descargar los CSV
 * con los DPI de los visitantes, crear y borrar residentes, etc.). Todos eran el
 * mismo error: olvidar un middleware al añadir una ruta.
 *
 * Este test recorre las rutas REALES registradas en el router (no una lista
 * escrita a mano) y las ejerce por HTTP contra el router completo:
 *
 *   1. Sin token, TODA ruta responde 401 salvo una lista blanca explícita y
 *      corta de rutas públicas. Una ruta nueva sin `verifyToken` rompe el test.
 *   2. Una matriz de roles: qué roles NO pueden entrar a qué rutas (403).
 *   3. Tokens que no son de sesión de usuario (licencia, alg distinto) no valen.
 */
import http from 'http';
import type { AddressInfo } from 'net';

process.env.JWT_SECRET = 'contract-test-secret-'.padEnd(48, 'x');

jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: jest.fn() },
}));

import '../utils/asyncErrors';
import express from 'express';
import jwt from 'jsonwebtoken';
import apiRouter from '../routes';

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

interface RutaReal { method: string; path: string }

/** Prefijo estático de un `router.use('/x', …)` a partir de su regexp de Express 4. */
const prefijoDe = (layer: { regexp: RegExp }): string => {
  const m = /^\^\\\/(.+?)\\\/\?\(\?=\\\/\|\$\)$/.exec(layer.regexp.source);
  return m ? `/${m[1].replace(/\\\//g, '/')}` : '';
};

const listarRutas = (stack: any[], prefijo = ''): RutaReal[] => {
  const out: RutaReal[] = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        out.push({ method: method.toUpperCase(), path: `${prefijo}${layer.route.path}` });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      out.push(...listarRutas(layer.handle.stack, prefijo + prefijoDe(layer)));
    }
  }
  return out;
};

const RUTAS = listarRutas((apiRouter as any).stack).map(r => ({
  ...r,
  url: `/api${r.path.replace(/:\w+/g, UUID)}`.replace(/(.)\/$/, '$1'),
}));

/**
 * Rutas que NO exigen sesión de usuario, por diseño. Cada una tiene su propio
 * mecanismo (credenciales, token de un solo uso o token de licencia). Añadir
 * una aquí es una decisión de seguridad: justifícala en el commit.
 */
const PUBLICAS = new Set([
  'POST /api/auth/login',
  'POST /api/auth/refresh',          // cookie httpOnly de refresh
  'POST /api/auth/logout',
  'GET /api/status',                 // monitoreo; ya no filtra nada de la base
  'POST /api/licencias/activar',     // código de activación de un solo dispositivo
  'POST /api/licencias/heartbeat',   // token de licencia (401 sin él)
  'GET /api/invitaciones/:token',    // token de 256 bits de un solo uso
  'POST /api/invitaciones/:token/aceptar',
]);
const claveDe = (r: RutaReal) => `${r.method} /api${r.path}`;

let server: http.Server;
let base = '';

const firmar = (rol: string, over: Record<string, unknown> = {}) =>
  jwt.sign(
    { id: UUID, nombre: 'T', email: 't@sg.com', rol, sucursal_id: rol === 'owner' || rol === 'admin_empresa' ? null : 'suc-1',
      empresa_id: rol === 'owner' ? null : 'emp-1', ...over },
    process.env.JWT_SECRET as string,
    { expiresIn: '5m' },
  );

const llamar = async (method: string, url: string, token?: string): Promise<number> => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
    },
    body: method === 'GET' ? undefined : '{}',
  });
  return res.status;
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  server = http.createServer(app);
  await new Promise<void>(r => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise(r => server.close(r)); });

describe('inventario de rutas', () => {
  it('encuentra las rutas reales (si esto falla, el recorrido está ciego y los demás tests no prueban nada)', () => {
    expect(RUTAS.length).toBeGreaterThan(90);
    expect(RUTAS.some(r => r.path === '/ocr/dpi')).toBe(true);
    expect(RUTAS.some(r => r.path === '/cargos/configuracion')).toBe(true);
  });

  it('todas las rutas públicas de la lista blanca existen (no hay entradas obsoletas)', () => {
    const reales = new Set(RUTAS.map(claveDe));
    for (const p of PUBLICAS) expect(reales.has(p)).toBe(true);
  });
});

describe('sin token', () => {
  const protegidas = RUTAS.filter(r => !PUBLICAS.has(claveDe(r)));

  it.each(protegidas.map(r => [claveDe(r), r] as const))('%s → 401', async (_n, r) => {
    expect(await llamar(r.method, r.url)).toBe(401);
  });
});

describe('tokens que no son una sesión de usuario', () => {
  const RUTA_PROTEGIDA = '/api/reservas/mis-reservas';

  it('un token de LICENCIA no sirve como sesión (antes pasaba requireStaff)', async () => {
    const licencia = jwt.sign(
      { typ: 'licencia', lic: UUID, sucursal_id: 'suc-1', empresa_id: 'emp-1', fp: 'abc' },
      process.env.JWT_SECRET as string,
    );
    expect(await llamar('GET', RUTA_PROTEGIDA, licencia)).toBe(403);
    expect(await llamar('POST', '/api/ocr/dpi', licencia)).toBe(403);
    expect(await llamar('GET', '/api/residentes', licencia)).toBe(403);
  });

  it('un token con rol inexistente no sirve', async () => {
    expect(await llamar('GET', '/api/residentes', firmar('superadmin'))).toBe(403);
  });

  it('un token firmado con otro algoritmo (HS512) no sirve: el algoritmo está fijado a HS256', async () => {
    const t = jwt.sign({ id: UUID, rol: 'owner' }, process.env.JWT_SECRET as string, { algorithm: 'HS512' });
    expect(await llamar('GET', '/api/residentes', t)).toBe(403);
  });

  it('un token "alg: none" no sirve', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const t = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: UUID, rol: 'owner' })}.`;
    expect(await llamar('GET', '/api/residentes', t)).toBe(403);
  });

  it('un token firmado con otro secreto no sirve', async () => {
    const t = jwt.sign({ id: UUID, rol: 'owner' }, 'otro-secreto'.padEnd(48, 'y'));
    expect(await llamar('GET', '/api/residentes', t)).toBe(403);
  });
});

/**
 * Matriz de roles: `negados` son los roles que deben recibir 403. Los de rol
 * superior no se prueban aquí (necesitarían datos reales); el objetivo es que
 * un rol INFERIOR nunca alcance la ruta.
 */
const PERSONAL = ['agente'];
const RESIDENTE = ['residente'];
const SOLO_ADMIN_SUC_ARRIBA = ['residente', 'agente'];
const SOLO_ADMIN_EMPRESA_ARRIBA = ['residente', 'agente', 'admin_sucursal'];
const SOLO_OWNER = ['residente', 'agente', 'admin_sucursal', 'admin_empresa'];

const MATRIZ: Array<[string, string, string[]]> = [
  // Autenticadas pero de personal: un residente no debe verlas
  ['GET', '/api/dashboard', RESIDENTE],
  ['GET', '/api/blacklist', RESIDENTE],
  ['GET', '/api/residentes', RESIDENTE],
  ['GET', `/api/residentes/${UUID}`, RESIDENTE],
  ['GET', `/api/residentes/${UUID}/pago`, RESIDENTE],
  ['GET', '/api/preautorizaciones', RESIDENTE],
  ['GET', '/api/preautorizaciones/buscar', RESIDENTE],
  ['POST', '/api/accesos', RESIDENTE],
  ['GET', '/api/accesos/activos', RESIDENTE],
  ['GET', '/api/accesos/activo', RESIDENTE],
  ['PATCH', `/api/accesos/${UUID}/salida`, RESIDENTE],
  ['PUT', `/api/accesos/${UUID}/salida`, RESIDENTE],
  ['GET', '/api/visitantes', RESIDENTE],
  ['GET', '/api/visitantes/buscar', RESIDENTE],
  ['GET', `/api/invitaciones-qr/verificar/${UUID}`, RESIDENTE],
  ['POST', '/api/ocr/dpi', RESIDENTE],
  ['POST', '/api/ocr/placa', RESIDENTE],
  ['GET', '/api/sync/garita', RESIDENTE],

  // Administración de sucursal en adelante: ni residente ni agente
  ['GET', '/api/reportes/accesos', SOLO_ADMIN_SUC_ARRIBA],
  ['GET', '/api/reportes/pagos', SOLO_ADMIN_SUC_ARRIBA],
  ['GET', '/api/reportes/estadisticas', SOLO_ADMIN_SUC_ARRIBA],
  ['POST', '/api/residentes', SOLO_ADMIN_SUC_ARRIBA],
  ['PUT', `/api/residentes/${UUID}`, SOLO_ADMIN_SUC_ARRIBA],
  ['DELETE', `/api/residentes/${UUID}`, SOLO_ADMIN_SUC_ARRIBA],
  ['POST', '/api/preautorizaciones', SOLO_ADMIN_SUC_ARRIBA],
  ['DELETE', `/api/preautorizaciones/${UUID}`, SOLO_ADMIN_SUC_ARRIBA],
  ['POST', '/api/blacklist', SOLO_ADMIN_SUC_ARRIBA],
  ['DELETE', `/api/blacklist/${UUID}`, SOLO_ADMIN_SUC_ARRIBA],
  ['GET', '/api/cargos-programados', SOLO_ADMIN_SUC_ARRIBA],
  ['POST', '/api/cargos-programados', SOLO_ADMIN_SUC_ARRIBA],
  ['PUT', `/api/cargos-programados/${UUID}`, SOLO_ADMIN_SUC_ARRIBA],
  ['DELETE', `/api/cargos-programados/${UUID}`, SOLO_ADMIN_SUC_ARRIBA],
  ['POST', `/api/cargos-programados/${UUID}/aplicar`, SOLO_ADMIN_SUC_ARRIBA],
  ['GET', `/api/cargos-programados/${UUID}/historial`, SOLO_ADMIN_SUC_ARRIBA],
  ['GET', '/api/configuracion-cargos', SOLO_ADMIN_SUC_ARRIBA],
  ['POST', '/api/configuracion-cargos', SOLO_ADMIN_SUC_ARRIBA],
  ['PUT', `/api/configuracion-cargos/${UUID}`, SOLO_ADMIN_SUC_ARRIBA],
  ['DELETE', `/api/configuracion-cargos/${UUID}`, SOLO_ADMIN_SUC_ARRIBA],
  ['GET', '/api/cargos/configuracion', SOLO_ADMIN_SUC_ARRIBA],
  ['POST', '/api/cargos/configuracion', SOLO_ADMIN_SUC_ARRIBA],
  ['PUT', `/api/cargos/configuracion/${UUID}`, SOLO_ADMIN_SUC_ARRIBA],
  ['PATCH', `/api/cargos/${UUID}/aplicar`, SOLO_ADMIN_SUC_ARRIBA],
  ['GET', '/api/usuarios', SOLO_ADMIN_SUC_ARRIBA],
  ['POST', '/api/usuarios', SOLO_ADMIN_SUC_ARRIBA],
  ['PUT', `/api/usuarios/${UUID}`, SOLO_ADMIN_SUC_ARRIBA],
  ['DELETE', `/api/usuarios/${UUID}`, SOLO_ADMIN_SUC_ARRIBA],
  ['GET', '/api/licencias', SOLO_ADMIN_SUC_ARRIBA],
  ['POST', '/api/licencias', SOLO_ADMIN_SUC_ARRIBA],
  ['PATCH', `/api/licencias/${UUID}/revocar`, SOLO_ADMIN_SUC_ARRIBA],
  ['POST', '/api/anuncios', SOLO_ADMIN_SUC_ARRIBA],
  ['GET', '/api/pagos', SOLO_ADMIN_SUC_ARRIBA],
  ['POST', '/api/pagos', SOLO_ADMIN_SUC_ARRIBA],
  ['PUT', `/api/pagos/${UUID}/aprobar`, SOLO_ADMIN_SUC_ARRIBA],
  ['PUT', `/api/pagos/${UUID}/rechazar`, SOLO_ADMIN_SUC_ARRIBA],

  // Administración de empresa en adelante
  ['GET', '/api/sucursales', SOLO_ADMIN_EMPRESA_ARRIBA],
  ['POST', '/api/sucursales', SOLO_ADMIN_EMPRESA_ARRIBA],
  ['PUT', `/api/sucursales/${UUID}`, SOLO_ADMIN_EMPRESA_ARRIBA],
  ['DELETE', `/api/sucursales/${UUID}`, SOLO_ADMIN_EMPRESA_ARRIBA],
  ['POST', `/api/sucursales/${UUID}/admin`, SOLO_ADMIN_EMPRESA_ARRIBA],
  ['GET', `/api/empresas/${UUID}/stats`, SOLO_ADMIN_EMPRESA_ARRIBA],
  ['GET', '/api/invitaciones', SOLO_ADMIN_EMPRESA_ARRIBA],
  ['POST', '/api/invitaciones', SOLO_ADMIN_EMPRESA_ARRIBA],

  // Sólo el owner
  ['GET', '/api/empresas', SOLO_OWNER],
  ['POST', '/api/empresas', SOLO_OWNER],
  ['PUT', `/api/empresas/${UUID}`, SOLO_OWNER],
  ['DELETE', `/api/empresas/${UUID}`, SOLO_OWNER],
  ['POST', `/api/empresas/${UUID}/admin`, SOLO_OWNER],
  ['PATCH', `/api/empresas/${UUID}/suspender`, SOLO_OWNER],
  ['PATCH', `/api/empresas/${UUID}/reactivar`, SOLO_OWNER],
  ['POST', `/api/empresas/${UUID}/eliminar-definitivo`, SOLO_OWNER],
  ['GET', '/api/audit-logs', SOLO_OWNER],
  ['POST', '/api/admin/ejecutar-revision-mora', SOLO_OWNER],
  ['POST', '/api/admin/ejecutar-recordatorios-reservas', SOLO_OWNER],
  ['POST', '/api/admin/ejecutar-expiracion-invitaciones', SOLO_OWNER],
];

describe('matriz de roles', () => {
  const casos = MATRIZ.flatMap(([method, url, negados]) => negados.map(rol => [method, url, rol] as const));

  it.each(casos)('%s %s como %s → 403', async (method, url, rol) => {
    expect(await llamar(method, url, firmar(rol))).toBe(403);
  });

  it('todas las rutas de la matriz existen de verdad (una ruta renombrada no debe dejar el test en falso)', () => {
    const reales = new Set(RUTAS.map(r => `${r.method} ${r.url}`));
    const faltan = MATRIZ.map(([m, u]) => `${m} ${u}`).filter(k => !reales.has(k));
    expect(faltan).toEqual([]);
  });

  it('los roles de personal SÍ alcanzan las rutas de personal (el guard no bloquea de más)', async () => {
    // Con la base mockeada vacía responde 404/200/etc.; lo que importa es que no sea 401/403.
    for (const rol of PERSONAL) {
      const s = await llamar('GET', '/api/residentes', firmar(rol));
      expect([401, 403]).not.toContain(s);
    }
  });
});
