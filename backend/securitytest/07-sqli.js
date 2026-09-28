'use strict';
/**
 * Inyección SQL con payloads manuales sobre TODOS los parámetros de búsqueda,
 * filtro, ruta y cuerpo del API (complementa a sqlmap: ver run-sqlmap.sh).
 *
 * Para cada punto de inyección se envían payloads de cuatro clases y se busca:
 *   - basados en error: 5xx o texto de PostgreSQL / stack en la respuesta,
 *   - basados en tiempo: pg_sleep(3) → la respuesta tarda ≥ 2.5 s,
 *   - booleanos (solo en búsquedas): `x' OR '1'='1` devuelve algo distinto de `x`,
 *   - apilados: un UPDATE/DROP contra una tabla canario (st_canary) y empresas.
 */
const L = require('./lib');
const { execSync } = require('child_process');

const F = L.fixtures();
const S = new L.Suite('07-sqli', 'Inyección SQL: payloads manuales en parámetros de búsqueda, ruta y cuerpo');

const PAYLOADS = [
  "'", '"', '\\', "' OR '1'='1", "' OR 1=1--", "' UNION SELECT NULL,NULL,NULL--", "1' ORDER BY 100--",
  "'; SELECT pg_sleep(3)--", "'||(SELECT pg_sleep(3))||'", '1;SELECT pg_sleep(3)', "' AND (SELECT 1 FROM pg_sleep(3))--",
  "'; UPDATE empresas SET nombre='SQLI-CANARY';--", "'; DROP TABLE st_canary;--", "%' OR '1'='1", '\u0000', "1 OR 1=1",
];
const MINI = ["'", "' OR '1'='1", "'; SELECT pg_sleep(3)--"];
const ERR_SQL = /syntax error|postgres|pg_catalog|unterminated|does not exist|invalid input syntax|violates|ERROR:|\bat\s+\S+\.(ts|js):\d+|node_modules|SQLSTATE|stack/i;

let T;
const canarioOk = () =>
  L.psql(`SELECT (SELECT count(*) FROM st_canary)||'|'||(SELECT count(*) FROM empresas WHERE nombre='SQLI-CANARY')`) === '1|0';

/** Evalúa una respuesta a un payload. Devuelve null si está bien o {sev, motivo}. */
const evaluar = (r, payload) => {
  if (r.ms >= 2500 && /sleep/.test(payload)) return { sev: 'crítica', motivo: `respuesta en ${Math.round(r.ms)} ms con payload de tiempo (pg_sleep ejecutado)` };
  if (ERR_SQL.test(r.text)) return { sev: 'alta', motivo: `la respuesta contiene texto de error interno: ${r.text.slice(0, 100)}` };
  if (r.status >= 500) return { sev: 'baja', motivo: `HTTP ${r.status} ante entrada hostil (sin texto de SQL en la respuesta)` };
  return null;
};

const puntos = [];
const query = (id, ruta, tk, payloads = PAYLOADS) => puntos.push({ id, tipo: 'query', metodo: 'GET', ruta, tk, payloads });
const cuerpo = (id, metodo, ruta, base, tk, opts = {}) => puntos.push({ id, tipo: 'body', metodo, ruta, base, tk, payloads: opts.payloads || PAYLOADS, reinicio: opts.reinicio, cookie: opts.cookie, campos: opts.campos });
const ruta_ = (id, ruta, tk, metodo = 'GET') => puntos.push({ id, tipo: 'ruta', metodo, ruta, tk, payloads: PAYLOADS });

