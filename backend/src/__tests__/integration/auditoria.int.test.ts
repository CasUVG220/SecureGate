/**
 * I-11 · RNF-10: cada acción sensible deja usuario, fecha e IP en `audit_logs` — SCRUM-125 / SCRUM-179
 *
 * Componentes: Express (app.ts) → todas las rutas con `auditLog` → controllers → Postgres real (`audit_logs` y las tablas de
 *   cada acción). Sin mocks; el correo usa el transporte "log".
 * Condición: la tabla CASOS tiene UNA entrada por cada acción de `docs/acciones_sensibles.md`. Cada una ejecuta la acción de
 *   verdad por HTTP con el rol que corresponde (con los datos previos que necesite, sembrados directo en la base).
 * Resultado esperado, por acción:
 *   - existe una fila en `audit_logs` con esa `accion`, creada DURANTE la ejecución (fecha dentro de la ventana medida en la
 *     base, no en JS: la columna es TIMESTAMP y el reloj de Node va en otra zona, ver S-17);
 *   - lleva la IP del cliente (`ip_address`) y el `user_agent`;
 *   - lleva el usuario que la hizo (`usuario_id`) cuando hay sesión, o cuando la ruta pública sabe quién es (login, logout,
 *     aceptar una invitación); las rutas anónimas (token desconocido, activar un equipo) guardan IP y el detalle que las identifica;
 *   - `status_code` es el de la respuesta real, y las acciones que deben salir bien responden 2xx;
 *   - la prueba final comprueba que la tabla cubre TODAS las acciones del código: una acción nueva sin caso aquí la rompe.
 */
import request from 'supertest';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer, PASSWORD } from '../helpers/auth';
import { adminNuevo, activarDosPasos, totp } from '../helpers/twofa';

let fx: Fixtures;
const previoTarjeta = process.env.PAGOS_TARJETA_SIMULADA;
const sesion: Record<string, { token: string; id: string }> = {};

beforeAll(async () => {
  process.env.PAGOS_TARJETA_SIMULADA = 'true';
  fx = await sembrar();
  for (const k of ['owner', 'adminEmpA', 'adminSucA1', 'agenteA1', 'resA1']) {
    const s = await login(app, fx.email[k]);
    expect(s.status).toBe(200);
    sesion[k] = { token: s.token!, id: fx.usuarios[k] };
  }
});
afterAll(async () => {
  if (previoTarjeta === undefined) delete process.env.PAGOS_TARJETA_SIMULADA; else process.env.PAGOS_TARJETA_SIMULADA = previoTarjeta;
  await cerrarPool();
});

