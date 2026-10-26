/**
 * I-12 · Los intentos bloqueados por límite de tasa también quedan auditados — SCRUM-125 / SCRUM-180
 *
 * Componentes: Express (app.ts) → limitadores (middleware/limitadores.ts) → controllers → Postgres real (`audit_logs`). Sin mocks.
 * Condición: los topes se bajan por variables de entorno ANTES de cargar la app, para poder agotarlos en una prueba.
 * Resultado esperado:
 *   - login: 429 por cuenta y por IP, con el correo intentado, la IP y el nombre del límite en `datos_nuevos`;
 *   - los límites nuevos por usuario (solicitudes, chat, tarjeta, comprobantes): 429 con la acción de la ruta, la
 *     persona y la IP; el cupo es de la PERSONA (otro residente desde la misma IP no se ve afectado);
 *   - todas las filas llevan `status_code = 429`.
 */
process.env.RATE_LIMIT_LOGIN_MAX = '4';
process.env.RATE_LIMIT_LOGIN_CUENTA_MAX = '2';
process.env.RATE_LIMIT_TICKET_CREAR_MAX = '2';
process.env.RATE_LIMIT_TICKET_MENSAJE_MAX = '3';
process.env.RATE_LIMIT_PAGO_TARJETA_MAX = '2';
process.env.RATE_LIMIT_PAGO_TRANSFERENCIA_MAX = '2';

import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer, PASSWORD } from '../helpers/auth';

let fx: Fixtures;
const previoTarjeta = process.env.PAGOS_TARJETA_SIMULADA;
const tokens: Record<string, string> = {};
beforeAll(async () => {
  process.env.PAGOS_TARJETA_SIMULADA = 'true';
  fx = await sembrar();
  // Las sesiones se abren ANTES de los casos de login fallido: esos agotan el cupo de fallos de la IP de pruebas (4 por ventana).
  for (const k of ['resA1', 'resA2', 'resB1', 'agenteA1']) {
    const s = await login(app, fx.email[k]);
    expect(s.status).toBe(200);
    tokens[k] = s.token!;
  }
});
afterAll(async () => {
  if (previoTarjeta === undefined) delete process.env.PAGOS_TARJETA_SIMULADA; else process.env.PAGOS_TARJETA_SIMULADA = previoTarjeta;
  await cerrarPool();
});

const uid = () => randomUUID().slice(0, 8);
const hoy = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

/** Espera (la fila se escribe al terminar la respuesta, sin esperar) a que haya al menos `n` filas que cumplan el filtro. */
const filas = async (sql: string, params: unknown[], n = 1) => {
  const limite = Date.now() + 3000;
  let r: any[] = [];
  do {
    r = await q(sql, params);
    if (r.length >= n) return r;
    await new Promise(res => setTimeout(res, 50));
  } while (Date.now() < limite);
  return r;
};

describe('I-12 login: los bloqueos por límite quedan auditados', () => {
  it('por cuenta: el 3.er fallo seguido es 429 y queda en la bitácora con el correo, la IP y el límite', async () => {
    const correo = fx.email.agenteA1;
    const intento = () => request(app).post('/api/auth/login').send({ email: correo, password: 'Incorrecta#1' });
    expect((await intento()).status).toBe(401);
    expect((await intento()).status).toBe(401);
    const bloqueado = await intento();
    expect(bloqueado.status).toBe(429);

    const f = await filas(
      `SELECT usuario_id, ip_address, status_code, datos_nuevos FROM audit_logs
        WHERE accion = 'LOGIN' AND status_code = 429 AND datos_nuevos->>'email' = $1`, [correo]);
    expect(f).toHaveLength(1);
    expect(f[0].ip_address).toBeTruthy();
    expect(f[0].datos_nuevos).toMatchObject({ email: correo, limite: 'login-cuenta' });
    expect(JSON.stringify(f[0].datos_nuevos)).not.toContain('Incorrecta');          // la contraseña jamás
    // Los dos fallos previos (401) también están, con el mismo correo.
    const previos = await filas(`SELECT 1 FROM audit_logs WHERE accion = 'LOGIN' AND status_code = 401 AND datos_nuevos->>'email' = $1`, [correo], 2);
    expect(previos).toHaveLength(2);
  });

  it('por IP: varios correos distintos desde el mismo origen terminan en 429 con el límite «login-ip»', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 6; i++) {
      estados.push((await request(app).post('/api/auth/login').send({ email: `nadie.${uid()}@inttest.local`, password: 'Incorrecta#1' })).status);
    }
    expect(estados).toContain(429);
    const f = await filas(`SELECT datos_nuevos FROM audit_logs WHERE accion = 'LOGIN' AND status_code = 429 AND datos_nuevos->>'limite' = 'login-ip'`, []);
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f[0].datos_nuevos.email).toMatch(/^nadie\./);
  });
});

