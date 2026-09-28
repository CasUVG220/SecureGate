'use strict';
/**
 * IDOR / aislamiento multi-tenant.
 *
 * Con el token de la empresa A (cuatro roles) se intenta leer y modificar
 * objetos de la empresa B, y con los roles de la sucursal A1 objetos de la
 * sucursal A2 (misma empresa). Recursos: residentes, registros_acceso, pagos,
 * licencias_dispositivo, invitaciones, empresas, sucursales, tickets, anuncios,
 * preautorizaciones, QR (+ áreas, cargos, blacklist, usuarios, reportes).
 *
 *  - Lecturas: la respuesta no debe contener NINGÚN dato del objetivo.
 *  - Escrituras: el estado del objetivo en la BD (md5 de sus filas) no cambia.
 *
 * Controles positivos: el dueño legítimo SÍ accede (la suite no está ciega).
 */
const L = require('./lib');
const { execSync } = require('child_process');

const F = L.fixtures();
const S = new L.Suite('01-idor', 'IDOR entre empresas (A→B) y entre sucursales (A1→A2)');

const Z = '00000000-0000-0000-0000-000000000000';
const snapshot = (suc, emp) => L.psql(`
SELECT md5(coalesce(string_agg(x, '|' ORDER BY x), '')) FROM (
 SELECT 'r:'||id||numero_casa||estado_pago||saldo_pendiente||coalesce(telefono,'') x FROM residentes WHERE sucursal_id='${suc}'
 UNION ALL SELECT 'p:'||id||estado||monto||coalesce(comentario_rechazo,'') FROM pagos WHERE sucursal_id='${suc}'
 UNION ALL SELECT 'l:'||id||estado FROM licencias_dispositivo WHERE sucursal_id='${suc}'
 UNION ALL SELECT 'i:'||id||estado||expira_en FROM invitaciones WHERE sucursal_id='${suc}' OR empresa_id='${emp}'
 UNION ALL SELECT 't:'||id||estado||titulo FROM tickets WHERE sucursal_id='${suc}'
 UNION ALL SELECT 'tm:'||tm.id FROM ticket_mensajes tm JOIN tickets t ON t.id=tm.ticket_id WHERE t.sucursal_id='${suc}'
 UNION ALL SELECT 'a:'||id||titulo||contenido FROM anuncios WHERE sucursal_id='${suc}'
 UNION ALL SELECT 'al:'||l.id FROM anuncio_lecturas l JOIN anuncios a ON a.id=l.anuncio_id WHERE a.sucursal_id='${suc}'
 UNION ALL SELECT 'pre:'||id||activo FROM preautorizaciones WHERE sucursal_id='${suc}'
 UNION ALL SELECT 'qr:'||id||activo||usos_actuales FROM invitaciones_qr WHERE sucursal_id='${suc}'
 UNION ALL SELECT 'ra:'||id||coalesce(timestamp_salida::text,'') FROM registros_acceso WHERE sucursal_id='${suc}'
 UNION ALL SELECT 'ar:'||id||nombre||activa FROM areas_comunes WHERE sucursal_id='${suc}'
 UNION ALL SELECT 'rv:'||rv.id||estado FROM reservas_areas rv JOIN areas_comunes ac ON ac.id=rv.area_id WHERE ac.sucursal_id='${suc}'
 UNION ALL SELECT 'cc:'||id||nombre||monto||activo FROM configuracion_cargos WHERE sucursal_id='${suc}'
 UNION ALL SELECT 'cp:'||id||nombre||monto||activo FROM cargos_programados WHERE sucursal_id='${suc}'
 UNION ALL SELECT 'bl:'||id||activo FROM visitante_blacklist WHERE sucursal_id='${suc}'
 UNION ALL SELECT 'cq:'||sucursal_id||dpi_obligatorio_individual||requiere_placa FROM configuracion_qr WHERE sucursal_id='${suc}'
 UNION ALL SELECT 'cr:'||sucursal_id||permite_cancelacion FROM configuracion_reservas WHERE sucursal_id='${suc}'
 UNION ALL SELECT 's:'||id||nombre||activo FROM sucursales WHERE id='${suc}' OR empresa_id='${emp}'
 UNION ALL SELECT 'u:'||id||rol||activo||coalesce(sucursal_id::text,'')||coalesce(empresa_id::text,'') FROM usuarios WHERE sucursal_id='${suc}' OR empresa_id='${emp}'
 UNION ALL SELECT 'e:'||id||nombre||activo||suspendida FROM empresas WHERE id='${emp}'
) q`);

