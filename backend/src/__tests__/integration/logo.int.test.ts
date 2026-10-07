/**
 * I-10 · Logo de la empresa como archivo — SCRUM-115 / H12
 *
 * Componentes: Express (app.ts, límites de cuerpo) → POST/PUT /api/empresas → empresas.controller → Postgres real
 *   (columna `empresas.logo_url`, migrada de VARCHAR(500) a TEXT por init.sql). Sin mocks.
 * Resultado esperado:
 *   - la columna es TEXT y tiene el CHECK de tamaño;
 *   - una imagen PNG/JPG/WebP pequeña como data URI se guarda y se devuelve tal cual; una URL http(s) sigue sirviendo;
 *   - SVG, otros esquemas (javascript:), base64 roto o una imagen de más de 200 KB → 400 con el mensaje del logo;
 *   - un cuerpo de más de 400 KB → 413 (el margen mayor es solo para /api/empresas);
 *   - solo el owner puede (los demás roles → 403).
 */
import request from 'supertest';
import app from '../../app';
import { uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';

let fx: Fixtures;
beforeAll(async () => { fx = await sembrar(); });
afterAll(cerrarPool);

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const dataUri = (tipo: string, bytes: number) => `data:image/${tipo};base64,${Buffer.alloc(bytes, 7).toString('base64')}`;

describe('I-10 migración', () => {
  it('logo_url es TEXT (cabe una imagen) y tiene el CHECK de tamaño', async () => {
    const col = await uno<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'empresas' AND column_name = 'logo_url'`);
    expect(col!.data_type).toBe('text');
    const chk = await uno<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'empresas_logo_url_largo_chk'`);
    expect(chk!.n).toBe(1);
  });
});

describe('I-10 subir el logo', () => {
  it('acepta un PNG pequeño como archivo y lo devuelve igual; luego se puede reemplazar por una URL', async () => {
    const owner = await login(app, fx.email.owner);
    const crear = await request(app).post('/api/empresas').set(bearer(owner.token)).send({ nombre: `INT Logo ${fx.sufijo}`, logo_url: PNG_1PX });
    expect(crear.status).toBe(201);
    expect(crear.body.logo_url).toBe(PNG_1PX);
    const fila = await uno<{ logo_url: string }>('SELECT logo_url FROM empresas WHERE id = $1', [crear.body.id]);
    expect(fila!.logo_url).toBe(PNG_1PX);

    const url = await request(app).put(`/api/empresas/${crear.body.id}`).set(bearer(owner.token)).send({ logo_url: 'https://cdn.ejemplo.com/logo.png' });
    expect(url.status).toBe(200);
    expect(url.body.logo_url).toBe('https://cdn.ejemplo.com/logo.png');

    for (const tipo of ['jpeg', 'webp']) {
      const r = await request(app).put(`/api/empresas/${crear.body.id}`).set(bearer(owner.token)).send({ logo_url: dataUri(tipo, 5_000) });
      expect([tipo, r.status]).toEqual([tipo, 200]);
    }
  });

  it('editar sin mandar logo_url lo conserva; mandarlo vacío o null lo quita', async () => {
    const owner = await login(app, fx.email.owner);
    const e = await request(app).post('/api/empresas').set(bearer(owner.token)).send({ nombre: `INT Logo quitar ${fx.sufijo}`, logo_url: PNG_1PX });
    const solo = await request(app).put(`/api/empresas/${e.body.id}`).set(bearer(owner.token)).send({ nombre: `INT Logo quitar 2 ${fx.sufijo}` });
    expect(solo.status).toBe(200);
    expect(solo.body.logo_url).toBe(PNG_1PX);
    const vacio = await request(app).put(`/api/empresas/${e.body.id}`).set(bearer(owner.token)).send({ logo_url: '' });
    expect(vacio.status).toBe(200);
    expect(vacio.body.logo_url).toBeNull();
    await request(app).put(`/api/empresas/${e.body.id}`).set(bearer(owner.token)).send({ logo_url: PNG_1PX });
    const nulo = await request(app).put(`/api/empresas/${e.body.id}`).set(bearer(owner.token)).send({ logo_url: null });
    expect(nulo.body.logo_url).toBeNull();
    expect(nulo.body.nombre).toBe(`INT Logo quitar 2 ${fx.sufijo}`);        // lo demás no se tocó
  });

  it('rechaza SVG, esquemas peligrosos, base64 roto y lo que pesa más de 200 KB', async () => {
    const owner = await login(app, fx.email.owner);
    const malos: Array<[string, string]> = [
      ['svg', 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+'],
      ['javascript', 'javascript:alert(1)'],
      ['data html', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
      ['base64 roto', 'data:image/png;base64,@@@no-es-base64@@@'],
      ['sin cuerpo', 'data:image/png;base64,'],
      ['201 KB', dataUri('png', 201 * 1024)],
    ];
    for (const [nombre, logo_url] of malos) {
      const r = await request(app).post('/api/empresas').set(bearer(owner.token)).send({ nombre: `INT Logo malo ${nombre} ${fx.sufijo}`, logo_url });
      expect([nombre, r.status]).toEqual([nombre, 400]);
      expect(r.body.error).toMatch(/URL http\(s\) o una imagen PNG, JPG o WebP de hasta 200 KB/);
    }
    // 200 KB justos sí caben
    const limite = await request(app).post('/api/empresas').set(bearer(owner.token))
      .send({ nombre: `INT Logo límite ${fx.sufijo}`, logo_url: dataUri('png', 200 * 1024) });
    expect(limite.status).toBe(201);
  });

  it('el margen de cuerpo es 400 KB: más que eso → 413, y las otras rutas siguen en 100 KB', async () => {
    const owner = await login(app, fx.email.owner);
    const enorme = await request(app).post('/api/empresas').set(bearer(owner.token))
      .send({ nombre: 'INT enorme', logo_url: dataUri('png', 400 * 1024) });
    expect(enorme.status).toBe(413);
    const otraRuta = await request(app).post('/api/anuncios').set(bearer((await login(app, fx.email.adminSucA1)).token))
      .send({ titulo: 'x', contenido: 'y'.repeat(150 * 1024) });
    expect(otraRuta.status).toBe(413);
  });

  it('solo el owner crea o edita empresas', async () => {
    for (const quien of ['adminEmpA', 'adminSucA1', 'agenteA1', 'resA1']) {
      const s = await login(app, fx.email[quien]);
      const r = await request(app).post('/api/empresas').set(bearer(s.token)).send({ nombre: 'X', logo_url: PNG_1PX });
      expect([quien, r.status]).toEqual([quien, 403]);
    }
  });
});