// ── ayudantes de datos ──────────────────────────────────────────────────────────────────────────
const uid = () => randomUUID().slice(0, 8);
const hoy = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);          // día de Guatemala
const dia = (n: number) => new Date(Date.now() - 6 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const dpiUnico = () => `AUD-DPI-${uid()}`;
const as = (k: string) => bearer(sesion[k].token);

const empresaNueva = async (extra = '') =>
  (await uno<{ id: string }>(`INSERT INTO empresas (nombre${extra ? ', ' + extra.split('=')[0] : ''}) VALUES ($1${extra ? ', ' + extra.split('=')[1] : ''}) RETURNING id`, [`AUD Empresa ${uid()}`]))!.id;
/** Una factura SaaS pendiente de una empresa nueva (insertada directo: lo que se prueba aquí es la auditoría de pagarla o anularla). */
const facturaNueva = async () => {
  const e = await empresaNueva();
  const n = (await uno<{ valor: string }>(`UPDATE saas_contadores SET valor = valor + 1 WHERE clave = 'factura_saas' RETURNING valor::text`))!.valor;
  return (await uno<{ id: string }>(
    `INSERT INTO facturas_saas (numero, empresa_id, periodo, plan_codigo, plan_nombre, dias_del_mes, dias_facturados, cuota_centavos, visitas, visitas_incluidas,
        excedente_visitas, precio_visita_extra_centavos, excedente_centavos, total_centavos, detalle, vence_en)
     VALUES ($1, $2, '2020-01', 'x', 'X', 31, 31, 1000, 0, 0, 0, 0, 0, 1000, '{}'::jsonb, CURRENT_DATE) RETURNING id`, [n, e]))!.id;
};
/** Una solicitud de alta autoservicio abierta, con el borrador indicado; devuelve el token del enlace (en la base solo vive su SHA-256). */
const solicitudNueva = async (extra: Record<string, unknown> = {}) => {
  const token = randomBytes(32).toString('base64url');
  const nombre = `AUD Alta ${uid()}`;
  await q(
    `INSERT INTO onboarding_solicitudes (email, empresa_nombre, token_hash, borrador, expira_en) VALUES ($1, $2, $3, $4::jsonb, NOW() + interval '7 days')`,
    [`aud.onb.${uid()}@inttest.local`, nombre, createHash('sha256').update(token).digest('hex'), JSON.stringify({ empresa_nombre: nombre, ...extra })]);
  return token;
};
const usuarioNuevo = async (rol: string, suc: string | null, emp: string | null) =>
  (await uno<{ id: string }>(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id, empresa_id, activo)
     VALUES ($1, $2, crypt($3, gen_salt('bf', 4)), $4, $5, $6, TRUE) RETURNING id`,
    [`AUD ${rol}`, `aud.${uid()}@inttest.local`, PASSWORD, rol, suc, emp]))!.id;
const residenteNuevo = async () => {
  const u = await usuarioNuevo('residente', fx.sucursales.A1, null);
  return (await uno<{ id: string }>(
    `INSERT INTO residentes (usuario_id, sucursal_id, numero_casa, estado_pago, saldo_pendiente) VALUES ($1, $2, $3, 'pendiente', 0) RETURNING id`,
    [u, fx.sucursales.A1, `AUD-${uid()}`]))!.id;
};
const pagoPendiente = async () =>
  (await uno<{ id: string }>(
    `INSERT INTO pagos (sucursal_id, residente_id, monto, metodo, estado, referencia, banco, registrado_por)
     VALUES ($1, $2, 125, 'transferencia', 'pendiente', $3, 'Banco Industrial', $4) RETURNING id`,
    [fx.sucursales.A1, fx.residentes.A1, `AUD-${uid()}`, fx.usuarios.resA1]))!.id;
const entradaNueva = async () => {
  const r = await request(app).post('/api/accesos').set(as('agenteA1')).send({ nombre_visitante: 'Visitante AUD', numero_dpi: dpiUnico(), residente_id: fx.residentes.A1 });
  expect(r.status).toBe(201);
  return r.body.registro.id as string;
};
const reservaNueva = async (estado: 'confirmada' | 'pendiente_aprobacion') =>
  (await uno<{ id: string }>(
    `INSERT INTO reservas_areas (area_id, residente_id, fecha, hora_inicio, hora_fin, estado)
     VALUES ($1, $2, $3, $4, '11:00', $5) RETURNING id`,
    [fx.areas.A1, fx.residentes.A1, dia(10 + Math.floor(Math.random() * 100)), `0${Math.floor(Math.random() * 9)}:00`, estado]))!.id;
const licenciaNueva = async () => {
  const codigo = `AUD${uid()}`.toUpperCase();
  const id = (await uno<{ id: string }>(
    `INSERT INTO licencias_dispositivo (sucursal_id, codigo_activacion, etiqueta, creado_por) VALUES ($1, $2, $3, $4) RETURNING id`,
    [fx.sucursales.A1, codigo, `AUD-lic-${uid()}`, fx.usuarios.adminSucA1]))!.id;
  return { id, codigo };
};
const hex64 = () => randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');

// ANPR (Sprint 10): la garita sube con sesión de agente + licencia del equipo; la licencia se activa una vez para todos los casos.
let tokenLicenciaAnpr: string | null = null;
const licenciaAnpr = async () => {
  if (!tokenLicenciaAnpr) {
    const l = await licenciaNueva();
    const r = await request(app).post('/api/licencias/activar').send({ codigo: l.codigo, fingerprint: hex64(), nombre_dispositivo: 'PC AUD ANPR' });
    expect(r.status).toBe(200);
    tokenLicenciaAnpr = r.body.token_licencia as string;
  }
  return tokenLicenciaAnpr!;
};
const garita = async (url: string, body: object) => request(app).post(url).set(as('agenteA1')).set('X-Licencia-Token', await licenciaAnpr()).send(body);
const placaUnica = () => `AUD${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
const vehiculoNuevo = async () => {
  const r = await post('adminSucA1', '/api/anpr/vehiculos', { residente_id: fx.residentes.A1, placa: placaUnica() });
  expect(r.status).toBe(201);
  return r.body as { id: string; placa: string };
};
/** Un acceso ANPR ya registrado (para la salida y la evidencia); devuelve su id_cliente y la placa. */
const accesoAnprNuevo = async () => {
  const v = await vehiculoNuevo();
  const id = randomUUID();
  const r = await garita('/api/anpr/accesos', { id_cliente: id, vehiculo_id: v.id, placa: v.placa });
  expect(r.status).toBe(201);
  return { id, placa: v.placa };
};
const JPEG_AUD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);

// ── la tabla de casos ───────────────────────────────────────────────────────────────────────────
type Resp = request.Response;
interface Caso {
  accion: string;
  /** Quién ejecuta (clave de `sesion`); null = ruta pública o sin sesión. */
  quien: string | null;
  /** ¿La fila debe traer a la persona? Por omisión, sí cuando hay `quien`. */
  persona?: boolean;
  /** ¿La respuesta debe ser 2xx? Por omisión sí; falso cuando la acción termina en rechazo a propósito (o depende de un servicio externo). */
  exito?: boolean;
  /** Variante de la misma acción en otra ruta (para el título). */
  ruta?: string;
  ejecutar: () => Promise<Resp>;
}

const post = (k: string, url: string, body: object = {}) => request(app).post(url).set(as(k)).send(body);
const put = (k: string, url: string, body: object = {}) => request(app).put(url).set(as(k)).send(body);
const patch = (k: string, url: string, body: object = {}) => request(app).patch(url).set(as(k)).send(body);
const del = (k: string, url: string) => request(app).delete(url).set(as(k));

const CASOS: Caso[] = [
  // ── Sesión y acceso ──
  { accion: 'LOGIN', quien: null, persona: true, ejecutar: async () => request(app).post('/api/auth/login').send({ email: fx.email.adminSucA1, password: PASSWORD }) },
  {
    accion: 'LOGOUT', quien: null, persona: true,
    ejecutar: async () => {
      const s = await login(app, fx.email.adminSucA1);
      return request(app).post('/api/auth/logout').set('Cookie', s.cookie!).send({});
    },
  },
  {
    accion: 'REFRESH_RECHAZADO', quien: null, persona: true, exito: false,
    ejecutar: async () => {
      const s = await login(app, fx.email.adminSucA1);
      await request(app).post('/api/auth/logout').set('Cookie', s.cookie!).send({});          // revoca el token…
      return request(app).post('/api/auth/refresh').set('Cookie', s.cookie!).send({});        // …y se intenta renovar: 401, con la persona
    },
  },

  {
    // Un refresh token ya rotado que se presenta otra vez pasada la gracia: la familia entera se cierra (SCRUM-124 / S-06).
    // Usuario propio: cerrar la familia corta también los access tokens vigentes de la persona.
    accion: 'REFRESH_REUTILIZADO', quien: null, persona: true, exito: false,
    ejecutar: async () => {
      const a = await adminNuevo(app, 'admin_sucursal', fx.sucursales.A1, null, fx.sufijo);
      const s = await login(app, a.email);
      expect((await request(app).post('/api/auth/refresh').set('Cookie', s.cookie!).send({})).status).toBe(200);   // rota el token
      await q(`UPDATE refresh_tokens SET rotado_en = NOW() - interval '5 minutes' WHERE usuario_id = $1 AND rotado_en IS NOT NULL`, [a.id]);
      return request(app).post('/api/auth/refresh').set('Cookie', s.cookie!).send({});                            // el viejo, otra vez: 401
    },
  },

  // Un residente pide una pantalla de administración: el guard de rol lo rechaza (403) y deja huella con su persona y su IP.
  { accion: 'ACCESO_DENEGADO', quien: 'resA1', exito: false, ejecutar: () => request(app).get('/api/dashboard').set(as('resA1')) },

  // ── Verificación en dos pasos (SCRUM-123) ──
  // Cada caso arma su propio administrador: activar el segundo factor de un usuario sembrado rompería los demás casos que inician sesión con él.
  { accion: 'TWOFA_INICIADO', quien: null, persona: true, ejecutar: async () => {
      const a = await adminNuevo(app, 'admin_sucursal', fx.sucursales.A1, null, fx.sufijo);
      return request(app).post('/api/auth/2fa/iniciar').set(bearer(a.token)).send({});
  } },
  { accion: 'TWOFA_ACTIVADO', quien: null, persona: true, ejecutar: async () => {
      const a = await adminNuevo(app, 'admin_sucursal', fx.sucursales.A1, null, fx.sufijo);
      const ini = await request(app).post('/api/auth/2fa/iniciar').set(bearer(a.token)).send({});
      return request(app).post('/api/auth/2fa/confirmar').set(bearer(a.token)).send({ password: PASSWORD, codigo: totp(ini.body.secreto) });
  } },
  { accion: 'TWOFA_DESACTIVADO', quien: null, persona: true, ejecutar: async () => {
      const a = await adminNuevo(app, 'admin_sucursal', fx.sucursales.A1, null, fx.sufijo);
      const d = await activarDosPasos(app, a);
      return request(app).post('/api/auth/2fa/desactivar').set(bearer(a.token)).send({ password: PASSWORD, codigo: totp(d.secreto) });
  } },
  { accion: 'TWOFA_CODIGOS_REGENERADOS', quien: null, persona: true, ejecutar: async () => {
      const a = await adminNuevo(app, 'admin_sucursal', fx.sucursales.A1, null, fx.sufijo);
      const d = await activarDosPasos(app, a);
      return request(app).post('/api/auth/2fa/codigos-recuperacion').set(bearer(a.token)).send({ codigo: totp(d.secreto) });
  } },
  { accion: 'TWOFA_VERIFICACION', quien: null, persona: true, ejecutar: async () => {
      const a = await adminNuevo(app, 'admin_sucursal', fx.sucursales.A1, null, fx.sufijo);
      const d = await activarDosPasos(app, a);
      const paso1 = await login(app, a.email);
      return request(app).post('/api/auth/2fa/verificar').send({ desafio: paso1.body.desafio, codigo: totp(d.secreto) });
  } },
  { accion: 'TWOFA_RESTABLECIDO', quien: 'adminEmpA', ejecutar: async () => {
      const a = await adminNuevo(app, 'admin_sucursal', fx.sucursales.A1, null, fx.sufijo);
      await activarDosPasos(app, a);
      return del('adminEmpA', `/api/usuarios/${a.id}/2fa`);
  } },

  // ── Empresas (owner) ──
  { accion: 'EMPRESA_CREADA', quien: 'owner', ejecutar: () => post('owner', '/api/empresas', { nombre: `AUD Alta ${uid()}` }) },
  { accion: 'EMPRESA_ACTUALIZADA', quien: 'owner', ejecutar: async () => put('owner', `/api/empresas/${await empresaNueva()}`, { nombre: `AUD Edit ${uid()}` }) },
  { accion: 'EMPRESA_ELIMINADA', quien: 'owner', ejecutar: async () => del('owner', `/api/empresas/${await empresaNueva()}`) },
  { accion: 'EMPRESA_SUSPENDIDA', quien: 'owner', ejecutar: async () => patch('owner', `/api/empresas/${await empresaNueva()}/suspender`, { motivo: 'Prueba de auditoría' }) },
  {
    accion: 'EMPRESA_REACTIVADA', quien: 'owner',
    ejecutar: async () => {
      const id = await empresaNueva();
      await q(`UPDATE empresas SET suspendida = TRUE, suspension_motivo = 'x', suspendida_en = NOW() WHERE id = $1`, [id]);
      return patch('owner', `/api/empresas/${id}/reactivar`);
    },
  },
  { accion: 'EMPRESA_ELIMINADA_DEFINITIVO', quien: 'owner', ejecutar: async () => post('owner', `/api/empresas/${await empresaNueva()}/eliminar-definitivo`, { password: PASSWORD }) },
  {
    accion: 'ADMIN_EMPRESA_ASIGNADO', quien: 'owner',
    ejecutar: async () => post('owner', `/api/empresas/${await empresaNueva()}/admin`, { usuario_id: await usuarioNuevo('agente', fx.sucursales.A1, null) }),
  },

  // ── Planes y suscripciones (T10) ──
  { accion: 'PLAN_CREADO', quien: 'owner', ejecutar: () => post('owner', '/api/planes', { codigo: `aud-${uid()}`.slice(0, 30), nombre: 'AUD plan', precio_mensual_centavos: 10000, visitas_incluidas: 100, precio_visita_extra_centavos: 10 }) },
  {
    accion: 'PLAN_ACTUALIZADO', quien: 'owner',
    ejecutar: async () => {
      const c = await post('owner', '/api/planes', { codigo: `aud-${uid()}`.slice(0, 30), nombre: 'AUD plan', precio_mensual_centavos: 10000, visitas_incluidas: 100, precio_visita_extra_centavos: 10 });
      return put('owner', `/api/planes/${c.body.id}`, { nombre: 'AUD plan editado' });
    },
  },
  { accion: 'SUSCRIPCION_ACTUALIZADA', quien: 'owner', ejecutar: async () => put('owner', `/api/empresas/${await empresaNueva()}/suscripcion`, { plan_codigo: 'basico', motivo: 'Prueba de auditoría' }) },

  // ── Facturación SaaS (T11) ──
  { accion: 'FACTURAS_SAAS_GENERADAS', quien: 'owner', ejecutar: () => post('owner', '/api/facturas-saas/generar', { mes: '2020-01' }) },
  { accion: 'FACTURAS_SAAS_REVISADAS', quien: 'owner', ejecutar: () => post('owner', '/api/facturas-saas/revisar-vencidas') },
  {
    accion: 'FACTURA_SAAS_PAGADA', quien: 'owner',
    ejecutar: async () => post('owner', `/api/facturas-saas/${await facturaNueva()}/pagar`, { metodo: 'transferencia', referencia: `BOL-${uid()}` }),
  },
  {
    accion: 'FACTURA_SAAS_ANULADA', quien: 'owner',
    ejecutar: async () => post('owner', `/api/facturas-saas/${await facturaNueva()}/anular`, { motivo: 'Prueba de auditoría' }),
  },

  // ── Alta autoservicio y portabilidad (T12) ──
  { accion: 'ONBOARDING_SOLICITADO', quien: null, ejecutar: () => request(app).post('/api/onboarding/solicitar').send({ email: `aud.onb.${uid()}@inttest.local`, empresa_nombre: `AUD Alta ${uid()}`, acepta_terminos: true }) },
  {
    accion: 'ONBOARDING_BORRADOR_GUARDADO', quien: null,
    ejecutar: async () => request(app).put(`/api/onboarding/${await solicitudNueva()}/borrador`).send({ sucursal_nombre: 'AUD sucursal' }),
  },
  {
    accion: 'ONBOARDING_COMPLETADO', quien: null,
    ejecutar: async () => request(app).post(`/api/onboarding/${await solicitudNueva({ sucursal_nombre: 'AUD sucursal', plan_codigo: 'basico' })}/completar`).send({}),
  },
  {
    accion: 'ONBOARDING_INVITACION_REENVIADA', quien: null,
    ejecutar: async () => {
      const token = await solicitudNueva({ sucursal_nombre: 'AUD sucursal', plan_codigo: 'basico' });
      expect((await request(app).post(`/api/onboarding/${token}/completar`).send({})).status).toBe(201);
      return request(app).post(`/api/onboarding/${token}/reenviar`).send({});
    },
  },
  // ── Página pública (landing) ──
  {
    accion: 'CONTACTO_RECIBIDO', quien: null,
    ejecutar: () => request(app).post('/api/contacto').send({
      nombre: 'AUD Contacto', residencial: `AUD Residencial ${uid()}`, hogares: '200', telefono: '5555 1234', email: `aud.contacto.${uid()}@inttest.local`,
    }),
  },
  { accion: 'DATOS_EMPRESA_EXPORTADOS', quien: 'owner', ejecutar: () => request(app).get(`/api/empresas/${fx.empresas.A}/exportar`).set(as('owner')).buffer(true).parse((res, cb) => { const t: Buffer[] = []; res.on('data', c => t.push(c)); res.on('end', () => cb(null, Buffer.concat(t))); }) },

  // ── Sucursales (admin de empresa) ──
  { accion: 'SUCURSAL_CREADA', quien: 'adminEmpA', ejecutar: () => post('adminEmpA', '/api/sucursales', { empresa_id: fx.empresas.A, nombre: `AUD Suc ${uid()}` }) },
  {
    accion: 'SUCURSAL_ACTUALIZADA', quien: 'adminEmpA',
    ejecutar: async () => {
      const s = await post('adminEmpA', '/api/sucursales', { empresa_id: fx.empresas.A, nombre: `AUD Suc ${uid()}` });
      return put('adminEmpA', `/api/sucursales/${s.body.id}`, { nombre: `AUD Suc editada ${uid()}` });
    },
  },
  {
    accion: 'SUCURSAL_DESACTIVADA', quien: 'adminEmpA',
    ejecutar: async () => {
      const s = await post('adminEmpA', '/api/sucursales', { empresa_id: fx.empresas.A, nombre: `AUD Suc ${uid()}` });
      return del('adminEmpA', `/api/sucursales/${s.body.id}`);
    },
  },
  {
    accion: 'ADMIN_SUCURSAL_ASIGNADO', quien: 'adminEmpA',
    ejecutar: async () => post('adminEmpA', `/api/sucursales/${fx.sucursales.A2}/admin`, { usuario_id: await usuarioNuevo('agente', fx.sucursales.A2, null) }),
  },

  // ── Invitaciones administrativas ──
  { accion: 'INVITACION_CREADA', quien: 'owner', ejecutar: () => post('owner', '/api/invitaciones', { email: `aud.inv.${uid()}@inttest.local`, rol_invitado: 'admin_empresa', empresa_nombre: `AUD Inv ${uid()}` }) },
  {
    accion: 'INVITACION_REVOCADA', quien: 'owner',
    ejecutar: async () => {
      const i = await post('owner', '/api/invitaciones', { email: `aud.rev.${uid()}@inttest.local`, rol_invitado: 'admin_empresa', empresa_nombre: `AUD Rev ${uid()}` });
      return patch('owner', `/api/invitaciones/${i.body.id}/revocar`);
    },
  },
  {
    accion: 'INVITACION_REENVIADA', quien: 'owner',
    ejecutar: async () => {
      const i = await post('owner', '/api/invitaciones', { email: `aud.ree.${uid()}@inttest.local`, rol_invitado: 'admin_empresa', empresa_nombre: `AUD Ree ${uid()}` });
      return post('owner', `/api/invitaciones/${i.body.id}/reenviar`);
    },
  },
  {
    accion: 'INVITACION_ACEPTADA', quien: null, persona: true,
    ejecutar: async () => {
      const i = await post('owner', '/api/invitaciones', { email: `aud.ace.${uid()}@inttest.local`, rol_invitado: 'admin_empresa', empresa_nombre: `AUD Ace ${uid()}` });
      const token = (i.body.enlace as string).split('/invitacion/')[1];
      return request(app).post(`/api/invitaciones/${token}/aceptar`).send({ nombre: 'Invitado AUD', password: PASSWORD });
    },
  },

  // ── Personal y residentes ──
  { accion: 'USUARIO_CREADO', quien: 'adminSucA1', ejecutar: () => post('adminSucA1', '/api/usuarios', { nombre: 'AUD Agente', email: `aud.u.${uid()}@inttest.local`, password: PASSWORD, rol: 'agente' }) },
  { accion: 'USUARIO_EDITADO', quien: 'adminSucA1', ejecutar: async () => put('adminSucA1', `/api/usuarios/${await usuarioNuevo('agente', fx.sucursales.A1, null)}`, { nombre: 'AUD Editado' }) },
  { accion: 'USUARIO_DESACTIVADO', quien: 'adminSucA1', ejecutar: async () => del('adminSucA1', `/api/usuarios/${await usuarioNuevo('agente', fx.sucursales.A1, null)}`) },
  { accion: 'RESIDENTE_CREADO', quien: 'adminSucA1', ejecutar: () => post('adminSucA1', '/api/residentes', { nombre: 'AUD Residente', email: `aud.r.${uid()}@inttest.local`, password: PASSWORD, numero_casa: `AUD-${uid()}` }) },
  { accion: 'RESIDENTE_ACTUALIZADO', quien: 'adminSucA1', ejecutar: async () => put('adminSucA1', `/api/residentes/${await residenteNuevo()}`, { telefono: '50255551234' }) },
  { accion: 'RESIDENTE_ELIMINADO', quien: 'adminSucA1', ejecutar: async () => del('adminSucA1', `/api/residentes/${await residenteNuevo()}`) },

  // ── Equipos de garita ──
  { accion: 'LICENCIA_EMITIDA', quien: 'adminSucA1', ejecutar: () => post('adminSucA1', '/api/licencias', { etiqueta: `AUD-${uid()}` }) },
  { accion: 'LICENCIA_REVOCADA', quien: 'adminSucA1', ejecutar: async () => patch('adminSucA1', `/api/licencias/${(await licenciaNueva()).id}/revocar`) },
  {
    accion: 'LICENCIA_ACTIVADA', quien: null, persona: false,
    ejecutar: async () => request(app).post('/api/licencias/activar').send({ codigo: (await licenciaNueva()).codigo, fingerprint: hex64(), nombre_dispositivo: 'PC AUD' }),
  },

  // ── Garita y visitantes ──
  { accion: 'REGISTRO_ENTRADA', quien: 'agenteA1', ejecutar: () => post('agenteA1', '/api/accesos', { nombre_visitante: 'Visitante AUD', numero_dpi: dpiUnico(), residente_id: fx.residentes.A1 }) },
  { accion: 'REGISTRO_SALIDA', ruta: 'PATCH', quien: 'agenteA1', ejecutar: async () => patch('agenteA1', `/api/accesos/${await entradaNueva()}/salida`) },
  { accion: 'REGISTRO_SALIDA', ruta: 'PUT', quien: 'agenteA1', ejecutar: async () => put('agenteA1', `/api/accesos/${await entradaNueva()}/salida`) },
  { accion: 'PREAUTORIZACION_CREADA', ruta: 'administrador', quien: 'adminSucA1', ejecutar: () => post('adminSucA1', '/api/preautorizaciones', { residente_id: fx.residentes.A1, nombre_visitante: 'Aviso AUD', numero_dpi: dpiUnico(), fecha_inicio: hoy(), fecha_fin: dia(1) }) },
  { accion: 'PREAUTORIZACION_CREADA', ruta: 'residente', quien: 'resA1', ejecutar: () => post('resA1', '/api/preautorizaciones/mis', { nombre_visitante: 'Aviso AUD', numero_dpi: dpiUnico(), fecha_inicio: hoy(), fecha_fin: dia(1) }) },
  {
    accion: 'PREAUTORIZACION_ELIMINADA', ruta: 'administrador', quien: 'adminSucA1',
    ejecutar: async () => {
      const p = await post('adminSucA1', '/api/preautorizaciones', { residente_id: fx.residentes.A1, nombre_visitante: 'Aviso AUD', numero_dpi: dpiUnico(), fecha_inicio: hoy(), fecha_fin: dia(1) });
      return del('adminSucA1', `/api/preautorizaciones/${p.body.id}`);
    },
  },
  {
    accion: 'PREAUTORIZACION_ELIMINADA', ruta: 'residente', quien: 'resA1',
    ejecutar: async () => {
      const p = await post('resA1', '/api/preautorizaciones/mis', { nombre_visitante: 'Aviso AUD', numero_dpi: dpiUnico(), fecha_inicio: hoy(), fecha_fin: dia(1) });
      return del('resA1', `/api/preautorizaciones/mis/${p.body.id}`);
    },
  },
  { accion: 'BLACKLIST_AGREGADO', quien: 'adminSucA1', ejecutar: () => post('adminSucA1', '/api/blacklist', { placa: `AUD${Math.floor(1000 + Math.random() * 8999)}`, razon: 'Prueba de auditoría', duracion: 'indefinido' }) },
  {
    accion: 'BLACKLIST_REMOVIDO', quien: 'adminSucA1',
    ejecutar: async () => {
      const b = await post('adminSucA1', '/api/blacklist', { placa: `AUD${Math.floor(1000 + Math.random() * 8999)}`, razon: 'Prueba de auditoría', duracion: 'indefinido' });
      return del('adminSucA1', `/api/blacklist/${b.body.id}`);
    },
  },
  { accion: 'INVITACION_QR_CREADA', quien: 'resA1', ejecutar: () => post('resA1', '/api/invitaciones-qr/mis', { tipo: 'grupal', fecha_inicio: hoy(), usos_maximos: 2 }) },
  {
    accion: 'INVITACION_QR_REVOCADA', quien: 'resA1',
    ejecutar: async () => {
      const i = await post('resA1', '/api/invitaciones-qr/mis', { tipo: 'grupal', fecha_inicio: hoy(), usos_maximos: 2 });
      return del('resA1', `/api/invitaciones-qr/mis/${i.body.id}`);
    },
  },
  { accion: 'CONFIG_QR_ACTUALIZADA', quien: 'adminSucA1', ejecutar: () => put('adminSucA1', '/api/config-qr', { requiere_placa: false, max_intentos_fallidos: 5, bloqueo_minutos: 15 }) },
  // El OCR llama a Google Vision con una clave que aquí no existe: la lectura termina en error del servicio, pero el intento queda auditado.
  { accion: 'OCR_DPI', quien: 'agenteA1', exito: false, ejecutar: () => post('agenteA1', '/api/ocr/dpi', { imagen: 'AAAA' }) },
  { accion: 'OCR_PLACA', quien: 'agenteA1', exito: false, ejecutar: () => post('agenteA1', '/api/ocr/placa', { imagen: 'AAAA' }) },

  // ── Dinero ──
  {
    accion: 'PAGO_TARJETA_SIMULADO', quien: 'resA1',
    ejecutar: async () => {
      await q(`UPDATE residentes SET saldo_pendiente = 300, estado_pago = 'mora' WHERE id = $1`, [fx.residentes.A1]);
      return post('resA1', '/api/pagos/tarjeta', { monto: 25, ultimos4: '4444', titular: 'ANA AUD' });
    },
  },
  { accion: 'PAGO_TRANSFERENCIA_ENVIADA', quien: 'resA1', ejecutar: () => post('resA1', '/api/pagos/transferencia', { monto: 90, referencia: `AUD-${uid()}`, banco: 'Banco Industrial', fecha_transferencia: hoy() }) },
  { accion: 'PAGO_EFECTIVO', quien: 'adminSucA1', ejecutar: () => post('adminSucA1', '/api/pagos', { residente_id: fx.residentes.A1, monto: 50, concepto: 'AUD efectivo' }) },
  { accion: 'PAGO_APROBADO', quien: 'adminSucA1', ejecutar: async () => put('adminSucA1', `/api/pagos/${await pagoPendiente()}/aprobar`) },
  { accion: 'PAGO_RECHAZADO', quien: 'adminSucA1', ejecutar: async () => put('adminSucA1', `/api/pagos/${await pagoPendiente()}/rechazar`, { comentario: 'Comprobante ilegible' }) },
  { accion: 'CARGO_CONFIG_CREADA', ruta: '/api/cargos/configuracion', quien: 'adminSucA1', ejecutar: () => post('adminSucA1', '/api/cargos/configuracion', { nombre: `AUD ${uid()}`, monto: 10 }) },
  { accion: 'CARGO_CONFIG_CREADA', ruta: '/api/configuracion-cargos', quien: 'adminSucA1', ejecutar: () => post('adminSucA1', '/api/configuracion-cargos', { nombre: `AUD ${uid()}`, monto: 10 }) },
  {
    accion: 'CARGO_CONFIG_ACTUALIZADA', ruta: '/api/cargos/configuracion/:id', quien: 'adminSucA1',
    ejecutar: async () => {
      const c = await post('adminSucA1', '/api/cargos/configuracion', { nombre: `AUD ${uid()}`, monto: 10 });
      return put('adminSucA1', `/api/cargos/configuracion/${c.body.id}`, { monto: 12 });
    },
  },
  {
    accion: 'CARGO_CONFIG_ACTUALIZADA', ruta: '/api/configuracion-cargos/:id', quien: 'adminSucA1',
    ejecutar: async () => {
      const c = await post('adminSucA1', '/api/configuracion-cargos', { nombre: `AUD ${uid()}`, monto: 10 });
      return put('adminSucA1', `/api/configuracion-cargos/${c.body.id}`, { monto: 12 });
    },
  },
  {
    accion: 'CARGO_CONFIG_ELIMINADA', quien: 'adminSucA1',
    ejecutar: async () => {
      const c = await post('adminSucA1', '/api/configuracion-cargos', { nombre: `AUD ${uid()}`, monto: 10 });
      return del('adminSucA1', `/api/configuracion-cargos/${c.body.id}`);
    },
  },
  {
    accion: 'CARGO_APLICADO', quien: 'adminSucA1',
    ejecutar: async () => {
      const registro = await entradaNueva();
      const c = await uno<{ id: string }>(
        `INSERT INTO cargos_automaticos (registro_acceso_id, residente_id, monto, descripcion) VALUES ($1, $2, 15, 'AUD') RETURNING id`, [registro, fx.residentes.A1]);
      return patch('adminSucA1', `/api/cargos/${c!.id}/aplicar`);
    },
  },
  { accion: 'CARGO_PROGRAMADO_CREADO', quien: 'adminSucA1', ejecutar: () => post('adminSucA1', '/api/cargos-programados', { nombre: `AUD ${uid()}`, monto: 20, frecuencia: 'mensual' }) },
  {
    accion: 'CARGO_PROGRAMADO_ACTUALIZADO', quien: 'adminSucA1',
    ejecutar: async () => {
      const c = await post('adminSucA1', '/api/cargos-programados', { nombre: `AUD ${uid()}`, monto: 20, frecuencia: 'mensual' });
      return put('adminSucA1', `/api/cargos-programados/${c.body.id}`, { monto: 22 });
    },
  },
  {
    accion: 'CARGO_PROGRAMADO_ELIMINADO', quien: 'adminSucA1',
    ejecutar: async () => {
      const c = await post('adminSucA1', '/api/cargos-programados', { nombre: `AUD ${uid()}`, monto: 20, frecuencia: 'mensual' });
      return del('adminSucA1', `/api/cargos-programados/${c.body.id}`);
    },
  },
  {
    accion: 'CARGO_PROGRAMADO_APLICADO', quien: 'adminSucA1',
    ejecutar: async () => {
      const c = await post('adminSucA1', '/api/cargos-programados', { nombre: `AUD ${uid()}`, monto: 20, frecuencia: 'mensual' });
      return post('adminSucA1', `/api/cargos-programados/${c.body.id}/aplicar`);
    },
  },

  // ── Comunidad ──
  { accion: 'ANUNCIO_CREADO', quien: 'adminSucA1', ejecutar: () => post('adminSucA1', '/api/anuncios', { titulo: `AUD ${uid()}`, contenido: 'Contenido de prueba' }) },
  { accion: 'ANUNCIO_EDITADO', quien: 'adminSucA1', ejecutar: () => put('adminSucA1', `/api/anuncios/${fx.anuncios.A1}`, { titulo: `AUD editado ${uid()}`, contenido: 'Nuevo contenido' }) },
  {
    accion: 'ANUNCIO_ELIMINADO', quien: 'adminSucA1',
    ejecutar: async () => {
      const a = await post('adminSucA1', '/api/anuncios', { titulo: `AUD ${uid()}`, contenido: 'Contenido de prueba' });
      return del('adminSucA1', `/api/anuncios/${a.body.id}`);
    },
  },
  { accion: 'AREA_CREADA', quien: 'adminSucA1', ejecutar: () => post('adminSucA1', '/api/areas', { nombre: `AUD Área ${uid()}`, tarifa_tipo: 'gratis', tarifa_monto: 0 }) },
  {
    accion: 'AREA_ACTUALIZADA', quien: 'adminSucA1',
    ejecutar: async () => {
      const a = await post('adminSucA1', '/api/areas', { nombre: `AUD Área ${uid()}`, tarifa_tipo: 'gratis', tarifa_monto: 0 });
      return put('adminSucA1', `/api/areas/${a.body.id}`, { descripcion: 'Editada' });
    },
  },
  {
    accion: 'AREA_ELIMINADA', quien: 'adminSucA1',
    ejecutar: async () => {
      const a = await post('adminSucA1', '/api/areas', { nombre: `AUD Área ${uid()}`, tarifa_tipo: 'gratis', tarifa_monto: 0 });
      return del('adminSucA1', `/api/areas/${a.body.id}`);
    },
  },
  { accion: 'CREAR_RESERVA', quien: 'resA1', ejecutar: () => post('resA1', '/api/reservas', { area_id: fx.areas.A1, fecha: dia(20 + Math.floor(Math.random() * 300)), hora_inicio: '10:00', hora_fin: '11:00' }) },
  { accion: 'RESERVA_CANCELADA', quien: 'resA1', ejecutar: async () => patch('resA1', `/api/reservas/${await reservaNueva('confirmada')}/cancelar`, { motivo: 'AUD' }) },
  { accion: 'RESERVA_APROBADA', quien: 'adminSucA1', ejecutar: async () => patch('adminSucA1', `/api/reservas/${await reservaNueva('pendiente_aprobacion')}/aprobar`) },
  { accion: 'RESERVA_RECHAZADA', quien: 'adminSucA1', ejecutar: async () => patch('adminSucA1', `/api/reservas/${await reservaNueva('pendiente_aprobacion')}/rechazar`, { motivo: 'AUD' }) },
  { accion: 'CONFIG_RESERVAS_ACTUALIZADA', quien: 'adminSucA1', ejecutar: () => put('adminSucA1', '/api/config-reservas', { permite_cancelacion: true }) },
  { accion: 'TICKET_CREADO', quien: 'resA1', ejecutar: () => post('resA1', '/api/tickets', { tipo: 'otro', titulo: `AUD ${uid()}`, mensaje: 'Hola, es una prueba' }) },
  {
    accion: 'TICKET_MENSAJE_ENVIADO', quien: 'resA1',
    ejecutar: async () => {
      const t = await post('resA1', '/api/tickets', { tipo: 'otro', titulo: `AUD ${uid()}`, mensaje: 'Hola, es una prueba' });
      return post('resA1', `/api/tickets/${t.body.id}/mensajes`, { mensaje: 'Un mensaje más' });
    },
  },
  {
    accion: 'TICKET_CERRADO', quien: 'adminSucA1',
    ejecutar: async () => {
      const t = await post('resA1', '/api/tickets', { tipo: 'otro', titulo: `AUD ${uid()}`, mensaje: 'Hola, es una prueba' });
      return put('adminSucA1', `/api/tickets/${t.body.id}/cerrar`);
    },
  },

  // ── Descarga de datos personales ──
  { accion: 'REPORTE_ACCESOS_EXPORTADO', quien: 'adminSucA1', ejecutar: async () => request(app).get('/api/reportes/accesos').query({ desde: dia(-1), hasta: dia(1) }).set(as('adminSucA1')) },
  { accion: 'REPORTE_PAGOS_EXPORTADO', quien: 'adminSucA1', ejecutar: async () => request(app).get('/api/reportes/pagos').query({ desde: dia(-1), hasta: dia(1) }).set(as('adminSucA1')) },

  // ── Operación del sistema ──
  { accion: 'JOB_MORA_EJECUTADO', quien: 'owner', ejecutar: () => post('owner', '/api/admin/ejecutar-revision-mora') },
  { accion: 'JOB_RECORDATORIOS_EJECUTADO', quien: 'owner', ejecutar: () => post('owner', '/api/admin/ejecutar-recordatorios-reservas') },
  { accion: 'JOB_INVITACIONES_EJECUTADO', quien: 'owner', ejecutar: () => post('owner', '/api/admin/ejecutar-expiracion-invitaciones') },

  // ── ANPR continuo (Sprint 10) ──
  { accion: 'VEHICULO_RESIDENTE_CREADO', quien: 'adminSucA1', ejecutar: () => post('adminSucA1', '/api/anpr/vehiculos', { residente_id: fx.residentes.A1, placa: placaUnica() }) },
  { accion: 'VEHICULO_RESIDENTE_ACTUALIZADO', quien: 'adminSucA1', ejecutar: async () => patch('adminSucA1', `/api/anpr/vehiculos/${(await vehiculoNuevo()).id}`, { descripcion: 'AUD' }) },
  { accion: 'VEHICULO_RESIDENTE_DADO_DE_BAJA', quien: 'adminSucA1', ejecutar: async () => del('adminSucA1', `/api/anpr/vehiculos/${(await vehiculoNuevo()).id}`) },
  {
    accion: 'ANPR_ACCESO_AUTOMATICO', quien: 'agenteA1',
    ejecutar: async () => { const v = await vehiculoNuevo(); return garita('/api/anpr/accesos', { id_cliente: randomUUID(), vehiculo_id: v.id, placa: v.placa, modo: 'automatico', confianza: 0.97 }); },
  },
  {
    accion: 'ANPR_ACCESO_VERIFICADO', quien: 'agenteA1',
    ejecutar: async () => { const v = await vehiculoNuevo(); return garita('/api/anpr/accesos', { id_cliente: randomUUID(), vehiculo_id: v.id, placa: v.placa, modo: 'verificacion' }); },
  },
  { accion: 'ANPR_SALIDA', quien: 'agenteA1', ejecutar: async () => garita('/api/anpr/salidas', { id_cliente: randomUUID(), placa: (await accesoAnprNuevo()).placa }) },
  { accion: 'ANPR_EVENTO', quien: 'agenteA1', exito: false, ejecutar: () => garita('/api/anpr/eventos', { id_cliente: randomUUID(), tipo: 'desconocido' }) },
  { accion: 'ANPR_ALERTA_LISTA_NEGRA', quien: 'agenteA1', ejecutar: () => garita('/api/anpr/eventos', { id_cliente: randomUUID(), tipo: 'alerta_lista_negra', placa: 'P999AUD' }) },
  { accion: 'ANPR_VERIFICACION_RESUELTA', quien: 'agenteA1', ejecutar: () => garita('/api/anpr/eventos', { id_cliente: randomUUID(), tipo: 'verificacion_resuelta', detalle: { resolucion: 'descartado' } }) },
  { accion: 'ANPR_ILEGIBLE', quien: 'agenteA1', ejecutar: () => garita('/api/anpr/eventos', { id_cliente: randomUUID(), tipo: 'ilegible' }) },
  { accion: 'ANPR_ACTUADOR_FALLO', quien: 'agenteA1', ejecutar: () => garita('/api/anpr/eventos', { id_cliente: randomUUID(), tipo: 'actuador_fallo', detalle: { error: 'timeout' } }) },
  {
    accion: 'ANPR_EVIDENCIA', quien: 'agenteA1',
    ejecutar: async () => garita('/api/anpr/evidencias', { id_cliente: (await accesoAnprNuevo()).id, tipo: 'placa', jpeg: JPEG_AUD.toString('base64') }),
  },
];

/** Acciones que sólo aparecen como bloqueo por límite de tasa (429): las cubre la sección de abajo. */
const SOLO_BLOQUEO = ['LIMITE_SESION', 'LIMITE_TASA_GENERAL', 'OCR_ESCANEO', 'LICENCIA_HEARTBEAT'];

const SRC = path.resolve(__dirname, '../..');
const archivos = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : archivos(p);
    return e.name.endsWith('.ts') ? [p] : [];
  });