describe('I-12 límites por usuario nuevos (solicitudes, chat, tarjeta, comprobantes)', () => {
  const bloqueos = (accion: string, usuarioId: string) =>
    filas(`SELECT usuario_id, ip_address, status_code, datos_nuevos FROM audit_logs WHERE accion = $1 AND usuario_id = $2 AND status_code = 429`, [accion, usuarioId]);

  it('crear solicitudes: 2 pasan y la 3.ª es 429 auditada con la persona; otro residente no se ve afectado', async () => {
    const res = { token: tokens.resA1 };
    const otro = { token: tokens.resA2 };
    const crear = (t?: string) => request(app).post('/api/tickets').set(bearer(t)).send({ tipo: 'otro', titulo: `LIM ${uid()}`, mensaje: 'prueba' });
    expect((await crear(res.token)).status).toBe(201);
    expect((await crear(res.token)).status).toBe(201);
    const tercero = await crear(res.token);
    expect(tercero.status).toBe(429);
    expect(tercero.body.error).toMatch(/Demasiadas solicitudes/);

    const f = await bloqueos('TICKET_CREADO', fx.usuarios.resA1);
    expect(f).toHaveLength(1);
    expect(f[0].ip_address).toBeTruthy();
    expect(f[0].datos_nuevos).toMatchObject({ limite: 'ticket-crear-usuario' });

    // El cupo es de la persona, no de la IP: el otro residente (misma IP de pruebas) sigue pudiendo.
    expect((await crear(otro.token)).status).toBe(201);
  });

  it('chat de una solicitud: 3 mensajes por minuto y el 4.º es 429 auditado', async () => {
    const res = { token: tokens.resB1 };
    const t = await request(app).post('/api/tickets').set(bearer(res.token)).send({ tipo: 'otro', titulo: `LIM chat ${uid()}`, mensaje: 'hola' });
    expect(t.status).toBe(201);
    const enviar = () => request(app).post(`/api/tickets/${t.body.id}/mensajes`).set(bearer(res.token)).send({ mensaje: 'otro más' });
    const estados = [(await enviar()).status, (await enviar()).status, (await enviar()).status, (await enviar()).status];
    expect(estados.slice(0, 3).every(s => s === 201)).toBe(true);
    expect(estados[3]).toBe(429);
    const f = await bloqueos('TICKET_MENSAJE_ENVIADO', fx.usuarios.resB1);
    expect(f[0].datos_nuevos).toMatchObject({ limite: 'ticket-mensaje-usuario' });
  });

  it('pago con tarjeta y comprobantes de transferencia: tope por persona, bloqueos auditados', async () => {
    const res = { token: tokens.resA1 };
    await q(`UPDATE residentes SET saldo_pendiente = 500, estado_pago = 'mora' WHERE id = $1`, [fx.residentes.A1]);
    const tarjeta = () => request(app).post('/api/pagos/tarjeta').set(bearer(res.token)).send({ monto: 5, ultimos4: '4444', titular: 'ANA' });
    expect([(await tarjeta()).status, (await tarjeta()).status]).toEqual([201, 201]);
    expect((await tarjeta()).status).toBe(429);
    expect((await bloqueos('PAGO_TARJETA_SIMULADO', fx.usuarios.resA1))[0].datos_nuevos).toMatchObject({ limite: 'pago-tarjeta-usuario' });

    const trf = () => request(app).post('/api/pagos/transferencia').set(bearer(res.token))
      .send({ monto: 20, referencia: `LIM-${uid()}`, banco: 'Banco Industrial', fecha_transferencia: hoy() });
    expect([(await trf()).status, (await trf()).status]).toEqual([201, 201]);
    expect((await trf()).status).toBe(429);
    expect((await bloqueos('PAGO_TRANSFERENCIA_ENVIADA', fx.usuarios.resA1))[0].datos_nuevos).toMatchObject({ limite: 'pago-transferencia-usuario' });
  });

  it('todos los bloqueos de esta prueba tienen status 429 y IP (la migración no dejó filas a medias)', async () => {
    const r = await uno<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_logs WHERE datos_nuevos->>'limite' IS NOT NULL AND (status_code <> 429 OR ip_address IS NULL)`);
    expect(r!.n).toBe(0);
  });
});
