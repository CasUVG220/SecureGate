/**
 * I-27 · Formulario «Pedir demo» del landing (POST /api/contacto)
 *
 * Componentes: Express (app.ts) → limitador por IP → auditLog → campo trampa → express-validator → contacto.controller →
 *   Postgres real (`contactos`, `audit_logs`). Sin mocks.
 * Condición: el tope por IP se baja ANTES de cargar la app, para poder agotarlo aquí. Todas las peticiones de este archivo
 *   salen de la misma IP y cuentan para ese tope, así que se llevan contadas.
 * Resultado esperado:
 *   - válido → 201 con un aviso fijo (sin el correo enviado ni ningún otro), fila normalizada en `contactos` y fila de
 *     auditoría con el id y el tramo, sin datos personales;
 *   - inválido → 400 con el error de cada campo en español, sin guardar nada;
 *   - campo trampa → 201 idéntico al éxito, sin guardar nada, auditado como `honeypot`;
 *   - pasado el tope → 429, auditado con el nombre del límite, sin guardar.
 */
const MAX = 25;
process.env.RATE_LIMIT_CONTACTO_MAX = String(MAX);

import request from 'supertest';
import { randomBytes } from 'crypto';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';

afterAll(async () => { await cerrarPool(); });

/**
 * La auditoría se escribe al terminar la respuesta y sin esperar (ver helpers/audit.ts): se consulta hasta que aparezca
 * la fila. Cada consulta filtra por algo propio de su caso, nunca por «la más reciente».
 */
const esperarUno = async (sql: string, params: unknown[] = []) => {
  const limite = Date.now() + 3000;
  let fila = await uno(sql, params);
  while (!fila && Date.now() < limite) {
    await new Promise(r => setTimeout(r, 50));
    fila = await uno(sql, params);
  }
  return fila;
};

const uid = () => randomBytes(4).toString('hex');
let usadas = 0;
const enviar = (b: unknown, tipo = 'application/json') => {
  usadas += 1;
  const r = request(app).post('/api/contacto').set('Content-Type', tipo);
  return typeof b === 'string' ? r.send(b) : r.send(b as object);
};
const valido = (extra: object = {}) => ({
  nombre: '  Ana   López ', residencial: `Residencial INT ${uid()}`, hogares: '200',
  telefono: '+502 5555-1234', email: `Contacto.${uid()}@IntTest.local`, mensaje: 'Somos 180 casas,\r\ncon dos entradas.', ...extra,
});

describe('I-27 contacto · válido', () => {
  it('201 con aviso fijo, guarda normalizado y audita sin datos personales', async () => {
    const datos = valido();
    const r = await enviar(datos);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ ok: true, mensaje: expect.any(String) });
    expect(JSON.stringify(r.body)).not.toMatch(/@/);                       // ningún correo en la respuesta

    const fila = await uno(`SELECT * FROM contactos WHERE residencial = $1`, [datos.residencial]);
    expect(fila).toMatchObject({
      nombre: 'Ana López', hogares: '200', telefono: '+50255551234',
      email: datos.email.toLowerCase(), mensaje: 'Somos 180 casas,\ncon dos entradas.',
    });
    expect(fila!.ip_origen).toBeTruthy();

    const aud = await esperarUno(
      `SELECT status_code, tabla_afectada, datos_nuevos, ip_address FROM audit_logs
        WHERE accion = 'CONTACTO_RECIBIDO' AND datos_nuevos->>'contacto_id' = $1`, [fila!.id]);
    expect(aud).toMatchObject({ status_code: 201, tabla_afectada: 'contactos', datos_nuevos: { contacto_id: fila!.id, hogares: '200' } });
    expect(aud!.ip_address).toBeTruthy();
    expect(JSON.stringify(aud!.datos_nuevos)).not.toMatch(/Ana|5555|@/);
  });

  it('el mensaje es opcional y acepta el tramo «1000+»', async () => {
    const datos = valido({ mensaje: '', hogares: '1000+' });
    expect((await enviar(datos)).status).toBe(201);
    expect(await uno(`SELECT hogares, mensaje FROM contactos WHERE residencial = $1`, [datos.residencial]))
      .toEqual({ hogares: '1000+', mensaje: null });
  });
});