/** Objetivos: qué se ataca y qué tokens lo atacan. */
const objetivo = (clave, sucKey, empId, marcadores, atacantes, sevLectura, sevEscritura, etiqueta) => {
  const d = F.datos[sucKey];
  return {
    clave, etiqueta, suc: F.sucursales[sucKey], emp: empId || Z, d,
    res: F.residentes[sucKey],
    adminUser: sucKey === 'B1' ? F.usuarios.adminSucB1 : sucKey === 'A2' ? F.usuarios.adminSucA2 : F.usuarios.adminSucA1,
    agenteUser: sucKey === 'B1' ? F.usuarios.agenteB1 : F.usuarios.adminSucA2,
    marcadores, atacantes, sevLectura, sevEscritura,
  };
};
const OBJETIVOS = [
  objetivo('B', 'B1', F.empresas.B,
    ['-B1', 'B1-01', 'Sucursal B1', 'Empresa B', 'sectest.local/b', F.sucursales.B1, F.residentes.B1, F.empresas.B, F.usuarios.adminSucB1, F.usuarios.resB1,
      ...Object.values(F.datos.B1), ...Object.values(F.invitaciones).filter(Boolean).map(i => i.id).filter(id => id === F.invitaciones.B.id || id === F.invitaciones['owner-B'].id),
      L.EMAIL.adminEmpB, L.EMAIL.adminSucB1, L.EMAIL.agenteB1, L.EMAIL.resB1, 'ST-DPI-0002'],
    ['adminEmpA', 'adminSucA1', 'agenteA1', 'resA1'], 'alta', 'crítica', 'empresa B (ajena)'),
  objetivo('A2', 'A2', null,
    ['-A2', 'A2-01', 'Sucursal A2', F.sucursales.A2, F.residentes.A2, F.usuarios.adminSucA2, F.usuarios.resA2, ...Object.values(F.datos.A2), F.invitaciones.A.id, L.EMAIL.adminSucA2, L.EMAIL.resA2],
    ['adminSucA1', 'agenteA1', 'resA1'], 'media', 'alta', 'sucursal A2 (misma empresa)'),
];

