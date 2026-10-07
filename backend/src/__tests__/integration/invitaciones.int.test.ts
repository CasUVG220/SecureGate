/**
 * I-2 · Invitaciones administrativas (integración)
 *
 * Componentes: Express (app.ts) → /api/invitaciones → invitaciones.controller →
 *   Postgres real (tablas invitaciones y usuarios); supertest, sin mocks. El envío
 *   de correo usa el transporte "log" (servicio externo sustituido).
 * Condición: el admin de la empresa A invita a un nuevo admin_sucursal de A2;
 *   el invitado consulta el enlace (público) y lo acepta.
 * Datos: seed (empresa A, sucursal A2), correo único por ejecución.
 * Resultado esperado:
 *   - crear → 201 con enlace; en BD solo existe token_hash (SHA-256), nunca el token.
 *   - consultar (sin sesión) → 200 con el correo y rol invitados.
 *   - aceptar → 200 con sesión; el usuario nace con el rol y la sucursal/empresa de la
 *     invitación aunque el body traiga rol:"owner" y otra empresa/sucursal.
 *   - un segundo aceptar → 409 y no se crea otro usuario.
 */
import request from 'supertest';
import { createHash } from 'crypto';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer, PASSWORD } from '../helpers/auth';

let fx: Fixtures;
beforeAll(async () => { fx = await sembrar(); });
afterAll(cerrarPool);

describe('I-2 invitaciones: crear → consultar → aceptar', () => {
  it('flujo completo con verificación en base de datos', async () => {
    const correo = `invitado.${fx.sufijo}@inttest.local`;
    const admin = await login(app, fx.email.adminEmpA);
    expect(admin.status).toBe(200);

    // Crear
    const crear = await request(app).post('/api/invitaciones').set(bearer(admin.token))
      .send({ email: correo, rol_invitado: 'admin_sucursal', sucursal_id: fx.sucursales.A2 });
    expect(crear.status).toBe(201);
    const enlace: string = crear.body.enlace;
    const token = enlace.split('/invitacion/')[1];
    expect(token.length).toBeGreaterThanOrEqual(20);

    // BD: se guarda el hash del token y no el token
    const fila = await uno('SELECT * FROM invitaciones WHERE email = $1', [correo]);
    expect(fila.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(fila.token_hash).not.toBe(token);
    expect(JSON.stringify(fila)).not.toContain(token);
    expect(fila.estado).toBe('pendiente');

    // Consultar (público, sin Authorization)
    const consulta = await request(app).get(`/api/invitaciones/${token}`);
    expect(consulta.status).toBe(200);
    expect(consulta.body).toMatchObject({ email: correo, rol_invitado: 'admin_sucursal' });

    // Aceptar: el body intenta escalar a owner y cambiar de empresa/sucursal
    const acepta = await request(app).post(`/api/invitaciones/${token}/aceptar`).send({
      nombre: 'Invitado Integración', password: PASSWORD,
      rol: 'owner', rol_invitado: 'owner', empresa_id: fx.empresas.B, sucursal_id: fx.sucursales.B1,
    });
    expect(acepta.status).toBe(200);
    expect(typeof acepta.body.token).toBe('string');

    const u = await uno(
      `SELECT u.rol, u.sucursal_id, COALESCE(u.empresa_id, s.empresa_id) AS empresa
         FROM usuarios u LEFT JOIN sucursales s ON s.id = u.sucursal_id WHERE u.email = $1`, [correo]);
    expect(u.rol).toBe('admin_sucursal');
    expect(u.sucursal_id).toBe(fx.sucursales.A2);
    expect(u.empresa).toBe(fx.empresas.A);
    const inv = await uno('SELECT estado, usuario_id FROM invitaciones WHERE email = $1', [correo]);
    expect(inv.estado).toBe('aceptada');

    // Segundo aceptar → 409, sin segundo usuario
    const otra = await request(app).post(`/api/invitaciones/${token}/aceptar`).send({ nombre: 'Otra Persona', password: PASSWORD });
    expect(otra.status).toBe(409);
    const n = await q('SELECT count(*)::int AS n FROM usuarios WHERE email = $1', [correo]);
    expect(n[0].n).toBe(1);

    // El usuario recién creado puede iniciar sesión con la contraseña elegida
    expect((await login(app, correo)).status).toBe(200);
  });
});
