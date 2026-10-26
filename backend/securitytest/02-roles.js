'use strict';
/**
 * Escalación de roles (vertical) y mass assignment.
 *
 * Cada endpoint declara el rol MÍNIMO que exige el código; los roles inferiores
 * lo llaman con su propio token y deben recibir 401/403 (el guard responde antes
 * que el controlador). Se usan ids de SU PROPIO tenant para aislar la
 * comprobación de rol de la de tenant (esa es 01-idor).
 */
const L = require('./lib');
const { execSync } = require('child_process');

const F = L.fixtures();
const S = new L.Suite('02-roles', 'Escalación de roles y mass assignment');
const A1 = F.datos.A1;
const SUC = F.sucursales.A1;
const EMP = F.empresas.A;

// [id, método, ruta, body, rolMínimo]
const ENDPOINTS = [
  // ── owner ────────────────────────────────────────────────────────────────
  ['empresas-GET',            'GET',    '/api/empresas', undefined, 'owner'],
  ['empresas-POST',           'POST',   '/api/empresas', { nombre: 'ST-hack-empresa' }, 'owner'],
  ['empresas-PUT',            'PUT',    `/api/empresas/${EMP}`, { nombre: 'HACK' }, 'owner'],
  ['empresas-DELETE',         'DELETE', `/api/empresas/${EMP}`, undefined, 'owner'],
  ['empresas-admin',          'POST',   `/api/empresas/${EMP}/admin`, { usuario_id: F.usuarios.cobayaA }, 'owner'],
  ['empresas-suspender',      'PATCH',  `/api/empresas/${EMP}/suspender`, { suspendida: true, motivo: 'HACK' }, 'owner'],
  ['empresas-reactivar',      'PATCH',  `/api/empresas/${EMP}/reactivar`, {}, 'owner'],
  ['empresas-eliminar-def',   'POST',   `/api/empresas/${EMP}/eliminar-definitivo`, { password: 'x' }, 'owner'],
  ['audit-logs',              'GET',    '/api/audit-logs', undefined, 'owner'],
  ['admin-mora',              'POST',   '/api/admin/ejecutar-revision-mora', {}, 'owner'],
  ['admin-recordatorios',     'POST',   '/api/admin/ejecutar-recordatorios-reservas', {}, 'owner'],
  ['admin-exp-invitaciones',  'POST',   '/api/admin/ejecutar-expiracion-invitaciones', {}, 'owner'],
  // ── admin_empresa ────────────────────────────────────────────────────────
  ['empresas-stats',          'GET',    `/api/empresas/${EMP}/stats`, undefined, 'admin_empresa'],
  ['sucursales-GET',          'GET',    '/api/sucursales', undefined, 'admin_empresa'],
  ['sucursales-POST',         'POST',   '/api/sucursales', { empresa_id: EMP, nombre: 'ST-hack-suc' }, 'admin_empresa'],
  ['sucursales-PUT',          'PUT',    `/api/sucursales/${SUC}`, { nombre: 'HACK' }, 'admin_empresa'],
  ['sucursales-DELETE',       'DELETE', `/api/sucursales/${SUC}`, undefined, 'admin_empresa'],
  ['sucursales-admin',        'POST',   `/api/sucursales/${SUC}/admin`, { usuario_id: F.usuarios.cobayaA }, 'admin_empresa'],
  ['invitaciones-GET',        'GET',    '/api/invitaciones', undefined, 'admin_empresa'],
  ['invitaciones-POST',       'POST',   '/api/invitaciones', { email: 'st.hack.role@sectest.local', rol_invitado: 'admin_sucursal', sucursal_id: SUC }, 'admin_empresa'],
  ['invitaciones-revocar',    'PATCH',  `/api/invitaciones/${F.invitaciones.A.id}/revocar`, {}, 'admin_empresa'],
  ['invitaciones-reenviar',   'POST',   `/api/invitaciones/${F.invitaciones.A.id}/reenviar`, {}, 'admin_empresa'],
  // ── admin_sucursal ───────────────────────────────────────────────────────
  ['licencias-GET',           'GET',    '/api/licencias', undefined, 'admin_sucursal'],
  ['licencias-POST',          'POST',   '/api/licencias', { etiqueta: 'ST-hack' }, 'admin_sucursal'],
  ['licencias-revocar',       'PATCH',  `/api/licencias/${F.licencias['A1-libre'].id}/revocar`, {}, 'admin_sucursal'],
  ['pagos-GET',               'GET',    '/api/pagos', undefined, 'admin_sucursal'],
  ['pagos-pendientes',        'GET',    '/api/pagos/pendientes-verificacion', undefined, 'admin_sucursal'],
  ['pagos-POST',              'POST',   '/api/pagos', { residente_id: F.residentes.A1, monto: 1, comprobante: 'x' }, 'admin_sucursal'],
  ['pagos-aprobar',           'PUT',    `/api/pagos/${A1.pago}/aprobar`, {}, 'admin_sucursal'],
  ['pagos-rechazar',          'PUT',    `/api/pagos/${A1.pago}/rechazar`, { comentario_rechazo: 'x' }, 'admin_sucursal'],
  ['residentes-POST',         'POST',   '/api/residentes', { nombre: 'ST hack', email: 'st.hack.role.res@sectest.local', password: 'Hack12345a', numero_casa: 'HACK-R' }, 'admin_sucursal'],
  ['residentes-PUT',          'PUT',    `/api/residentes/${F.residentes.A1}`, { numero_casa: 'HACK-R' }, 'admin_sucursal'],
  ['residentes-DELETE',       'DELETE', `/api/residentes/${F.residentes.A1}`, undefined, 'admin_sucursal'],
  ['usuarios-GET',            'GET',    '/api/usuarios', undefined, 'admin_sucursal'],
  ['usuarios-sucursal',       'GET',    '/api/usuarios/sucursal', undefined, 'admin_sucursal'],
  ['usuarios-POST',           'POST',   '/api/usuarios', { nombre: 'ST hack', email: 'st.hack.role.u@sectest.local', password: 'Hack12345a', rol: 'agente' }, 'admin_sucursal'],
  ['usuarios-DELETE',         'DELETE', `/api/usuarios/${F.usuarios.cobayaA}`, undefined, 'admin_sucursal'],
  ['anuncios-GET',            'GET',    '/api/anuncios', undefined, 'admin_sucursal'],
  ['anuncios-POST',           'POST',   '/api/anuncios', { titulo: 'ST-hack', contenido: 'x' }, 'admin_sucursal'],
  ['anuncios-PUT',            'PUT',    `/api/anuncios/${A1.anuncio}`, { titulo: 'HACK', contenido: 'x' }, 'admin_sucursal'],
  ['anuncios-DELETE',         'DELETE', `/api/anuncios/${A1.anuncio}`, undefined, 'admin_sucursal'],
  ['areas-POST',              'POST',   '/api/areas', { nombre: 'ST-hack-area' }, 'admin_sucursal'],
  ['areas-PUT',               'PUT',    `/api/areas/${A1.area}`, { nombre: 'HACK' }, 'admin_sucursal'],
  ['areas-DELETE',            'DELETE', `/api/areas/${A1.area}`, undefined, 'admin_sucursal'],
  ['config-qr-PUT',           'PUT',    '/api/config-qr', { requiere_placa: true }, 'admin_sucursal'],
  ['config-reservas-GET',     'GET',    '/api/config-reservas', undefined, 'admin_sucursal'],
  ['config-reservas-PUT',     'PUT',    '/api/config-reservas', { permite_cancelacion: false }, 'admin_sucursal'],
  ['cargos-config-GET',       'GET',    '/api/cargos/configuracion', undefined, 'admin_sucursal'],
  ['cargos-config-PUT',       'PUT',    `/api/cargos/configuracion/${A1.config_cargo}`, { nombre: 'HACK', monto: 1 }, 'admin_sucursal'],
  ['cargos-aplicar',          'PATCH',  `/api/cargos/${A1.config_cargo}/aplicar`, {}, 'admin_sucursal'],
  ['configuracion-cargos-GET','GET',    '/api/configuracion-cargos', undefined, 'admin_sucursal'],
  ['configuracion-cargos-PUT','PUT',    `/api/configuracion-cargos/${A1.config_cargo}`, { nombre: 'HACK', monto: 1 }, 'admin_sucursal'],
  ['configuracion-cargos-DEL','DELETE', `/api/configuracion-cargos/${A1.config_cargo}`, undefined, 'admin_sucursal'],
  ['cargos-prog-GET',         'GET',    '/api/cargos-programados', undefined, 'admin_sucursal'],
  ['cargos-prog-POST',        'POST',   '/api/cargos-programados', { nombre: 'ST-hack', monto: 1, aplica_a: 'todos' }, 'admin_sucursal'],
  ['cargos-prog-aplicar',     'POST',   `/api/cargos-programados/${A1.cargo_programado}/aplicar`, {}, 'admin_sucursal'],
  ['cargos-prog-historial',   'GET',    `/api/cargos-programados/${A1.cargo_programado}/historial`, undefined, 'admin_sucursal'],
  ['reportes-accesos',        'GET',    '/api/reportes/accesos', undefined, 'admin_sucursal'],
  ['reportes-pagos',          'GET',    '/api/reportes/pagos', undefined, 'admin_sucursal'],
  ['reportes-estadisticas',   'GET',    '/api/reportes/estadisticas', undefined, 'admin_sucursal'],
  ['blacklist-POST',          'POST',   '/api/blacklist', { numero_dpi: 'ST-HACK', nombre: 'x', razon: 'HACK' }, 'admin_sucursal'],
  ['blacklist-DELETE',        'DELETE', `/api/blacklist/${A1.blacklist}`, undefined, 'admin_sucursal'],
  ['preauto-POST',            'POST',   '/api/preautorizaciones', { residente_id: F.residentes.A1, nombre_visitante: 'ST-hack', fecha_inicio: '2030-01-01' }, 'admin_sucursal'],
  ['preauto-DELETE',          'DELETE', `/api/preautorizaciones/${A1.preautorizacion}`, undefined, 'admin_sucursal'],
  ['reservas-GET',            'GET',    '/api/reservas', undefined, 'admin_sucursal'],
  ['reservas-aprobar',        'PATCH',  `/api/reservas/${A1.reserva}/aprobar`, {}, 'admin_sucursal'],
  ['reservas-rechazar',       'PATCH',  `/api/reservas/${A1.reserva}/rechazar`, { motivo: 'x' }, 'admin_sucursal'],
  // ── personal (staff): el residente queda fuera ──────────────────────────
  ['accesos-activos',         'GET',    '/api/accesos/activos', undefined, 'agente'],
  ['accesos-POST',            'POST',   '/api/accesos', { nombre_visitante: 'ST hack', numero_dpi: 'ST-HACK-DPI', residente_id: F.residentes.A1 }, 'agente'],
  ['accesos-salida',          'PATCH',  `/api/accesos/${A1.registro_acceso}/salida`, {}, 'agente'],
  ['dashboard',               'GET',    '/api/dashboard', undefined, 'agente'],
  ['blacklist-GET',           'GET',    '/api/blacklist', undefined, 'agente'],
  ['preauto-GET',             'GET',    '/api/preautorizaciones', undefined, 'agente'],
  ['preauto-buscar',          'GET',    '/api/preautorizaciones/buscar?dpi=ST', undefined, 'agente'],
  ['visitantes',              'GET',    '/api/visitantes?dpi=ST-DPI', undefined, 'agente'],
  ['visitantes-buscar',       'GET',    '/api/visitantes/buscar?q=Visitante', undefined, 'agente'],
  ['qr-verificar',            'GET',    `/api/invitaciones-qr/verificar/${A1.invitacion_qr}`, undefined, 'agente'],
  ['residentes-GET',          'GET',    '/api/residentes', undefined, 'agente'],
  ['residentes-id',           'GET',    `/api/residentes/${F.residentes.A1}`, undefined, 'agente'],
  ['tickets-GET',             'GET',    '/api/tickets', undefined, 'agente'],
  ['tickets-cerrar',          'PUT',    `/api/tickets/${A1.ticket}/cerrar`, {}, 'agente'],
  ['sync-garita',             'GET',    '/api/sync/garita', undefined, 'agente'],
];

