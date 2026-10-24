'use strict';
/**
 * Genera zap/openapi.json a partir de las rutas REALES registradas en el router
 * de Express (misma técnica que src/__tests__/security.routes.contract.test.ts),
 * con ejemplos de parámetros y de cuerpo que apuntan a los datos sembrados.
 * Las rutas destructivas de empresas/sucursales/usuarios apuntan a objetos
 * sacrificiales (empresa Z, usuario cobaya), no a A ni B.
 *
 *   node -r ts-node/register/transpile-only backend/securitytest/gen-openapi.js
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);
const fs = require('fs');
const path = require('path');
const F = require('./lib').fixtures();
require('../src/utils/asyncErrors');
const apiRouter = require('../src/routes').default;

const prefijoDe = layer => {
  const m = /^\^\\\/(.+?)\\\/\?\(\?=\\\/\|\$\)$/.exec(layer.regexp.source);
  return m ? `/${m[1].replace(/\\\//g, '/')}` : '';
};
const listar = (stack, prefijo = '') => {
  const out = [];
  for (const layer of stack) {
    if (layer.route) for (const method of Object.keys(layer.route.methods)) out.push({ method, path: `${prefijo}${layer.route.path}` });
    else if (layer.name === 'router' && layer.handle?.stack) out.push(...listar(layer.handle.stack, prefijo + prefijoDe(layer)));
  }
  return out;
};
const rutas = listar(apiRouter.stack).map(r => ({ ...r, path: `/api${r.path}`.replace(/(.)\/$/, '$1') }));

const A1 = F.datos.A1;
const ID_POR_RECURSO = {
  residentes: F.residentes.A1, pagos: A1.pago, licencias: F.licencias['A1-libre'].id, empresas: F.zap.empresa, sucursales: F.zap.sucursal,
  usuarios: F.usuarios.cobayaA, anuncios: A1.anuncio, areas: A1.area, tickets: A1.ticket, preautorizaciones: A1.preautorizacion,
  'invitaciones-qr': A1.invitacion_qr, blacklist: A1.blacklist, 'cargos-programados': A1.cargo_programado, 'configuracion-cargos': A1.config_cargo,
  cargos: A1.config_cargo, reservas: A1.reserva, accesos: A1.registro_acceso, invitaciones: F.invitaciones.A.id,
};
const ejemploParam = (ruta, nombre) => {
  if (nombre === 'token') return 'A'.repeat(43);
  const recurso = ruta.split('/')[2];
  return ID_POR_RECURSO[recurso] || A1.pago;
};
const CUERPOS = {
  'POST /api/auth/login': { email: 'st.res.a1@sectest.local', password: 'Sec#Test2026a' },
  'POST /api/residentes': { nombre: 'ST zap', email: 'st.zap.res@sectest.local', password: 'Zap12345a', numero_casa: 'ZAP-1', telefono: '50255550009' },
  'PUT /api/residentes/{id}': { numero_casa: 'ST-A1-01', estado_pago: 'pendiente', telefono: '50255550000', saldo_pendiente: 250 },
  'POST /api/accesos': { nombre_visitante: 'ST zap', numero_dpi: '1234567890123', residente_id: F.residentes.A1, placa: 'P123ABC' },
  'POST /api/pagos': { residente_id: F.residentes.A1, monto: 10, comprobante: 'x' },
  'POST /api/pagos/transferencia': { monto: 10, referencia: 'ST-ZAP', banco: 'x', fecha_transferencia: '2030-01-01', comprobante: 'x' },
  'POST /api/pagos/tarjeta': { monto: 10, ultimos4: '4242', titular: 'ST zap' },
  'PUT /api/pagos/{id}/rechazar': { comentario_rechazo: 'zap' },
  'POST /api/licencias': { etiqueta: 'ST zap' },
  'POST /api/licencias/activar': { codigo: 'SG-AAAA-BBBB-CCCC-DDDD', fingerprint: 'c'.repeat(64), nombre_dispositivo: 'zap' },
  'POST /api/licencias/heartbeat': { fingerprint: 'c'.repeat(64) },
  'POST /api/invitaciones': { email: 'st.zap.inv@sectest.local', rol_invitado: 'admin_empresa', empresa_nombre: 'ST zap' },
  'POST /api/invitaciones/{token}/aceptar': { nombre: 'ST zap', password: 'Zap12345a' },
  'POST /api/empresas': { nombre: 'ST zap', nit: '1' },
  'PUT /api/empresas/{id}': { nombre: 'ST Empresa Z (ZAP)', nit: '1' },
  'POST /api/empresas/{id}/admin': { usuario_id: F.usuarios.cobayaA },
  'PATCH /api/empresas/{id}/suspender': { motivo: 'ST zap' },
  'POST /api/empresas/{id}/eliminar-definitivo': { password: 'no-la-conoce' },
  'POST /api/sucursales': { empresa_id: F.zap.empresa, nombre: 'ST zap', direccion: 'x', tipo: 'x' },
  'PUT /api/sucursales/{id}': { nombre: 'ST zap' },
  'POST /api/sucursales/{id}/admin': { usuario_id: F.usuarios.cobayaA },
  'POST /api/usuarios': { nombre: 'ST zap', email: 'st.zap.usr@sectest.local', password: 'Zap12345a', rol: 'agente' },
  'PUT /api/usuarios/me/preferencias': { idioma: 'es', tema: 'dark' },
  'POST /api/anuncios': { titulo: 'ST zap', contenido: 'x', prioridad: 'normal' },
  'PUT /api/anuncios/{id}': { titulo: 'ST zap', contenido: 'x' },
  'POST /api/tickets': { tipo: 'otro', titulo: 'ST zap', mensaje: 'x' },
  'POST /api/tickets/{id}/mensajes': { mensaje: 'ST zap' },
  'POST /api/preautorizaciones': { residente_id: F.residentes.A1, nombre_visitante: 'ST zap', fecha_inicio: '2030-01-01' },
  'POST /api/preautorizaciones/mis': { nombre_visitante: 'ST zap', numero_dpi: '1234567890123', placa: 'P123ABC', fecha_inicio: '2030-01-01' },
  'POST /api/invitaciones-qr/mis': { tipo: 'individual', etiqueta: 'ST zap', nombre_visitante: 'x', numero_dpi: '1234567890123', fecha_inicio: '2030-01-01', usos_maximos: 1 },
  'POST /api/blacklist': { numero_dpi: '9999999999999', nombre: 'ST zap', razon: 'zap' },
  'POST /api/areas': { nombre: 'ST zap', descripcion: 'x' },
  'PUT /api/areas/{id}': { nombre: 'ST zap' },
  'POST /api/configuracion-cargos': { nombre: 'ST zap', monto: 1, frecuencia: 'mensual' },
  'PUT /api/configuracion-cargos/{id}': { nombre: 'ST zap', monto: 1 },
  'POST /api/cargos/configuracion': { nombre: 'ST zap', monto: 1, frecuencia: 'mensual' },
  'PUT /api/cargos/configuracion/{id}': { nombre: 'ST zap', monto: 1 },
  'POST /api/cargos-programados': { nombre: 'ST zap', monto: 1, frecuencia: 'mensual', aplica_a: 'todos' },
  'PUT /api/cargos-programados/{id}': { nombre: 'ST zap', monto: 1 },
  'POST /api/reservas': { area_id: A1.area, fecha: '2030-04-01', hora_inicio: '10:00', hora_fin: '11:00' },
  'PATCH /api/reservas/{id}/cancelar': { motivo: 'zap' },
  'PATCH /api/reservas/{id}/rechazar': { motivo: 'zap' },
  'PUT /api/config-qr': { max_intentos_fallidos: 5 },
  'PUT /api/config-reservas': { permite_cancelacion: true },
};
const QUERY = {
  '/api/visitantes': ['dpi'], '/api/visitantes/buscar': ['q', 'residente_id'], '/api/preautorizaciones/buscar': ['dpi', 'placa'],
  '/api/accesos/activo': ['placa'], '/api/reportes/accesos': ['desde', 'hasta'], '/api/reportes/pagos': ['desde', 'hasta'],
  '/api/reportes/estadisticas': ['desde', 'hasta'], '/api/audit-logs': ['accion', 'usuario_id', 'desde', 'hasta', 'limit', 'offset'],
  '/api/areas': ['activa'], '/api/reservas': ['area_id', 'estado', 'fecha_desde', 'fecha_hasta'],
  '/api/reservas/disponibilidad': ['area_id', 'fecha'], '/api/config-qr': ['sucursal_id'], '/api/config-reservas': ['sucursal_id'],
};
const EJ_QUERY = { dpi: '1234567890123', q: 'ST Visitante', residente_id: F.residentes.A1, placa: 'P123ABC', desde: '2020-01-01', hasta: '2030-01-01',
  accion: 'LOGIN', usuario_id: F.usuarios.resA1, limit: '20', offset: '0', activa: 'true', area_id: A1.area, estado: 'confirmada',
  fecha_desde: '2020-01-01', fecha_hasta: '2030-01-01', fecha: '2030-01-01', sucursal_id: F.sucursales.A1 };
const PUBLICAS = new Set(['POST /api/auth/login', 'POST /api/auth/refresh', 'POST /api/auth/logout', 'GET /api/status', 'POST /api/licencias/activar',
  'POST /api/licencias/heartbeat', 'GET /api/invitaciones/{token}', 'POST /api/invitaciones/{token}/aceptar']);

const paths = {};
for (const r of rutas) {
  const oaPath = r.path.replace(/:(\w+)/g, '{$1}');
  const clave = `${r.method.toUpperCase()} ${oaPath}`;
  const op = { operationId: clave.replace(/\W+/g, '_'), tags: [r.path.split('/')[2] || 'raiz'], responses: { 200: { description: 'ok' } }, parameters: [] };
  for (const [, nombre] of r.path.matchAll(/:(\w+)/g)) {
    op.parameters.push({ name: nombre, in: 'path', required: true, schema: { type: 'string' }, example: ejemploParam(r.path, nombre) });
  }
  if (r.method === 'get') for (const q of QUERY[r.path] || []) op.parameters.push({ name: q, in: 'query', required: false, schema: { type: 'string' }, example: EJ_QUERY[q] });
  if (['post', 'put', 'patch'].includes(r.method)) {
    op.requestBody = { required: false, content: { 'application/json': { schema: { type: 'object' }, example: CUERPOS[clave] || {} } } };
  }
  if (!PUBLICAS.has(clave)) op.security = [{ bearerAuth: [] }];
  (paths[oaPath] = paths[oaPath] || {})[r.method] = op;
}
const spec = {
  openapi: '3.0.3', info: { title: 'SecureGate API (generado de las rutas reales)', version: '1.0.0' },
  servers: [{ url: 'http://host.docker.internal:3000' }],
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
  paths,
};
fs.mkdirSync(path.join(__dirname, 'zap'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'zap', 'openapi.json'), JSON.stringify(spec, null, 2));
fs.writeFileSync(path.join(__dirname, 'zap', 'routes.json'), JSON.stringify(rutas.map(r => `${r.method.toUpperCase()} ${r.path}`).sort(), null, 2));
console.log(`OpenAPI generado: ${rutas.length} operaciones en ${Object.keys(paths).length} rutas → securitytest/zap/openapi.json`);
