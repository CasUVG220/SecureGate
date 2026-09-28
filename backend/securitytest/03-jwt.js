'use strict';
/**
 * JWT y sesiones: token de licencia ↔ token de usuario, vencido, firma
 * alterada, alg:none / confusión de algoritmo, revocación, refresh token.
 * El secreto se lee del contenedor local (nunca se imprime ni se guarda).
 */
const L = require('./lib');
const { execSync } = require('child_process');

const F = L.fixtures();
const S = new L.Suite('03-jwt', 'JWT: licencia vs usuario, vencido, firma alterada, alg:none, revocación, refresh');
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

(async () => {
  await L.reiniciarBackend();
  const T = await L.tokens(true);
  const jwt = L.jwt();
  const secret = L.jwtSecret();
  const licA1 = F.licencias.A1.token;
  const licB1 = F.licencias.B1.token;

  const claims = p => JSON.parse(Buffer.from(p.split('.')[1], 'base64url').toString());
  const { iat: _i, exp: _e, ...base } = claims(T.resA1);   // payload real de un residente de A, sin iat/exp
  const RUTA_AUTH = '/api/residentes/me';
  const RUTA_OWNER = '/api/empresas';               // solo owner: un 200 = escalación total
  const forjar = (payload, opts = {}) => jwt.sign(payload, secret, { algorithm: 'HS256', ...opts });
  const sinBearer = (t) => ({ headers: { Authorization: t } });

  const rechaza = (r) => r.status === 401 || r.status === 403;

  // ── 1. Token de licencia usado como token de usuario ──────────────────────
  for (const [ruta, nombre] of [[RUTA_AUTH, 'residentes/me'], ['/api/dashboard', 'dashboard (staff)'], ['/api/accesos/activos', 'accesos/activos (staff)'],
                                ['/api/reservas/mis-reservas', 'reservas/mis-reservas'], ['/api/sync/garita', 'sync/garita (staff+licencia)']]) {
    await S.check({ id: `JWT-lic-como-usuario-${nombre.split(' ')[0].replace('/', '-')}`, titulo: `Token de LICENCIA en Authorization sobre ${nombre}`,
      method: 'GET', path: ruta, actor: 'token de licencia A1', token: licA1, licencia: ruta === '/api/sync/garita' ? licA1 : undefined,
      esperado: '403 (typ: licencia no vale como sesión)', severidad: 'crítica', ok: rechaza });
  }

  // ── 2. Token de usuario usado como token de licencia ──────────────────────
  await S.check({ id: 'JWT-usuario-como-licencia-heartbeat', titulo: 'JWT de agente en X-Licencia-Token sobre /licencias/heartbeat',
    method: 'POST', path: '/api/licencias/heartbeat', actor: 'JWT de agenteA1 como licencia', licencia: T.agenteA1, body: {},
    esperado: '403', severidad: 'alta', ok: rechaza });
  await S.check({ id: 'JWT-usuario-como-licencia-sync', titulo: 'JWT de agente en X-Licencia-Token sobre /sync/garita',
    method: 'GET', path: '/api/sync/garita', actor: 'agenteA1 + JWT de usuario como licencia', token: T.agenteA1, licencia: T.agenteA1,
    esperado: '403', severidad: 'alta', ok: rechaza });
  await S.check({ id: 'JWT-usuario-como-licencia-accesos', titulo: 'POST /accesos con JWT de agente en X-Licencia-Token',
    method: 'POST', path: '/api/accesos', actor: 'agenteA1 + JWT de usuario como licencia', token: T.agenteA1, licencia: T.agenteA1,
    body: { nombre_visitante: 'ST jwt', numero_dpi: 'ST-JWT-1', residente_id: F.residentes.A1 },
    esperado: '403', severidad: 'alta', ok: rechaza });

  // ── 3. Licencia de OTRA sucursal con sesión de agente ─────────────────────
  await S.check({ id: 'JWT-licencia-otra-sucursal-sync', titulo: 'Agente de A1 + licencia de B1 en /sync/garita',
    method: 'GET', path: '/api/sync/garita', actor: 'agenteA1 + licencia B1', token: T.agenteA1, licencia: licB1,
    esperado: '403 (sesión y licencia de sucursales distintas)', severidad: 'alta', ok: rechaza });
  await S.check({ id: 'JWT-licencia-otra-sucursal-accesos', titulo: 'Agente de A1 + licencia de B1 en POST /accesos',
    method: 'POST', path: '/api/accesos', actor: 'agenteA1 + licencia B1', token: T.agenteA1, licencia: licB1,
    body: { nombre_visitante: 'ST jwt', numero_dpi: 'ST-JWT-2', residente_id: F.residentes.A1 },
    esperado: '403', severidad: 'alta', ok: rechaza });
  await S.check({ id: 'CTRL-licencia-propia-sync', titulo: 'Control: agente de A1 + licencia de A1 sincroniza',
    method: 'GET', path: '/api/sync/garita', actor: 'agenteA1 + licencia A1', token: T.agenteA1, licencia: licA1,
    esperado: '200', ok: r => r.status === 200 });

  // ── 4. Token vencido ───────────────────────────────────────────────────────
  const vencido = forjar(base, { expiresIn: -60 });
  await S.check({ id: 'JWT-vencido', titulo: 'Token de usuario vencido hace 60 s', method: 'GET', path: RUTA_AUTH, actor: 'JWT exp<now', token: vencido,
    esperado: '403 (o 401)', severidad: 'alta', ok: rechaza });
  const vencidoOwner = forjar({ ...base, rol: 'owner', sucursal_id: null, empresa_id: null }, { expiresIn: -1 });
  await S.check({ id: 'JWT-vencido-owner', titulo: 'Token de owner vencido hace 1 s', method: 'GET', path: RUTA_OWNER, actor: 'JWT owner exp<now', token: vencidoOwner,
    esperado: '403 (o 401)', severidad: 'crítica', ok: rechaza });
  await S.check({ id: 'JWT-nbf-futuro', titulo: 'Token con nbf 1 h en el futuro', method: 'GET', path: RUTA_AUTH, actor: 'JWT nbf>now',
    token: forjar(base, { expiresIn: '2h', notBefore: '1h' }), esperado: '403 (o 401)', severidad: 'media', ok: rechaza });
  await S.check({ id: 'JWT-licencia-vencida-heartbeat', titulo: 'Token de licencia vencido en /licencias/heartbeat',
    method: 'POST', path: '/api/licencias/heartbeat', actor: 'licencia exp<now', body: {},
    licencia: jwt.sign({ typ: 'licencia', lic: F.licencias.A1.id, sucursal_id: F.sucursales.A1, empresa_id: F.empresas.A, fp: 'x' }, secret, { expiresIn: -60 }),
    esperado: '403', severidad: 'alta', ok: rechaza });

  // ── 5. Firma alterada ──────────────────────────────────────────────────────
  const [h, p, sig] = T.resA1.split('.');
  const pOwner = b64({ ...base, rol: 'owner', sucursal_id: null, empresa_id: null });
  await S.check({ id: 'JWT-payload-alterado', titulo: 'Payload cambiado a rol owner con la firma original', method: 'GET', path: RUTA_OWNER,
    actor: 'JWT con payload manipulado', token: `${h}.${pOwner}.${sig}`, esperado: '403', severidad: 'crítica', ok: rechaza });
  // Se altera el PRIMER carácter: el último de una firma HMAC-SHA256 en base64url solo aporta 4 bits útiles y
  // cambiarlo puede dejar los mismos bytes.
  const sigMala = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  await S.check({ id: 'JWT-firma-alterada', titulo: 'Primer carácter de la firma modificado', method: 'GET', path: RUTA_AUTH, actor: 'JWT firma alterada',
    token: `${h}.${p}.${sigMala}`, esperado: '403', severidad: 'crítica', ok: rechaza });
  await S.check({ id: 'JWT-firma-vacia', titulo: 'Firma vacía con alg HS256', method: 'GET', path: RUTA_OWNER, actor: 'JWT sin firma', token: `${h}.${pOwner}.`,
    esperado: '403', severidad: 'crítica', ok: rechaza });
  await S.check({ id: 'JWT-firma-otro-secreto', titulo: 'Token de owner firmado con un secreto distinto', method: 'GET', path: RUTA_OWNER, actor: 'JWT firmado con secreto ajeno',
    token: jwt.sign({ ...base, rol: 'owner', sucursal_id: null, empresa_id: null }, 'otro-secreto-cualquiera-de-32-caracteres!!', { expiresIn: '1h' }),
    esperado: '403', severidad: 'crítica', ok: rechaza });
  await S.check({ id: 'JWT-secretos-conocidos', titulo: 'Token de owner firmado con los secretos públicos históricos del repo', method: 'GET', path: RUTA_OWNER,
    actor: 'JWT con secretos: securegate_jwt_secret_dev / change_me_in_production', esperado: '403 (ninguno vale)', severidad: 'crítica',
    token: jwt.sign({ ...base, rol: 'owner', sucursal_id: null, empresa_id: null }, 'securegate_jwt_secret_dev', { expiresIn: '1h' }), ok: rechaza });
  await S.check({ id: 'JWT-secretos-conocidos-2', titulo: 'Ídem con change_me_in_production', method: 'GET', path: RUTA_OWNER, actor: 'JWT con secreto change_me_in_production',
    esperado: '403', severidad: 'crítica',
    token: jwt.sign({ ...base, rol: 'owner', sucursal_id: null, empresa_id: null }, 'change_me_in_production', { expiresIn: '1h' }), ok: rechaza });

  // ── 6. alg:none y confusión de algoritmo ───────────────────────────────────
  const ownerPayload = { ...base, rol: 'owner', sucursal_id: null, empresa_id: null, exp: Math.floor(Date.now() / 1000) + 3600 };
  for (const alg of ['none', 'None', 'NONE', 'nOnE']) {
    await S.check({ id: `JWT-alg-${alg}`, titulo: `alg:"${alg}" sin firma, rol owner`, method: 'GET', path: RUTA_OWNER, actor: `JWT alg=${alg}`,
      token: `${b64({ alg, typ: 'JWT' })}.${b64(ownerPayload)}.`, esperado: '403', severidad: 'crítica', ok: rechaza });
  }
  await S.check({ id: 'JWT-alg-none-firma-original', titulo: 'alg:none conservando la firma original', method: 'GET', path: RUTA_OWNER, actor: 'JWT alg=none + firma',
    token: `${b64({ alg: 'none', typ: 'JWT' })}.${b64(ownerPayload)}.${sig}`, esperado: '403', severidad: 'crítica', ok: rechaza });
  await S.check({ id: 'JWT-alg-HS512', titulo: 'Firmado con HS512 usando el secreto real (algoritmo fijado a HS256)', method: 'GET', path: RUTA_AUTH,
    actor: 'JWT alg=HS512 válido', token: jwt.sign(base, secret, { algorithm: 'HS512', expiresIn: '1h' }),
    esperado: '403 (solo HS256)', severidad: 'baja', ok: rechaza });
  await S.check({ id: 'JWT-alg-RS256-confusion', titulo: 'Cabecera alg:RS256 con firma HMAC (confusión de algoritmo)', method: 'GET', path: RUTA_OWNER, actor: 'JWT alg=RS256',
    token: `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(ownerPayload)}.${sig}`, esperado: '403', severidad: 'crítica', ok: rechaza });
  await S.check({ id: 'JWT-jwk-embebido', titulo: 'Cabecera con jwk/jku embebido', method: 'GET', path: RUTA_OWNER, actor: 'JWT con jwk',
    token: `${b64({ alg: 'HS256', typ: 'JWT', jku: 'http://evil.example/jwks.json', kid: '../../dev/null' })}.${b64(ownerPayload)}.${sig}`,
    esperado: '403', severidad: 'crítica', ok: rechaza });

  // ── 7. Formas raras de presentar el token ──────────────────────────────────
  await S.check({ id: 'JWT-sin-bearer', titulo: 'Authorization sin prefijo Bearer', method: 'GET', path: RUTA_AUTH, actor: 'token crudo', ...sinBearer(T.resA1),
    esperado: '401', severidad: 'baja', ok: r => r.status === 401 });
  await S.check({ id: 'JWT-token-en-query', titulo: 'Token en la query string (?token=)', method: 'GET', path: `${RUTA_AUTH}?token=${T.resA1}&access_token=${T.resA1}`, actor: 'token en URL',
    esperado: '401 (los tokens no viajan en URLs)', severidad: 'baja', ok: r => r.status === 401 });
  await S.check({ id: 'JWT-cabecera-enorme', titulo: 'Authorization de 20 KB', method: 'GET', path: RUTA_AUTH, actor: 'token gigante', token: 'A'.repeat(20000),
    esperado: '4xx (431/401/403), nunca 5xx', severidad: 'baja', ok: r => r.status >= 400 && r.status < 500 });
  await S.check({ id: 'JWT-rol-desconocido', titulo: 'Token con firma válida pero rol "superadmin"', method: 'GET', path: RUTA_OWNER, actor: 'JWT rol inexistente',
    token: forjar({ ...base, rol: 'superadmin' }, { expiresIn: '1h' }), esperado: '403', severidad: 'media', ok: rechaza });
  await S.check({ id: 'JWT-sin-rol', titulo: 'Token con firma válida pero sin rol', method: 'GET', path: RUTA_AUTH, actor: 'JWT sin rol',
    token: forjar({ id: base.id, email: base.email }, { expiresIn: '1h' }), esperado: '403', severidad: 'media', ok: rechaza });

  // ── 8. Duración y contenido del token ──────────────────────────────────────
  const c = claims(T.owner);
  S.registrar({ id: 'JWT-ttl-acceso', titulo: 'Duración del access token', esperado: '≤ 1 h',
    request: { method: 'POST', path: '/api/auth/login', actor: 'owner' },
    real: { status: 200, body: `exp - iat = ${c.exp - c.iat} s; claims: ${Object.keys(c).join(', ')}` },
    resultado: c.exp - c.iat <= 3600 ? 'OK' : 'FALLA', severidad: 'baja' });
  S.registrar({ id: 'JWT-claims-sensibles', titulo: 'El JWT no lleva password_hash ni datos sensibles', esperado: 'solo id, nombre, email, rol, sucursal_id, empresa_id',
    request: { method: 'POST', path: '/api/auth/login', actor: 'owner' },
    real: { status: 200, body: Object.keys(c).join(', ') },
    resultado: Object.keys(c).some(k => /pass|hash|secret|dpi/i.test(k)) ? 'FALLA' : 'OK', severidad: 'media' });

  // ── 9. Revocación inmediata ────────────────────────────────────────────────
  const cobaya = await L.login(L.EMAIL.cobayaA);
  const antes = await L.call('GET', RUTA_AUTH.replace('residentes/me', 'usuarios/sucursal'), { token: cobaya.token });
  const baja = await L.call('DELETE', `/api/usuarios/${F.usuarios.cobayaA}`, { token: T.adminSucA1 });
  const despues = await L.call('GET', '/api/reservas/mis-reservas', { token: cobaya.token });
  const refr = await L.call('POST', '/api/auth/refresh', { cookie: cobaya.cookie });
  const relogin = await L.login(L.EMAIL.cobayaA);
  S.registrar({ id: 'JWT-revocacion-usuario', titulo: 'Un usuario dado de baja pierde el access token, el refresh y el login al instante',
    esperado: 'antes 200/403 (según rol); baja 200; después 401; refresh 401; login 401',
    request: { method: 'DELETE', path: `/api/usuarios/:id (cobaya)`, actor: 'adminSucA1' },
    real: { status: despues.status, body: `baja=${baja.status}, token tras baja=${despues.status} (${despues.text.slice(0, 60)}), refresh=${refr.status}, login=${relogin.status}` },
    resultado: baja.status === 200 && despues.status === 401 && refr.status === 401 && relogin.status === 401 ? 'OK' : 'FALLA', severidad: 'alta' });
  L.psql(`UPDATE usuarios SET activo = TRUE WHERE id = '${F.usuarios.cobayaA}'`);

  // ── 10. Refresh token: rotación y reutilización ────────────────────────────
  const l1 = await L.login(L.EMAIL.resA1);
  const cookie0 = l1.cookie;
  const r1 = await L.call('POST', '/api/auth/refresh', { cookie: cookie0 });
  const cookie1 = (r1.setCookie.find(x => x.startsWith('refresh_token=')) || '').split(';')[0];
  const reuso = await L.call('POST', '/api/auth/refresh', { cookie: cookie0 });          // el ya rotado
  const nuevoSigueVivo = await L.call('POST', '/api/auth/refresh', { cookie: cookie1 });  // ¿se revocó la familia?
  S.registrar({ id: 'JWT-refresh-rotacion', titulo: 'El refresh token rota y el anterior queda inválido', esperado: 'reuso del anterior → 401',
    request: { method: 'POST', path: '/api/auth/refresh', actor: 'residente A1 (cookie)' },
    real: { status: reuso.status, body: `1er refresh=${r1.status}; reuso del viejo=${reuso.status}` },
    resultado: r1.status === 200 && reuso.status === 401 ? 'OK' : 'FALLA', severidad: 'alta' });
  S.registrar({ id: 'JWT-refresh-deteccion-reuso', titulo: 'Detección de reutilización: al reusar un refresh robado se revoca toda la familia',
    esperado: 'tras el reuso del viejo, el refresh nuevo también deja de valer (401)',
    request: { method: 'POST', path: '/api/auth/refresh', actor: 'residente A1 (cookie nueva tras el reuso)' },
    real: { status: nuevoSigueVivo.status, body: `refresh nuevo tras reuso del viejo=${nuevoSigueVivo.status}` },
    resultado: nuevoSigueVivo.status === 401 ? 'OK' : 'FALLA', severidad: 'baja',
    nota: 'Conocido y aceptado en SECURITY_REVIEW.md (M6 «pendiente»). Un refresh robado y usado ANTES que el legítimo deja al atacante con sesión; el legítimo recibe 401 pero nadie se entera.' });
  const flags = (l1.resp.setCookie[0] || '');
  S.registrar({ id: 'JWT-cookie-flags', titulo: 'Flags de la cookie de refresh en este entorno (desarrollo)', esperado: 'HttpOnly; SameSite=Strict; Path=/; (Secure solo en producción)',
    request: { method: 'POST', path: '/api/auth/login', actor: 'residente A1' },
    real: { status: 200, body: flags.replace(/refresh_token=[^;]+/, 'refresh_token=<oculto>') },
    resultado: /HttpOnly/i.test(flags) && /SameSite=Strict/i.test(flags) ? 'OK' : 'FALLA', severidad: 'media' });
  await S.check({ id: 'JWT-refresh-sin-cookie', titulo: 'Refresh sin cookie', method: 'POST', path: '/api/auth/refresh', actor: 'anónimo', esperado: '401', severidad: 'baja', ok: r => r.status === 401 });
  await S.check({ id: 'JWT-refresh-cookie-basura', titulo: 'Refresh con cookie inventada', method: 'POST', path: '/api/auth/refresh', actor: 'anónimo',
    cookie: 'refresh_token=' + 'a'.repeat(128), esperado: '401', severidad: 'baja', ok: r => r.status === 401 });

  S.save();
  execSync(`${__dirname}/snapshot.sh restore seeded`, { stdio: 'inherit' });
})().catch(e => { console.error(e); process.exit(1); });