/** Lecturas: [id, ruta] — la ruta puede incluir ?sucursal_id=… para forzar el alcance. */
const lecturas = T => [
  ['residentes-lista',          `/api/residentes`],
  ['residentes-lista-forzada',  `/api/residentes?sucursal_id=${T.suc}`],
  ['residentes-id',             `/api/residentes/${T.res}`],
  ['residentes-pago',           `/api/residentes/${T.res}/pago`],
  ['accesos-activos',           `/api/accesos/activos?sucursal_id=${T.suc}`],
  ['accesos-mis',               `/api/accesos/mis?residente_id=${T.res}`],
  ['pagos-lista',               `/api/pagos?sucursal_id=${T.suc}`],
  ['pagos-pendientes',          `/api/pagos/pendientes-verificacion?sucursal_id=${T.suc}`],
  ['pagos-mis',                 `/api/pagos/mis?residente_id=${T.res}`],
  ['licencias-lista',           `/api/licencias?sucursal_id=${T.suc}`],
  ['invitaciones-lista',        `/api/invitaciones?empresa_id=${T.emp}`],
  ['sucursales-lista',          `/api/sucursales?empresa_id=${T.emp}`],
  ['empresas-stats',            `/api/empresas/${T.emp === Z ? F.empresas.A : T.emp}/stats`],
  ['tickets-lista',             `/api/tickets?sucursal_id=${T.suc}`],
  ['tickets-mensajes',          `/api/tickets/${T.d.ticket}/mensajes`],
  ['anuncios-lista',            `/api/anuncios?sucursal_id=${T.suc}`],
  ['anuncios-mis',              `/api/anuncios/mis?residente_id=${T.res}`],
  ['preautorizaciones-lista',   `/api/preautorizaciones?sucursal_id=${T.suc}`],
  ['preautorizaciones-buscar',  `/api/preautorizaciones/buscar?dpi=ST-PRE-DPI-${T.clave === 'B' ? 'B1' : 'A2'}`],
  ['preautorizaciones-mis',     `/api/preautorizaciones/mis?residente_id=${T.res}`],
  ['qr-verificar',              `/api/invitaciones-qr/verificar/${T.d.invitacion_qr}`],
  ['qr-mis',                    `/api/invitaciones-qr/mis?residente_id=${T.res}`],
  ['areas-lista',               `/api/areas?sucursal_id=${T.suc}`],
  ['cargos-config',             `/api/configuracion-cargos?sucursal_id=${T.suc}`],
  ['cargos-programados',        `/api/cargos-programados?sucursal_id=${T.suc}`],
  ['cargos-historial',          `/api/cargos-programados/${T.d.cargo_programado}/historial`],
  ['blacklist-lista',           `/api/blacklist?sucursal_id=${T.suc}`],
  ['usuarios-lista',            `/api/usuarios?sucursal_id=${T.suc}&empresa_id=${T.emp}`],
  ['usuarios-sucursal',         `/api/usuarios/sucursal?sucursal_id=${T.suc}`],
  ['reportes-accesos',          `/api/reportes/accesos?sucursal_id=${T.suc}`],
  ['reportes-pagos',            `/api/reportes/pagos?sucursal_id=${T.suc}`],
  ['reportes-estadisticas',     `/api/reportes/estadisticas?sucursal_id=${T.suc}`],
  ['dashboard',                 `/api/dashboard?sucursal_id=${T.suc}`],
  ['visitantes-dpi',            `/api/visitantes?dpi=ST-DPI-0002`],
  ['visitantes-buscar',         `/api/visitantes/buscar?q=ST%20Visitante&residente_id=${T.res}`],
  ['config-qr',                 `/api/config-qr?sucursal_id=${T.suc}`],
  ['config-reservas',           `/api/config-reservas?sucursal_id=${T.suc}`],
  ['reservas-lista',            `/api/reservas?sucursal_id=${T.suc}`],
  ['reservas-disponibilidad',   `/api/reservas/disponibilidad?area_id=${T.d.area}&fecha=2030-01-01`],
  ['reservas-preview-cancel',   `/api/reservas/${T.d.reserva}/preview-cancelacion`],
];