// ── Parámetros de búsqueda y filtro (GET) ────────────────────────────────────
query('visitantes-dpi',            '/api/visitantes?dpi={P}',                                   'agenteA1');
query('visitantes-buscar-q',       '/api/visitantes/buscar?q={P}',                              'agenteA1');
query('visitantes-buscar-residente', '/api/visitantes/buscar?q=abcd&residente_id={P}',          'agenteA1');
query('preauto-buscar-dpi',        '/api/preautorizaciones/buscar?dpi={P}',                     'agenteA1');
query('preauto-buscar-placa',      '/api/preautorizaciones/buscar?placa={P}',                   'agenteA1');
query('accesos-activo-placa',      '/api/accesos/activo?placa={P}',                             'agenteA1');
for (const p of ['desde', 'hasta']) {
  query(`reportes-accesos-${p}`,   `/api/reportes/accesos?${p === 'desde' ? 'desde={P}&hasta=2030-01-01' : 'desde=2020-01-01&hasta={P}'}`, 'adminSucA1');
  query(`reportes-pagos-${p}`,     `/api/reportes/pagos?${p === 'desde' ? 'desde={P}&hasta=2030-01-01' : 'desde=2020-01-01&hasta={P}'}`, 'adminSucA1');
  query(`reportes-estadisticas-${p}`, `/api/reportes/estadisticas?${p === 'desde' ? 'desde={P}&hasta=2030-01-01' : 'desde=2020-01-01&hasta={P}'}`, 'adminSucA1');
}
for (const p of ['accion', 'usuario_id', 'desde', 'hasta', 'limit', 'offset']) query(`audit-logs-${p}`, `/api/audit-logs?${p}={P}`, 'owner');
query('areas-activa',              '/api/areas?activa={P}',                                     'adminSucA1');
for (const p of ['area_id', 'estado', 'fecha_desde', 'fecha_hasta']) query(`reservas-${p}`, `/api/reservas?${p}={P}`, 'adminSucA1');
query('reservas-disp-area',        '/api/reservas/disponibilidad?area_id={P}&fecha=2030-01-01', 'adminSucA1');
query('reservas-disp-fecha',       `/api/reservas/disponibilidad?area_id=${F.datos.A1.area}&fecha={P}`, 'adminSucA1');
query('config-qr-sucursal',        '/api/config-qr?sucursal_id={P}',                            'owner');
query('config-reservas-sucursal',  '/api/config-reservas?sucursal_id={P}',                      'owner');
query('sucursales-empresa',        '/api/sucursales?empresa_id={P}',                            'adminEmpA');
query('usuarios-sucursal-param',   '/api/usuarios?sucursal_id={P}',                             'adminEmpA');
query('dashboard-param',           '/api/dashboard?sucursal_id={P}',                            'agenteA1');

// ── Parámetros de ruta ───────────────────────────────────────────────────────
ruta_('ruta-residentes-id',        '/api/residentes/{P}',                'adminSucA1');
ruta_('ruta-residentes-pago',      '/api/residentes/{P}/pago',           'adminSucA1');
ruta_('ruta-tickets-mensajes',     '/api/tickets/{P}/mensajes',          'resA1');
ruta_('ruta-empresas-stats',       '/api/empresas/{P}/stats',            'adminEmpA');
ruta_('ruta-cargos-historial',     '/api/cargos-programados/{P}/historial', 'adminSucA1');
ruta_('ruta-reservas-preview',     '/api/reservas/{P}/preview-cancelacion', 'adminSucA1');
ruta_('ruta-qr-verificar',         '/api/invitaciones-qr/verificar/{P}', 'agenteA1');
ruta_('ruta-invitaciones-token',   '/api/invitaciones/{P}',              null);
ruta_('ruta-licencias-revocar',    '/api/licencias/{P}/revocar',         'adminSucA1', 'PATCH');
ruta_('ruta-usuarios-delete',      '/api/usuarios/{P}',                  'adminSucA1', 'DELETE');
ruta_('ruta-anuncios-delete',      '/api/anuncios/{P}',                  'adminSucA1', 'DELETE');

