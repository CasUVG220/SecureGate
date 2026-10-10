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
import { randomUUID } from 'crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer, PASSWORD } from '../helpers/auth';

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

  // Un residente pide una pantalla de administración: el guard de rol lo rechaza (403) y deja huella con su persona y su IP.
  { accion: 'ACCESO_DENEGADO', quien: 'resA1', exito: false, ejecutar: () => request(app).get('/api/dashboard').set(as('resA1')) },

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