const accionesEnCodigo = (): string[] => {
  const set = new Set<string>();
  for (const f of archivos(SRC)) for (const m of readFileSync(f, 'utf8').matchAll(/\baccion:\s*'([A-Z][A-Z0-9_]+)'/g)) set.add(m[1]);
  return [...set].sort();
};

describe('I-11 cada acción sensible deja usuario, fecha e IP', () => {
  it.each(CASOS.map(c => [c.ruta ? `${c.accion} (${c.ruta})` : c.accion, c] as const))('%s', async (_nombre, caso) => {
    const inicio = (await uno<{ t: string }>(`SELECT clock_timestamp()::text AS t`))!.t;
    const r = await caso.ejecutar();
    if (caso.exito !== false && (r.status < 200 || r.status >= 300)) {
      throw new Error(`${caso.accion}: la acción debía salir bien y respondió ${r.status} ${JSON.stringify(r.body)}`);
    }

    // La fila se escribe al terminar la respuesta y sin esperar: se consulta hasta que aparezca.
    const limite = Date.now() + 3000;
    let fila: any;
    do {
      fila = await uno(
        `SELECT usuario_id, accion, ip_address, user_agent, status_code, datos_nuevos,
                created_at >= $2::timestamp AND created_at <= clock_timestamp()::timestamp AS en_ventana
           FROM audit_logs WHERE accion = $1 AND created_at >= $2::timestamp
          ORDER BY created_at DESC, id DESC LIMIT 1`,
        [caso.accion, inicio]);
      if (fila) break;
      await new Promise(res => setTimeout(res, 50));
    } while (Date.now() < limite);

    if (!fila) throw new Error(`no hay fila de auditoría para ${caso.accion}`);
    expect(fila.en_ventana).toBe(true);                                   // fecha: se creó durante la ejecución
    expect(fila.ip_address).toBeTruthy();                                 // IP
    expect(fila.status_code).toBe(r.status);                              // código HTTP real
    const debeTenerPersona = caso.persona ?? caso.quien !== null;
    if (debeTenerPersona) expect(fila.usuario_id).toBeTruthy();           // usuario
    if (caso.quien) expect(fila.usuario_id).toBe(sesion[caso.quien].id);
  });

  it('además de la IP guarda el user-agent cuando el cliente lo manda', async () => {
    const r = await request(app).post('/api/empresas').set(as('owner')).set('User-Agent', 'auditoria-int/1.0').send({ nombre: `AUD UA ${uid()}` });
    expect(r.status).toBe(201);
    const limite = Date.now() + 3000;
    let fila: any;
    do {
      fila = await uno(`SELECT user_agent FROM audit_logs WHERE accion = 'EMPRESA_CREADA' AND registro_id IS NULL AND user_agent = 'auditoria-int/1.0' LIMIT 1`);
      if (fila) break;
      await new Promise(res => setTimeout(res, 50));
    } while (Date.now() < limite);
    expect(fila?.user_agent).toBe('auditoria-int/1.0');
  });

  it('la tabla cubre TODAS las acciones auditadas del código (una acción nueva sin caso aquí rompe la prueba)', () => {
    const cubiertas = new Set([...CASOS.map(c => c.accion), ...SOLO_BLOQUEO]);
    expect(accionesEnCodigo().filter(a => !cubiertas.has(a))).toEqual([]);
    expect([...cubiertas].filter(a => !accionesEnCodigo().includes(a))).toEqual([]);
  });
});