// ── Cuerpos JSON (cada campo de texto, uno a uno) ────────────────────────────
cuerpo('body-residentes-POST',      'POST', '/api/residentes', { nombre: 'ST sqli', email: 'st.sqli.res@sectest.local', password: 'Sqli12345a', numero_casa: 'SQ-1', telefono: '50255550001' }, 'adminSucA1');
cuerpo('body-usuarios-POST',        'POST', '/api/usuarios', { nombre: 'ST sqli', email: 'st.sqli.usr@sectest.local', password: 'Sqli12345a', rol: 'agente' }, 'adminSucA1');
cuerpo('body-anuncios-POST',        'POST', '/api/anuncios', { titulo: 'ST sqli', contenido: 'x', prioridad: 'normal' }, 'adminSucA1');
cuerpo('body-tickets-POST',         'POST', '/api/tickets', { tipo: 'otro', titulo: 'ST sqli', mensaje: 'x' }, 'resA1');
cuerpo('body-tickets-mensaje',      'POST', `/api/tickets/${F.datos.A1.ticket}/mensajes`, { mensaje: 'x' }, 'resA1');
cuerpo('body-preauto-mis',          'POST', '/api/preautorizaciones/mis', { nombre_visitante: 'ST sqli', numero_dpi: '1234567890123', placa: 'P123ABC', fecha_inicio: '2030-01-01', fecha_fin: '2030-02-01' }, 'resA1');
cuerpo('body-qr-mis',               'POST', '/api/invitaciones-qr/mis', { tipo: 'individual', etiqueta: 'ST sqli', nombre_visitante: 'ST', numero_dpi: '1234567890123', placa: 'P123ABC', fecha_inicio: '2030-01-01', fecha_fin: '2030-02-01', usos_maximos: 1 }, 'resA1');
cuerpo('body-blacklist-POST',       'POST', '/api/blacklist', { numero_dpi: '9999999999999', nombre: 'ST sqli', razon: 'x' }, 'adminSucA1');
cuerpo('body-areas-POST',           'POST', '/api/areas', { nombre: 'ST sqli', descripcion: 'x' }, 'adminSucA1');
cuerpo('body-config-cargos-POST',   'POST', '/api/configuracion-cargos', { nombre: 'ST sqli', monto: 1, frecuencia: 'mensual' }, 'adminSucA1');
cuerpo('body-cargos-prog-POST',     'POST', '/api/cargos-programados', { nombre: 'ST sqli', descripcion: 'x', monto: 1, frecuencia: 'mensual', aplica_a: 'todos' }, 'adminSucA1');
cuerpo('body-accesos-POST',         'POST', '/api/accesos', { nombre_visitante: 'ST sqli', numero_dpi: '1234567890123', residente_id: F.residentes.A1, placa: 'P123ABC', notas: 'x' }, 'agenteA1');
cuerpo('body-licencias-POST',       'POST', '/api/licencias', { etiqueta: 'ST sqli' }, 'adminSucA1');
cuerpo('body-invitaciones-POST',    'POST', '/api/invitaciones', { email: 'st.sqli.inv@sectest.local', rol_invitado: 'admin_empresa', empresa_nombre: 'ST sqli' }, 'owner');
cuerpo('body-empresas-POST',        'POST', '/api/empresas', { nombre: 'ST sqli', nit: '123' }, 'owner');
cuerpo('body-sucursales-POST',      'POST', '/api/sucursales', { empresa_id: F.empresas.A, nombre: 'ST sqli', direccion: 'x', tipo: 'x' }, 'owner');
cuerpo('body-pagos-transferencia',  'POST', '/api/pagos/transferencia', { monto: 1, referencia: 'ST-REF-SQLI', banco: 'x', fecha_transferencia: '2030-01-01', comprobante: 'x' }, 'resA1');
cuerpo('body-pagos-POST',           'POST', '/api/pagos', { residente_id: F.residentes.A1, monto: 1, comprobante: 'x' }, 'adminSucA1');
cuerpo('body-reservas-POST',        'POST', '/api/reservas', { area_id: F.datos.A1.area, fecha: '2030-03-01', hora_inicio: '10:00', hora_fin: '11:00' }, 'resA1');
cuerpo('body-preferencias-PUT',     'PUT',  '/api/usuarios/me/preferencias', { idioma: 'es', tema: 'dark' }, 'resA1');
cuerpo('body-residentes-PUT',       'PUT',  `/api/residentes/${F.residentes.A1}`, { numero_casa: 'ST-A1-01', estado_pago: 'pendiente', telefono: '50255550000' }, 'adminSucA1');
cuerpo('body-empresas-PUT',         'PUT',  `/api/empresas/${F.empresas.A}`, { nombre: 'ST Empresa A', nit: 'ST-NIT' }, 'owner');
cuerpo('body-config-qr-PUT',        'PUT',  '/api/config-qr', { max_intentos_fallidos: 5 }, 'adminSucA1');
// Con límites propios: se reinicia el contador y se usan pocos payloads.
cuerpo('body-login',                'POST', '/api/auth/login', { email: L.EMAIL.resA1, password: L.PW }, null, { payloads: MINI.concat(["admin'--", '" OR ""="']), reinicio: true });
cuerpo('body-activar',              'POST', '/api/licencias/activar', { codigo: 'SG-AAAA-BBBB-CCCC-DDDD', fingerprint: 'a'.repeat(64), nombre_dispositivo: 'x' }, null, { payloads: MINI, reinicio: true });
cuerpo('body-eliminar-definitivo',  'POST', `/api/empresas/${F.empresas.A}/eliminar-definitivo`, { password: 'x' }, 'owner', { payloads: MINI.slice(0, 3), reinicio: true, campos: ['password'] });

const construir = (pt, payload) => {
  const enc = encodeURIComponent(payload);
  if (pt.tipo === 'body') return null;
  return pt.ruta.replace('{P}', enc);
};

