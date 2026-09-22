/**
 * ── Hallazgos S-03, S-07, S-08 y S-09 (backend/securitytest, Sprint 8) ───────
 *  S-03  462 peticiones con UUID/fecha inválidos, byte NUL, texto largo o
 *        parámetros repetidos (?a=1&a=2) devolvían HTTP 500.
 *  S-07  eliminar-definitivo: el límite era por IP y los intentos bloqueados
 *        (429) no quedaban en audit_logs.
 *  S-08  Sin Cache-Control: no-store en login ni en datos personales (ZAP 10049).
 *  S-09  404 HTML de Express («Cannot GET») que además pisaba el CSP (ZAP 10055),
 *        y Permissions-Policy ausente (ZAP 10063).
 */
import http from 'http';
import type { AddressInfo } from 'net';

jest.mock('../db/pool', () => ({ __esModule: true, default: { query: jest.fn().mockResolvedValue({ rows: [] }), connect: jest.fn() } }));

import express from 'express';
import helmet from 'helmet';
import pool from '../db/pool';
import { serverError, soloQueryTexto, esErrorDeDatos } from '../utils/http';
import { cabecerasApi, noEncontrado } from '../middleware/hardening.middleware';
import { eliminarLimiter } from '../routes/empresas.routes';

const mockPool = pool as unknown as { query: jest.Mock };
const res = () => { const r: any = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r; };

describe('S-03 · errores de datos del cliente ya no son 500', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['22P02', 'UUID/número inválido'], ['22007', 'fecha inválida'], ['22008', 'fecha fuera de rango'],
    ['22001', 'texto demasiado largo (varchar)'], ['22021', 'byte NUL en el texto'],
    ['23514', 'CHECK (enum inválido)'], ['23503', 'FK a un id que no existe'], ['23502', 'NOT NULL'],
  ])('%s (%s) → 400 sin filtrar el mensaje de Postgres', (code) => {
    const r = res();
    serverError(r, { code, message: 'invalid input syntax for type uuid: "x" in relation residentes' }, 'Error genérico');
    expect(r.status).toHaveBeenCalledWith(400);
    expect(JSON.stringify(r.json.mock.calls[0][0])).not.toMatch(/uuid|relation|residentes/);
    expect(console.error).not.toHaveBeenCalled();          // no es un fallo del servidor
  });

  it('23505 (duplicado) → 409', () => {
    const r = res();
    serverError(r, { code: '23505' }, 'x');
    expect(r.status).toHaveBeenCalledWith(409);
  });

  it('un fallo real (conexión caída, bug) sigue siendo 500 y se registra', () => {
    const r = res();
    serverError(r, { code: '57P01', message: 'terminating connection' }, 'Error al obtener X');
    expect(r.status).toHaveBeenCalledWith(500);
    expect(r.json).toHaveBeenCalledWith({ error: 'Error al obtener X' });
    expect(console.error).toHaveBeenCalled();
  });

  it('sin código o con un código de otra clase no se confunde con dato inválido', () => {
    expect(esErrorDeDatos(undefined)).toBe(false);
    expect(esErrorDeDatos('42P01')).toBe(false);   // tabla inexistente = bug nuestro
    expect(esErrorDeDatos('40001')).toBe(false);
  });

  it('soloQueryTexto rechaza arreglos y objetos (HPP) y deja pasar texto', () => {
    const casos: Array<[Record<string, unknown>, boolean]> = [
      [{ dpi: 'abc' }, true], [{}, true], [{ dpi: ['a', 'b'] }, false], [{ dpi: { x: '1' } }, false], [{ a: 'x', b: ['y'] }, false],
    ];
    for (const [query, pasa] of casos) {
      const r = res(); const next = jest.fn();
      soloQueryTexto({ query } as any, r, next);
      expect(next).toHaveBeenCalledTimes(pasa ? 1 : 0);
      if (!pasa) expect(r.status).toHaveBeenCalledWith(400);
    }
  });
});

describe('S-08 / S-09 · cabeceras y 404 (servidor HTTP real)', () => {
  let server: http.Server; let base = '';
  beforeAll(async () => {
    const app = express();
    app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
    app.use(cabecerasApi);
    app.get('/api/x', (_q, r) => { r.json({ ok: true }); });
    app.get('/health', (_q, r) => { r.json({ ok: true }); });
    app.use(noEncontrado);
    server = http.createServer(app);
    await new Promise<void>(r => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise(r => server.close(r)); });

  it('todas las respuestas (incluido un 404 fuera de /api) llevan Cache-Control: no-store', async () => {
    for (const p of ['/api/x', '/nada']) {
      const r = await fetch(`${base}${p}`);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.headers.get('pragma')).toBe('no-cache');
    }
  });

  it('todas las respuestas llevan Permissions-Policy', async () => {
    for (const p of ['/api/x', '/health', '/nada']) {
      expect((await fetch(`${base}${p}`)).headers.get('permissions-policy')).toMatch(/camera=\(\)/);
    }
  });

  it('una ruta inexistente es JSON 404, sin «Cannot GET» ni nombrar Express', async () => {
    const r = await fetch(`${base}/api/no-existe`);
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toMatch(/json/);
    const texto = await r.text();
    expect(texto).not.toMatch(/Cannot GET|express|<html/i);
  });

  it('el 404 conserva el CSP completo de helmet (con frame-ancestors), no el mínimo de Express', async () => {
    const csp = (await fetch(`${base}/robots.txt`)).headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/form-action 'self'/);
  });
});

describe('S-07 · límite de eliminar-definitivo por usuario y con auditoría de los bloqueos', () => {
  let server: http.Server; let base = '';
  beforeAll(async () => {
    process.env.RATE_LIMIT_ELIMINAR_MAX = '5';
    const app = express();
    app.use((req, _r, next) => { (req as any).user = { id: req.headers['x-test-user'], sucursal_id: null }; next(); });
    app.post('/api/empresas/:id/eliminar-definitivo', eliminarLimiter, (_q, r) => { r.status(403).json({ error: 'Contraseña incorrecta' }); });
    server = http.createServer(app);
    await new Promise<void>(r => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise(r => server.close(r)); });
  const intento = (usuario: string) => fetch(`${base}/api/empresas/3f2504e0-4f89-11d3-9a0c-0305e82c3301/eliminar-definitivo`, { method: 'POST', headers: { 'x-test-user': usuario } });

  it('5 intentos llegan al controlador y el 6.º es 429', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 6; i++) estados.push((await intento('owner-1')).status);
    expect(estados).toEqual([403, 403, 403, 403, 403, 429]);
  });

  it('el bloqueo (429) deja fila en audit_logs con status 429 y el usuario', async () => {
    mockPool.query.mockClear();
    const r = await intento('owner-1');
    expect(r.status).toBe(429);
    await new Promise(r2 => setTimeout(r2, 20));
    const insert = mockPool.query.mock.calls.find(c => /INSERT INTO audit_logs/.test(c[0]));
    expect(insert).toBeDefined();
    const params = insert![1] as unknown[];
    expect(params[0]).toBe('owner-1');
    expect(params[1]).toBe('EMPRESA_ELIMINADA_DEFINITIVO');
    expect(params[3]).toBe('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
    expect(params[7]).toBe(429);
  });

  it('el cupo es por usuario: otro owner desde la MISMA IP no queda bloqueado', async () => {
    expect((await intento('owner-2')).status).toBe(403);
  });
});