describe('I-27 contacto · inválido', () => {
  it.each([
    ['nombre', { nombre: 'A' }],
    ['nombre', { nombre: '<b>Ana</b>' }],
    ['residencial', { residencial: undefined }],
    ['hogares', { hogares: '75' }],
    ['hogares', { hogares: ['200'] }],
    ['telefono', { telefono: '1234' }],
    ['telefono', { telefono: '5555-12a4' }],
    ['email', { email: 'no-es-correo' }],
    ['email', { email: 'a@b.com\r\nBcc: x@y.com' }],
    ['mensaje', { mensaje: 'x'.repeat(1001) }],
  ])('400 en %s (%j) y no guarda nada', async (campo, malo) => {
    const datos = valido(malo);
    const r = await enviar(datos);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Revisá/);
    expect(Object.keys(r.body.campos)).toContain(campo);
    expect(typeof r.body.campos[campo]).toBe('string');
    expect(await q(`SELECT 1 FROM contactos WHERE residencial = $1`, [datos.residencial ?? ''])).toHaveLength(0);
  });

  it('400 si el cuerpo no es JSON o viene vacío', async () => {
    expect((await enviar('no es json', 'text/plain')).status).toBe(400);
    const r = await enviar({});
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.campos).sort()).toEqual(['email', 'hogares', 'nombre', 'residencial', 'telefono']);
  });

  it('la bitácora registra el rechazo con los nombres de los campos, no sus valores', async () => {
    const correo = `malo.${uid()}@inttest.local`;
    const antes = await q(`SELECT id FROM audit_logs WHERE accion = 'CONTACTO_RECIBIDO' AND status_code = 400`);
    await enviar(valido({ email: correo, telefono: '12' }));
    const aud = await esperarUno(
      `SELECT status_code, datos_nuevos FROM audit_logs
        WHERE accion = 'CONTACTO_RECIBIDO' AND status_code = 400 AND NOT (id = ANY($1::uuid[]))`, [antes.map(a => a.id)]);
    expect(aud).toMatchObject({ status_code: 400, datos_nuevos: { motivo: 'invalido', campos: ['telefono'] } });
    expect(JSON.stringify(aud!.datos_nuevos)).not.toContain(correo);
  });
});

describe('I-27 contacto · campo trampa', () => {
  it('responde igual que el éxito, no guarda nada y lo deja en la bitácora', async () => {
    const humano = await enviar(valido());
    const datos = valido({ sitio_web: 'https://spam.example' });
    const robot = await enviar(datos);
    expect(robot.status).toBe(humano.status);
    expect(robot.body).toEqual(humano.body);
    expect(await q(`SELECT 1 FROM contactos WHERE residencial = $1`, [datos.residencial])).toHaveLength(0);
    const aud = await esperarUno(
      `SELECT status_code, datos_nuevos FROM audit_logs WHERE accion = 'CONTACTO_RECIBIDO' AND datos_nuevos->>'motivo' = 'honeypot'`);
    expect(aud).toMatchObject({ status_code: 201, datos_nuevos: { motivo: 'honeypot' } });
  });
});

describe('I-27 contacto · límite por IP', () => {
  it(`la petición ${MAX + 1} desde la misma IP recibe 429, no se guarda y queda auditada`, async () => {
    expect(usadas).toBeLessThan(MAX);                                     // si no, este archivo agotó el tope antes de tiempo
    while (usadas < MAX) expect((await enviar(valido())).status).toBe(201);

    const datos = valido();
    const r = await enviar(datos);
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/una hora/);
    expect(await q(`SELECT 1 FROM contactos WHERE residencial = $1`, [datos.residencial])).toHaveLength(0);

    const aud = await esperarUno(
      `SELECT status_code, tabla_afectada, datos_nuevos FROM audit_logs WHERE accion = 'CONTACTO_RECIBIDO' AND status_code = 429`);
    expect(aud).toMatchObject({ status_code: 429, tabla_afectada: 'contactos', datos_nuevos: { limite: 'contacto-ip' } });
  });
});