const ORDEN = ['residente', 'agente', 'admin_sucursal', 'admin_empresa', 'owner'];
const ACTOR = {
  residente: ['resA1', 'residente'],
  agente: ['agenteA1', 'agente'],
  admin_sucursal: ['adminSucA1', 'admin_sucursal'],
  admin_empresa: ['adminEmpA', 'admin_empresa'],
};

(async () => {
  await L.reiniciarBackend();
  const T = await L.tokens(true);

  for (const [id, metodo, ruta, body, minimo] of ENDPOINTS) {
    for (const rol of ORDEN.filter(r => ORDEN.indexOf(r) < ORDEN.indexOf(minimo))) {
      const [tk, etiqueta] = ACTOR[rol];
      await S.check({
        id: `ROL-${etiqueta}-${metodo}-${id}`,
        titulo: `${etiqueta} llama a ${metodo} ${id} (exige ${minimo})`,
        method: metodo, path: ruta, actor: `${etiqueta} (${tk})`, token: T[tk], body,
        esperado: '403 (guard de rol antes del controlador)',
        severidad: ORDEN.indexOf(minimo) >= 3 ? 'crítica' : 'alta',
        ok: r => (r.status === 403 || r.status === 401) && (id !== 'empresas-eliminar-def' || /owner/i.test(r.text)),
      });
    }
  }

  // ── Mass assignment ────────────────────────────────────────────────────────
  console.log('\n══ Mass assignment / jerarquía de roles ══');
  const owners = () => L.psql(`SELECT count(*) FROM usuarios WHERE rol='owner'`);
  const ownersAntes = owners();
  for (const [actor, rolPedido] of [['adminSucA1', 'owner'], ['adminSucA1', 'admin_empresa'],
                                    ['adminEmpA', 'owner'], ['adminEmpA', 'admin_empresa']]) {
    const email = `st.hack.mass.${actor}.${rolPedido}@sectest.local`.toLowerCase();
    await S.check({
      id: `MASS-${actor}-crea-${rolPedido}`, titulo: `${actor} intenta crear un usuario con rol ${rolPedido} vía POST /usuarios`,
      method: 'POST', path: '/api/usuarios', actor, token: T[actor], severidad: 'crítica',
      body: { nombre: 'ST mass', email, password: 'Hack12345a', rol: rolPedido, sucursal_id: SUC },
      esperado: '4xx y ningún usuario nuevo con ese rol',
      ok: r => r.status >= 400 && r.status < 500
        && L.psql(`SELECT count(*) FROM usuarios WHERE email='${email}' AND rol='${rolPedido}'`) === '0',
    });
  }
  await S.check({
    id: 'MASS-preferencias-rol', titulo: 'PUT /usuarios/me/preferencias con {rol:"owner"} no cambia el rol', severidad: 'crítica',
    method: 'PUT', path: '/api/usuarios/me/preferencias', actor: 'resA1', token: T.resA1,
    body: { tema: 'light', idioma: 'es', rol: 'owner', sucursal_id: F.sucursales.B1, empresa_id: F.empresas.B, activo: true },
    esperado: 'el rol y el tenant del usuario no cambian',
    ok: () => L.psql(`SELECT rol||'|'||sucursal_id FROM usuarios WHERE id='${F.usuarios.resA1}'`) === `residente|${F.sucursales.A1}`,
  });
  await S.check({
    id: 'MASS-residente-PUT-mueve-tenant', titulo: 'PUT /residentes/:id con {sucursal_id: B1, usuario_id} no traslada al residente a otra empresa', severidad: 'crítica',
    method: 'PUT', path: `/api/residentes/${F.residentes.A1}`, actor: 'adminSucA1', token: T.adminSucA1,
    body: { numero_casa: 'ST-A1-01', sucursal_id: F.sucursales.B1, usuario_id: F.usuarios.resB1, estado_pago: 'al_dia' },
    esperado: 'sucursal_id y usuario_id del residente no cambian',
    ok: () => L.psql(`SELECT sucursal_id||'|'||usuario_id FROM residentes WHERE id='${F.residentes.A1}'`) === `${F.sucursales.A1}|${F.usuarios.resA1}`,
  });
  await S.check({
    id: 'MASS-login-rol-en-body', titulo: 'POST /auth/login ignora un {rol:"owner"} en el body', severidad: 'crítica',
    method: 'POST', path: '/api/auth/login', actor: 'anónimo (cuenta de residente)',
    body: { email: L.EMAIL.resA1, password: L.PW, rol: 'owner', empresa_id: F.empresas.B, sucursal_id: F.sucursales.B1 },
    esperado: 'token con rol residente y tenant A',
    ok: r => {
      if (r.status !== 200 || !r.json?.token) return false;
      const p = JSON.parse(Buffer.from(r.json.token.split('.')[1], 'base64url').toString());
      return p.rol === 'residente' && p.sucursal_id === F.sucursales.A1;
    },
  });
  const ownersDespues = owners();
  S.registrar({
    id: 'MASS-invariante-owners', titulo: 'Invariante: el número de owners en la BD no cambió durante las pruebas',
    esperado: `${ownersAntes} owners antes y después`, real: { status: 0, body: `antes=${ownersAntes}, después=${ownersDespues}` },
    request: { method: 'SQL', path: "SELECT count(*) FROM usuarios WHERE rol='owner'", actor: 'psql' },
    resultado: ownersAntes === ownersDespues ? 'OK' : 'FALLA', severidad: 'crítica',
  });

  const fallas = S.save();
  const cambios = L.psql(`SELECT count(*) FROM usuarios WHERE email LIKE 'st.hack%'`);
  console.log(`Restaurando "seeded" (fallas=${fallas}, usuarios ST-hack=${cambios})…`);
  execSync(`${__dirname}/snapshot.sh restore seeded`, { stdio: 'inherit' });
})().catch(e => { console.error(e); process.exit(1); });