(async () => {
  await L.reiniciarBackend();
  T = await L.tokens(true);
  L.psql(`CREATE TABLE IF NOT EXISTS st_canary (x int); DELETE FROM st_canary; INSERT INTO st_canary VALUES (1)`);

  // Login de control: la inyección clásica no da acceso.
  for (const [p, campo] of [["' OR '1'='1", 'password'], ["' OR '1'='1' --", 'password'], ["st.owner@sectest.local'--", 'email']]) {
    await S.check({ id: `SQLI-login-bypass-${campo}-${p.length}`, titulo: `Login con ${campo} = ${p}`, method: 'POST', path: '/api/auth/login', actor: 'anónimo',
      body: campo === 'password' ? { email: L.EMAIL.owner, password: p } : { email: p, password: 'x'.repeat(8) }, esperado: '4xx (nunca 200)', severidad: 'crítica',
      ok: r => r.status >= 400 && r.status < 500 && !r.json?.token });
  }

  let total = 0, malos = 0;
  for (const pt of puntos) {
    if (pt.reinicio) await L.reiniciarBackend();
    const token = pt.tk ? T[pt.tk] : undefined;

    // Base (línea de comparación para booleanos).
    let baseTxt = null;
    if (pt.tipo === 'query') { const b = await L.call('GET', construir(pt, 'zzzz'), { token }); baseTxt = `${b.status}|${b.text.length}`; }

    const campos = pt.tipo === 'body'
      ? (pt.campos || Object.keys(pt.base).filter(k => typeof pt.base[k] === 'string'))
      : [null];
    for (const campo of campos) {
      for (const payload of pt.payloads) {
        let r;
        if (pt.tipo === 'body') {
          const body = { ...pt.base, [campo]: payload };
          r = await L.call(pt.metodo, pt.ruta, { token, body });
        } else {
          r = await L.call(pt.metodo, construir(pt, payload), { token, body: pt.metodo === 'GET' ? undefined : {} });
        }
        total++;
        const mal = evaluar(r, payload);
        // Booleano: solo búsquedas; `' OR '1'='1` no debe cambiar el resultado respecto a un texto sin coincidencias.
        let bool = null;
        if (!mal && pt.tipo === 'query' && /^' OR '1'='1$|^' OR 1=1--$|^%' OR '1'='1$/.test(payload) && /dpi=|q=|placa=|activa=|estado=/.test(pt.ruta)) {
          const cmp = `${r.status}|${r.text.length}`;
          if (cmp !== baseTxt && r.status === 200 && r.text.length > 2) bool = { sev: 'alta', motivo: `el payload booleano cambia el resultado (${baseTxt} → ${cmp})` };
        }
        const hallazgo = mal || bool;
        if (hallazgo) {
          malos++;
          S.registrar({
            id: `SQLI-${pt.id}${campo ? '-' + campo : ''}-p${PAYLOADS.indexOf(payload)}`, titulo: `${pt.metodo} ${pt.id}${campo ? ' campo ' + campo : ''} con payload ${JSON.stringify(payload).slice(0, 60)}`,
            request: { method: pt.metodo, path: pt.tipo === 'body' ? pt.ruta : construir(pt, payload), actor: pt.tk || 'anónimo', body: pt.tipo === 'body' ? JSON.stringify({ [campo]: payload }) : undefined },
            esperado: 'sin 5xx, sin texto de SQL, sin retardo, sin cambio booleano',
            real: { status: r.status, body: r.text.slice(0, 200), ms: Math.round(r.ms) }, resultado: 'FALLA', severidad: hallazgo.sev, nota: hallazgo.motivo,
          });
        }
      }
    }
    // Canario tras cada punto.
    if (!canarioOk()) {
      S.registrar({ id: `SQLI-canario-${pt.id}`, titulo: `El canario (st_canary / empresas) fue alterado tras inyectar en ${pt.id}`, esperado: 'intacto',
        request: { method: 'SQL', path: 'SELECT count(*) FROM st_canary', actor: 'psql' }, real: { status: 0, body: 'canario alterado' }, resultado: 'FALLA', severidad: 'crítica' });
      L.psql(`CREATE TABLE IF NOT EXISTS st_canary (x int); DELETE FROM st_canary; INSERT INTO st_canary VALUES (1); UPDATE empresas SET nombre='ST Empresa A' WHERE id='${F.empresas.A}'`);
    }
    console.log(`  punto ${pt.id.padEnd(34)} ${campos.length * pt.payloads.length} envíos`);
  }

  S.registrar({ id: 'SQLI-resumen', titulo: `${puntos.length} puntos de inyección, ${total} peticiones con payloads`, esperado: '0 anomalías',
    request: { method: '-', path: '-', actor: '-' }, real: { status: 0, body: `${total} peticiones; anomalías: ${malos}` }, resultado: malos === 0 ? 'OK' : 'INFO',
    nota: 'Las clases: error (5xx / texto SQL), tiempo (pg_sleep), booleana, apilada (canario).' });

  L.psql('DROP TABLE IF EXISTS st_canary');
  S.save();
  execSync(`${__dirname}/snapshot.sh restore seeded`, { stdio: 'inherit' });
})().catch(e => { console.error(e); process.exit(1); });
