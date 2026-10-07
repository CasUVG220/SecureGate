/**
 * I-13 · El límite general por IP audita los bloqueos SIN inundar la base — SCRUM-125 / SCRUM-180
 *
 * Componentes: Express (app.ts) → limitador general (middleware/limitadores.ts, coalescerAuditoriaMs) → Postgres real (`audit_logs`).
 * Condición: tope general de 8 peticiones, bajado ANTES de cargar la app. Es un límite anónimo y muy expuesto: una inundación de
 *   peticiones bloqueadas no debe convertirse en una inundación de escrituras, así que se audita UNA fila por IP y por minuto.
 * Resultado esperado:
 *   - al pasarse del tope todas las respuestas son 429, pero hay una sola fila `LIMITE_TASA_GENERAL` (IP, status 429, límite «general-ip»);
 *   - pasado el minuto, el siguiente bloqueo escribe otra fila que lleva la cuenta de los intentos que se callaron;
 *   - `/health` (Docker) no gasta cupo.
 */
process.env.RATE_LIMIT_GENERAL_MAX = '8';

import request from 'supertest';
import app from '../../app';
import { q, cerrarPool } from '../helpers/db';

afterAll(cerrarPool);

const filas = async (n: number) => {
  const limite = Date.now() + 3000;
  let r: any[] = [];
  do {
    r = await q(`SELECT usuario_id, ip_address, status_code, datos_nuevos FROM audit_logs WHERE accion = 'LIMITE_TASA_GENERAL' ORDER BY created_at, id`);
    if (r.length >= n) return r;
    await new Promise(res => setTimeout(res, 50));
  } while (Date.now() < limite);
  return r;
};

describe('I-13 límite general por IP', () => {
  it('/health no gasta cupo', async () => {
    for (let i = 0; i < 20; i++) expect((await request(app).get('/health')).status).toBe(200);
  });

  it('pasado el tope todo es 429, pero se audita UNA fila por IP y minuto', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 14; i++) estados.push((await request(app).get('/api/status')).status);
    expect(estados.filter(s => s === 429).length).toBeGreaterThanOrEqual(5);
    expect(estados.slice(0, 8).every(s => s !== 429)).toBe(true);

    const f = await filas(1);
    expect(f).toHaveLength(1);                                       // 6 bloqueos, una sola fila
    expect(f[0]).toMatchObject({ usuario_id: null, status_code: 429 });
    expect(f[0].ip_address).toBeTruthy();
    expect(f[0].datos_nuevos).toMatchObject({ limite: 'general-ip', intentos_callados: 0 });
  });

  it('pasado el minuto, el siguiente bloqueo escribe otra fila con la cuenta de lo que se calló', async () => {
    const antes = (await q(`SELECT 1 FROM audit_logs WHERE accion = 'LIMITE_TASA_GENERAL'`)).length;
    const ahora = Date.now();
    const reloj = jest.spyOn(Date, 'now').mockReturnValue(ahora + 61_000);
    try {
      expect((await request(app).get('/api/status')).status).toBe(429);
    } finally {
      reloj.mockRestore();
    }
    const f = await filas(antes + 1);
    expect(f.length).toBe(antes + 1);
    expect(f[f.length - 1].datos_nuevos.intentos_callados).toBeGreaterThanOrEqual(5);
  });
});