/** Escrituras: [id, método, ruta, body]. */
const escrituras = T => [
  ['residentes-PUT',        'PUT',    `/api/residentes/${T.res}`, { numero_casa: 'HACK-1', saldo_pendiente: 0 }],
  ['residentes-DELETE',     'DELETE', `/api/residentes/${T.res}`],
  ['residentes-POST',       'POST',   `/api/residentes`, { nombre: 'ST hack', email: `st.hack.res.${T.clave}@sectest.local`, password: 'Hack12345a', numero_casa: 'HACK-9', sucursal_id: T.suc }],
  ['accesos-salida-PATCH',  'PATCH',  `/api/accesos/${T.d.registro_acceso}/salida`, {}],
  ['accesos-salida-PUT',    'PUT',    `/api/accesos/${T.d.registro_acceso}/salida`, {}],
  ['accesos-POST',          'POST',   `/api/accesos`, { nombre_visitante: 'ST hack', numero_dpi: 'ST-HACK-DPI', residente_id: T.res }],
  ['pagos-aprobar',         'PUT',    `/api/pagos/${T.d.pago}/aprobar`, {}],
  ['pagos-rechazar',        'PUT',    `/api/pagos/${T.d.pago}/rechazar`, { comentario_rechazo: 'HACK' }],
  ['pagos-POST',            'POST',   `/api/pagos`, { residente_id: T.res, monto: 1, comprobante: 'x' }],
  ['licencias-revocar',     'PATCH',  `/api/licencias/${F.licencias[T.clave === 'B' ? 'B1' : 'A1'].id}/revocar`, {}],
  ['licencias-POST',        'POST',   `/api/licencias`, { sucursal_id: T.suc, etiqueta: 'ST-hack' }],
  ['invitaciones-revocar',  'PATCH',  `/api/invitaciones/${F.invitaciones[T.clave === 'B' ? 'B' : 'A'].id}/revocar`, {}],
  ['invitaciones-reenviar', 'POST',   `/api/invitaciones/${F.invitaciones[T.clave === 'B' ? 'B' : 'A'].id}/reenviar`, {}],
  ['invitaciones-POST',     'POST',   `/api/invitaciones`, { email: `st.hack.inv.${T.clave}@sectest.local`, rol_invitado: 'admin_sucursal', sucursal_id: T.suc }],
  ['empresas-PUT',          'PUT',    `/api/empresas/${T.emp === Z ? F.empresas.A : T.emp}`, { nombre: 'HACK' }],
  ['empresas-DELETE',       'DELETE', `/api/empresas/${T.emp === Z ? F.empresas.A : T.emp}`],
  ['empresas-admin',        'POST',   `/api/empresas/${T.emp === Z ? F.empresas.A : T.emp}/admin`, { usuario_id: F.usuarios.cobayaA }],
  ['empresas-suspender',    'PATCH',  `/api/empresas/${T.emp === Z ? F.empresas.A : T.emp}/suspender`, { suspendida: true, motivo: 'HACK' }],
  ['sucursales-PUT',        'PUT',    `/api/sucursales/${T.suc}`, { nombre: 'HACK' }],
  ['sucursales-DELETE',     'DELETE', `/api/sucursales/${T.suc}`],
  ['sucursales-admin',      'POST',   `/api/sucursales/${T.suc}/admin`, { usuario_id: F.usuarios.cobayaA }],
  ['sucursales-POST',       'POST',   `/api/sucursales`, { empresa_id: T.emp === Z ? F.empresas.A : T.emp, nombre: 'ST-hack-suc' }],
  ['tickets-mensaje',       'POST',   `/api/tickets/${T.d.ticket}/mensajes`, { mensaje: 'ST-hack' }],
  ['tickets-cerrar',        'PUT',    `/api/tickets/${T.d.ticket}/cerrar`, {}],
  ['anuncios-PUT',          'PUT',    `/api/anuncios/${T.d.anuncio}`, { titulo: 'HACK', contenido: 'HACK' }],
  ['anuncios-DELETE',       'DELETE', `/api/anuncios/${T.d.anuncio}`],
  ['anuncios-leer',         'POST',   `/api/anuncios/${T.d.anuncio}/leer`, {}],
  ['anuncios-POST',         'POST',   `/api/anuncios`, { titulo: 'ST-hack', contenido: 'x', sucursal_id: T.suc }],
  ['preauto-DELETE',        'DELETE', `/api/preautorizaciones/${T.d.preautorizacion}`],
  ['preauto-mis-DELETE',    'DELETE', `/api/preautorizaciones/mis/${T.d.preautorizacion}`],
  ['preauto-POST',          'POST',   `/api/preautorizaciones`, { residente_id: T.res, nombre_visitante: 'ST-hack', fecha_inicio: '2030-01-01' }],
  ['qr-mis-DELETE',         'DELETE', `/api/invitaciones-qr/mis/${T.d.invitacion_qr}`],
  ['blacklist-DELETE',      'DELETE', `/api/blacklist/${T.d.blacklist}`],
  ['blacklist-POST',        'POST',   `/api/blacklist`, { numero_dpi: 'ST-HACK-DPI', nombre: 'x', razon: 'HACK', sucursal_id: T.suc }],
  ['areas-PUT',             'PUT',    `/api/areas/${T.d.area}`, { nombre: 'HACK' }],
  ['areas-DELETE',          'DELETE', `/api/areas/${T.d.area}`],
  ['areas-POST',            'POST',   `/api/areas`, { nombre: 'ST-hack-area', sucursal_id: T.suc }],
  ['cargos-config-PUT',     'PUT',    `/api/configuracion-cargos/${T.d.config_cargo}`, { nombre: 'HACK', monto: 1 }],
  ['cargos-config-DELETE',  'DELETE', `/api/configuracion-cargos/${T.d.config_cargo}`],
  ['cargos-config-POST',    'POST',   `/api/configuracion-cargos`, { nombre: 'ST-hack', monto: 1, sucursal_id: T.suc }],
  ['cargos-cfg2-PUT',       'PUT',    `/api/cargos/configuracion/${T.d.config_cargo}`, { nombre: 'HACK', monto: 1 }],
  ['cargos-prog-PUT',       'PUT',    `/api/cargos-programados/${T.d.cargo_programado}`, { nombre: 'HACK', monto: 1 }],
  ['cargos-prog-DELETE',    'DELETE', `/api/cargos-programados/${T.d.cargo_programado}`],
  ['cargos-prog-aplicar',   'POST',   `/api/cargos-programados/${T.d.cargo_programado}/aplicar`, {}],
  ['usuarios-DELETE',       'DELETE', `/api/usuarios/${T.adminUser}`],
  ['usuarios-POST',         'POST',   `/api/usuarios`, { nombre: 'ST hack', email: `st.hack.u.${T.clave}@sectest.local`, password: 'Hack12345a', rol: 'agente', sucursal_id: T.suc }],
  ['config-qr-PUT',         'PUT',    `/api/config-qr`, { sucursal_id: T.suc, requiere_placa: true, dpi_obligatorio_individual: false }],
  ['config-reservas-PUT',   'PUT',    `/api/config-reservas`, { sucursal_id: T.suc, permite_cancelacion: false }],
  ['reservas-cancelar',     'PATCH',  `/api/reservas/${T.d.reserva}/cancelar`, { motivo: 'HACK' }],
  ['reservas-aprobar',      'PATCH',  `/api/reservas/${T.d.reserva}/aprobar`, {}],
  ['reservas-rechazar',     'PATCH',  `/api/reservas/${T.d.reserva}/rechazar`, { motivo: 'HACK' }],
  ['reservas-POST',         'POST',   `/api/reservas`, { area_id: T.d.area, residente_id: T.res, fecha: '2030-01-02', hora_inicio: '10:00', hora_fin: '11:00' }],
];

