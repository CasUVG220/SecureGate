'use strict';
/**
 * Headers de seguridad, CORS, cookies y mensajes de error.
 *
 *  - :3000 → stack de docker-compose.yml (NODE_ENV=development).
 *  - :3100 → la imagen `--target prod` con NODE_ENV=production y allowlist CORS
 *            (./prodmode.sh up). Es lo que se despliega de verdad.
 */
const http = require('http');
const { execSync } = require('child_process');
const L = require('./lib');

const S = new L.Suite('08-headers', 'Headers de seguridad, CORS, cookies y errores que filtren internos');
const PROD = L.PROD_BASE;
const ORIGEN_OK = 'https://app.sectest.example';

const trace = (base, path) => new Promise(resolve => {
  const u = new URL(base);
  const req = http.request({ host: u.hostname, port: u.port, path, method: 'TRACE' }, res => {
    let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve({ status: res.statusCode, text: d, headers: res.headers }));
  });
  req.on('error', e => resolve({ status: 0, text: String(e) }));
  req.end();
});

const FUGA = /node_modules|\/app\/src|\bat\s+\S+\s+\(|\.ts:\d+|\.js:\d+|stack|postgres|pg_|SQLSTATE|express/i;

(async () => {
  await L.reiniciarBackend();
  const T = await L.tokens(true);

  // Un owner real en el backend de modo producción (base propia).
  execSync(`docker exec -e OWNER_EMAIL=st.prod.owner@sectest.local -e OWNER_PASSWORD='${L.PW}' -e OWNER_NOMBRE='ST Prod Owner' securegate-backend-prodmode node dist/scripts/crear-owner.js`, { stdio: 'ignore' });

  // ── A. Headers de seguridad ───────────────────────────────────────────────
  const REQ = [
    ['content-security-policy', v => /default-src 'none'/.test(v || '') && /frame-ancestors 'none'/.test(v || ''), 'CSP restrictiva (default-src none, frame-ancestors none)', 'media'],
    ['x-content-type-options', v => /nosniff/i.test(v || ''), 'nosniff', 'media'],
    ['strict-transport-security', v => /max-age=(\d+)/.test(v || '') && +RegExp.$1 >= 15552000, 'HSTS ≥ 180 días', 'media'],
    ['x-frame-options', v => /deny|sameorigin/i.test(v || ''), 'DENY o SAMEORIGIN', 'baja'],
    ['referrer-policy', v => !!v, 'presente', 'baja'],
    ['cross-origin-resource-policy', v => !!v, 'presente', 'baja'],
    ['cross-origin-opener-policy', v => !!v, 'presente', 'baja'],
  ];
  for (const [base, nombre] of [[L.BASE, 'compose (dev)'], [PROD, 'prod-mode']]) {
    const r = await L.call('GET', '/api/status', { base });
    for (const [h, fn, esperado, sev] of REQ) {
      S.registrar({ id: `HDR-${nombre.split(' ')[0]}-${h}`, titulo: `Header ${h} en /api/status (${nombre})`, esperado,
        request: { method: 'GET', path: '/api/status', actor: `anónimo @ ${base}` }, real: { status: r.status, body: `${h}: ${r.headers[h] ?? '(ausente)'}` },
        resultado: fn(r.headers[h]) ? 'OK' : 'FALLA', severidad: sev });
    }
    S.registrar({ id: `HDR-${nombre.split(' ')[0]}-sin-x-powered-by`, titulo: `No se anuncia el framework (X-Powered-By / Server) (${nombre})`, esperado: 'ausentes',
      request: { method: 'GET', path: '/api/status', actor: 'anónimo' }, real: { status: r.status, body: `x-powered-by: ${r.headers['x-powered-by'] ?? '(ausente)'}; server: ${r.headers['server'] ?? '(ausente)'}` },
      resultado: !r.headers['x-powered-by'] && !r.headers['server'] ? 'OK' : 'FALLA', severidad: 'baja' });
  }
  // Cache-Control en respuestas con credenciales / datos personales.
  const lg = await L.call('POST', '/api/auth/login', { body: { email: L.EMAIL.resA1, password: L.PW } });
  const dat = await L.call('GET', '/api/residentes/me', { token: T.resA1 });
  for (const [r, n, ruta] of [[lg, 'login (devuelve el JWT)', '/api/auth/login'], [dat, 'GET /residentes/me (datos personales)', '/api/residentes/me']]) {
    S.registrar({ id: `HDR-cache-control-${n.split(' ')[0].replace('/', '')}`, titulo: `Cache-Control: no-store en ${n}`, esperado: 'no-store (que ningún proxy/navegador conserve tokens ni datos personales)',
      request: { method: ruta === '/api/auth/login' ? 'POST' : 'GET', path: ruta, actor: 'residente A1' }, real: { status: r.status, body: `cache-control: ${r.headers['cache-control'] ?? '(ausente)'}; etag: ${r.headers['etag'] ?? '(ausente)'}` },
      resultado: /no-store/i.test(r.headers['cache-control'] || '') ? 'OK' : 'FALLA', severidad: 'baja',
      nota: 'Express agrega ETag y no envía Cache-Control: un proxy intermedio o el navegador pueden conservar la respuesta.' });
  }

  // ── B. CORS ───────────────────────────────────────────────────────────────
  const preflight = (base, origin) => L.call('OPTIONS', '/api/auth/login', { base, headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
  const rd = await preflight(L.BASE, 'https://evil.example');
  S.registrar({ id: 'CORS-dev-refleja-cualquier-origen', titulo: 'Compose de desarrollo: origen ajeno reflejado con credenciales', esperado: 'informativo (solo desarrollo; producción exige allowlist)',
    request: { method: 'OPTIONS', path: '/api/auth/login', actor: 'Origin: https://evil.example @ :3000' },
    real: { status: rd.status, body: `acao: ${rd.headers['access-control-allow-origin'] ?? '(ausente)'}; acac: ${rd.headers['access-control-allow-credentials'] ?? '(ausente)'}` },
    resultado: 'INFO', nota: 'Documentado en index.ts: en desarrollo se refleja el origen. Se verifica abajo que en producción NO ocurre.' });
  for (const [origen, permitido, n] of [
    ['https://evil.example', false, 'ajeno'], [`${ORIGEN_OK}.evil.com`, false, 'sufijo'], ['https://evil-app.sectest.example', false, 'subdominio hermano'],
    ['http://app.sectest.example', false, 'esquema http'], ['null', false, 'null (iframe sandbox / file://)'], [ORIGEN_OK.toUpperCase(), false, 'mayúsculas'], [ORIGEN_OK, true, 'permitido']]) {
    const r = await preflight(PROD, origen);
    const acao = r.headers['access-control-allow-origin'];
    S.registrar({ id: `CORS-prod-${n.split(' ')[0]}`, titulo: `Preflight en producción con Origin ${origen} (${n})`, esperado: permitido ? 'ACAO = ese origen + credentials' : 'sin ACAO',
      request: { method: 'OPTIONS', path: '/api/auth/login', actor: `Origin: ${origen} @ :3100` }, real: { status: r.status, body: `acao: ${acao ?? '(ausente)'}; acac: ${r.headers['access-control-allow-credentials'] ?? '(ausente)'}` },
      resultado: permitido ? (acao === origen && r.headers['access-control-allow-credentials'] === 'true' ? 'OK' : 'FALLA') : (!acao ? 'OK' : 'FALLA'), severidad: 'alta' });
  }
  const conCreds = await L.call('POST', '/api/auth/login', { base: PROD, headers: { Origin: 'https://evil.example' }, body: { email: 'st.prod.owner@sectest.local', password: L.PW } });
  S.registrar({ id: 'CORS-prod-login-origen-ajeno', titulo: 'POST real con Origin ajeno: el navegador no leería la respuesta (sin ACAO)', esperado: 'sin ACAO en la respuesta',
    request: { method: 'POST', path: '/api/auth/login', actor: 'Origin: https://evil.example @ :3100' }, real: { status: conCreds.status, body: `acao: ${conCreds.headers['access-control-allow-origin'] ?? '(ausente)'}` },
    resultado: !conCreds.headers['access-control-allow-origin'] ? 'OK' : 'FALLA', severidad: 'alta' });

  // ── C. Cookie de refresh en producción ────────────────────────────────────
  const cookieProd = (conCreds.setCookie || []).find(c => c.startsWith('refresh_token=')) || '';
  S.registrar({ id: 'COOKIE-prod-flags', titulo: 'Cookie de refresh en producción: HttpOnly; Secure; SameSite=Strict', esperado: 'los tres flags',
    request: { method: 'POST', path: '/api/auth/login', actor: 'owner @ :3100' }, real: { status: conCreds.status, body: cookieProd.replace(/refresh_token=[^;]+/, 'refresh_token=<oculto>') },
    resultado: /HttpOnly/i.test(cookieProd) && /Secure/i.test(cookieProd) && /SameSite=Strict/i.test(cookieProd) ? 'OK' : 'FALLA', severidad: 'media' });
  S.registrar({ id: 'COOKIE-prod-path', titulo: 'La cookie de refresh no restringe su Path', esperado: 'informativo',
    request: { method: 'POST', path: '/api/auth/login', actor: 'owner @ :3100' }, real: { status: conCreds.status, body: `Path=${/Path=([^;]+)/i.exec(cookieProd)?.[1] ?? '(sin path)'}` },
    resultado: 'INFO', nota: 'Path=/ hace que el refresh token viaje en TODA petición al dominio (incl. /api/*). Restringir a Path=/api/auth reduce la exposición; SameSite=Strict ya mitiga CSRF.' });

  // Cuentas demo en modo producción (C1 del informe anterior): se siembran y se reinicia.
  L.psql(`SELECT 1`);
  execSync(`docker exec securegate-db psql -U sguser -d securegate_prodtest -qc "INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Demo','admin@securegate.com',crypt('admin123',gen_salt('bf',8)),'owner') ON CONFLICT (email) DO UPDATE SET activo=TRUE, password_hash=crypt('admin123',gen_salt('bf',8))"`);
  execSync('docker restart securegate-backend-prodmode', { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${PROD}/health`)).ok) break; } catch { /* arrancando */ } await L.sleep(1000); }
  await L.sleep(1500);
  await S.check({ id: 'PROD-cuentas-demo-desactivadas', titulo: 'En producción, admin@securegate.com / admin123 no inicia sesión (se desactiva al arrancar)', method: 'POST', path: '/api/auth/login', base: PROD,
    actor: 'anónimo @ :3100', body: { email: 'admin@securegate.com', password: 'admin123' }, esperado: '401', severidad: 'crítica', ok: r => r.status === 401 });

  // ── D. Errores que no deben filtrar internos ──────────────────────────────
  const ambos = [[L.BASE, 'dev'], [PROD, 'prod']];
  for (const [base, n] of ambos) {
    const tk = n === 'dev' ? T.resA1 : (await L.login('st.prod.owner@sectest.local', L.PW, { base })).token;
    const sinFuga = r => r.status < 500 || !FUGA.test(r.text);
    await S.check({ id: `ERR-${n}-json-malformado`, titulo: `JSON malformado (${n})`, method: 'POST', path: '/api/auth/login', base, actor: 'anónimo', rawBody: '{"email": "a@b.c", "password": ', headers: { 'Content-Type': 'application/json' },
      esperado: '400 JSON sin stack', severidad: 'media', ok: r => r.status === 400 && !FUGA.test(r.text) && r.headers['content-type']?.includes('json') });
    await S.check({ id: `ERR-${n}-body-grande`, titulo: `Body de 150 KB (límite 100 KB) (${n})`, method: 'POST', path: '/api/auth/login', base, actor: 'anónimo', rawBody: JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(150000) }), headers: { 'Content-Type': 'application/json' },
      esperado: '413 sin stack', severidad: 'media', ok: r => r.status === 413 && !FUGA.test(r.text) });
    await S.check({ id: `ERR-${n}-json-anidado`, titulo: `JSON con 40 000 niveles de anidamiento (${n})`, method: 'POST', path: '/api/auth/login', base, actor: 'anónimo', rawBody: '['.repeat(40000) + ']'.repeat(40000), headers: { 'Content-Type': 'application/json' },
      esperado: '4xx sin stack', severidad: 'media', ok: r => r.status >= 400 && r.status < 500 && !FUGA.test(r.text) });
    await S.check({ id: `ERR-${n}-ruta-inexistente`, titulo: `Ruta inexistente (${n})`, method: 'GET', path: '/api/no-existe', base, actor: 'anónimo', esperado: '404 sin nombrar el framework', severidad: 'baja',
      ok: r => r.status === 404 && !/express|cannot get/i.test(r.text) });
    await S.check({ id: `ERR-${n}-uuid-invalido`, titulo: `UUID inválido en la ruta (${n})`, method: 'GET', path: '/api/residentes/no-es-uuid', base, actor: n === 'dev' ? 'resA1' : 'owner', token: tk,
      esperado: '4xx (o 500 genérico sin internos)', severidad: 'media', ok: sinFuga });
    await S.check({ id: `ERR-${n}-hpp-array`, titulo: `HTTP parameter pollution ?dpi=a&dpi=b (${n})`, method: 'GET', path: '/api/visitantes?dpi=abc&dpi=def', base, actor: n === 'dev' ? 'agenteA1' : 'owner', token: n === 'dev' ? T.agenteA1 : tk,
      esperado: '4xx, nunca 5xx', severidad: 'baja', ok: r => r.status < 500 && !FUGA.test(r.text) });
    await S.check({ id: `ERR-${n}-hpp-objeto`, titulo: `Parámetro anidado ?dpi[x]=1 (${n})`, method: 'GET', path: '/api/visitantes?dpi[x]=1&dpi[y]=2', base, actor: n === 'dev' ? 'agenteA1' : 'owner', token: n === 'dev' ? T.agenteA1 : tk,
      esperado: '4xx, nunca 5xx', severidad: 'baja', ok: r => r.status < 500 && !FUGA.test(r.text) });
    await S.check({ id: `ERR-${n}-tipo-body`, titulo: `Body con tipos inesperados: email como array, password como objeto (${n})`, method: 'POST', path: '/api/auth/login', base, actor: 'anónimo', body: { email: ['a@b.c'], password: { $ne: 1 } },
      esperado: '4xx, nunca 5xx', severidad: 'media', ok: r => r.status >= 400 && r.status < 500 && !FUGA.test(r.text) });
    await S.check({ id: `ERR-${n}-content-type`, titulo: `Content-Type incorrecto (text/plain) (${n})`, method: 'POST', path: '/api/auth/login', base, actor: 'anónimo', rawBody: 'email=a&password=b', headers: { 'Content-Type': 'text/plain' },
      esperado: '4xx, nunca 5xx', severidad: 'baja', ok: r => r.status >= 400 && r.status < 500 && !FUGA.test(r.text) });
    await S.check({ id: `ERR-${n}-url-larga`, titulo: `URL de 20 KB (${n})`, method: 'GET', path: `/api/x?${'a'.repeat(20000)}=1`, base, actor: 'anónimo', esperado: '4xx (414/431/404), nunca 5xx', severidad: 'baja',
      ok: r => r.status >= 400 && r.status < 500 || r.status === 0 });
    for (const p of ['/.env', '/package.json', '/src/index.ts', '/node_modules/express/package.json', '/api/../.env', '/database/init.sql', '/.git/config']) {
      await S.check({ id: `ERR-${n}-archivo-${p.replace(/\W+/g, '_')}`, titulo: `Archivo sensible ${p} (${n})`, method: 'GET', path: p, base, actor: 'anónimo', esperado: '404 (no se sirven archivos)', severidad: 'crítica',
        ok: r => r.status === 404 || r.status === 400 });
    }
    const tr = await trace(base, '/api/status');
    S.registrar({ id: `ERR-${n}-trace`, titulo: `Método TRACE (${n})`, esperado: 'no 200 (no eco de la petición)', request: { method: 'TRACE', path: '/api/status', actor: 'anónimo' },
      real: { status: tr.status, body: tr.text.slice(0, 100) }, resultado: tr.status !== 200 ? 'OK' : 'FALLA', severidad: 'baja' });
  }
  const h = await L.call('GET', '/health');
  S.registrar({ id: 'INFO-health-version', titulo: '/health revela nombre del servicio y versión', esperado: 'informativo',
    request: { method: 'GET', path: '/health', actor: 'anónimo' }, real: { status: h.status, body: h.text }, resultado: 'INFO', nota: 'Público a propósito (health check de Docker). La versión fija "1.0.0" no ayuda a un atacante.' });

  // ── E. Enumeración de usuarios por tiempo de respuesta ────────────────────
  await L.reiniciarBackend();
  const medir = async (emails) => { const t = []; for (const e of emails) { const r = await L.call('POST', '/api/auth/login', { body: { email: e, password: 'Contraseña-mala1' } }); t.push(r.ms); } return t; };
  const prom = a => a.reduce((x, y) => x + y, 0) / a.length;
  const existe = await medir(Array(8).fill(L.EMAIL.resA1));
  const noExiste = await medir(Array.from({ length: 8 }, (_, i) => `st.no.existe.${i}@sectest.local`));
  S.registrar({ id: 'AUTH-timing-enumeracion', titulo: 'Login: tiempo de respuesta con correo existente vs inexistente (contraseña incorrecta en ambos)', esperado: 'diferencia < 20 % (mismo trabajo de bcrypt en ambos casos)',
    request: { method: 'POST', path: '/api/auth/login', actor: 'anónimo (8 intentos por grupo)' },
    real: { status: 401, body: `existente: ${prom(existe).toFixed(0)} ms (min ${Math.min(...existe).toFixed(0)}); inexistente: ${prom(noExiste).toFixed(0)} ms (max ${Math.max(...noExiste).toFixed(0)})` },
    resultado: Math.abs(prom(existe) - prom(noExiste)) / Math.max(prom(existe), prom(noExiste)) < 0.2 ? 'OK' : 'FALLA', severidad: 'media',
    nota: 'Conocido en SECURITY_REVIEW.md (M4 «parcial»): con correo inexistente la consulta no ejecuta crypt(). Permite enumerar cuentas válidas midiendo la latencia, aunque el mensaje sea idéntico.' });
  const mens = await Promise.all([L.call('POST', '/api/auth/login', { body: { email: L.EMAIL.resA1, password: 'Contraseña-mala2' } }), L.call('POST', '/api/auth/login', { body: { email: 'st.no.existe.x@sectest.local', password: 'Contraseña-mala2' } })]);
  S.registrar({ id: 'AUTH-mensaje-identico', titulo: 'Login: mismo mensaje y código con correo existente e inexistente', esperado: 'idénticos',
    request: { method: 'POST', path: '/api/auth/login', actor: 'anónimo' }, real: { status: mens[0].status, body: `${mens[0].text} | ${mens[1].text}` },
    resultado: mens[0].status === mens[1].status && mens[0].text === mens[1].text ? 'OK' : 'FALLA', severidad: 'media' });

  S.save();
})().catch(e => { console.error(e); process.exit(1); });