const hayFuga = (r, marcadores) => marcadores.filter(m => m && r.text.includes(m));

(async () => {
  await L.reiniciarBackend();
  const T = await L.tokens(true);

  // ── Controles positivos (el dueño sí accede) ───────────────────────────────
  await S.check({ id: 'CTRL-resB1-propio', titulo: 'Control: residente B ve su propio residente', method: 'GET', path: '/api/residentes/me',
    actor: 'resB1', token: T.resB1, esperado: '200', ok: r => r.status === 200 && r.text.includes(F.residentes.B1) });
  await S.check({ id: 'CTRL-adminEmpB-stats', titulo: 'Control: admin empresa B ve stats de SU empresa', method: 'GET', path: `/api/empresas/${F.empresas.B}/stats`,
    actor: 'adminEmpB', token: T.adminEmpB, esperado: '200', ok: r => r.status === 200 });
  await S.check({ id: 'CTRL-adminEmpA-residenteA2', titulo: 'Control: admin empresa A SÍ ve residentes de su sucursal A2', method: 'GET', path: `/api/residentes/${F.residentes.A2}`,
    actor: 'adminEmpA', token: T.adminEmpA, esperado: '200', ok: r => r.status === 200 });
  await S.check({ id: 'CTRL-adminSucB-tickets', titulo: 'Control: admin sucursal B ve los tickets de SU sucursal', method: 'GET', path: `/api/tickets/${F.datos.B1.ticket}/mensajes`,
    actor: 'adminSucB1', token: T.adminSucB1, esperado: '200 con el mensaje', ok: r => r.status === 200 && r.text.includes('ST-mensaje-privado') });

  let huboCambios = false;
  for (const O of OBJETIVOS) {
    console.log(`\n══ Objetivo: ${O.etiqueta} ══`);
    let base = snapshot(O.suc, O.emp);
    for (const actor of O.atacantes) {
      const tok = T[actor];
      for (const [nombre, ruta] of lecturas(O)) {
        const r = await S.check({
          id: `IDOR-${O.clave}-${actor}-GET-${nombre}`, titulo: `${actor} lee ${nombre} de ${O.etiqueta}`,
          method: 'GET', path: ruta, actor, token: tok,
          esperado: 'sin datos del objetivo (403/404/200 filtrado); nunca 5xx',
          severidad: O.sevLectura,
          ok: rr => rr.status < 500 && hayFuga(rr, O.marcadores).length === 0,
        });
        const fuga = hayFuga(r, O.marcadores);
        if (fuga.length) S.items[S.items.length - 1].nota = `Marcadores del objetivo en la respuesta: ${fuga.slice(0, 4).join(', ')}`;
      }
      for (const [nombre, metodo, ruta, body] of escrituras(O)) {
        const r = await S.check({
          id: `IDOR-${O.clave}-${actor}-${metodo}-${nombre}`, titulo: `${actor} ${metodo} ${nombre} sobre ${O.etiqueta}`,
          method: metodo, path: ruta, actor, token: tok, body,
          esperado: '4xx y el objetivo queda intacto en la BD',
          severidad: O.sevEscritura,
          ok: rr => rr.status < 500,   // el veredicto real lo da el snapshot, abajo
        });
        const despues = snapshot(O.suc, O.emp);
        const it = S.items[S.items.length - 1];
        if (despues !== base) {
          huboCambios = true;
          it.resultado = 'FALLA';
          it.severidad = O.sevEscritura;
          it.nota = `El estado del objetivo CAMBIÓ en la BD (md5 ${base.slice(0, 8)} → ${despues.slice(0, 8)}).`;
          console.log(`  ^^^ MODIFICÓ el objetivo: ${it.id} → HTTP ${r.status}`);
          base = despues;
        } else if (r.status >= 200 && r.status < 300) {
          it.nota = '2xx pero sin efecto sobre el objetivo (la operación se aplicó al propio alcance del actor o se ignoró).';
        }
        if (r.status >= 500) { it.resultado = 'FALLA'; it.severidad = 'baja'; it.nota = 'Error 5xx ante un identificador ajeno.'; }
      }
    }
  }

  const fallas = S.save();
  // Siempre se restaura: los actores con acceso legítimo a su propio alcance también dejan efectos
  // (p. ej. revocar la licencia de SU sucursal) que no deben contaminar las suites siguientes.
  console.log(huboCambios ? '\nHubo modificaciones cruzadas: restaurando "seeded"…' : '\nRestaurando "seeded" (efectos legítimos en el propio alcance)…');
  execSync(`${__dirname}/snapshot.sh restore seeded`, { stdio: 'inherit' });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
