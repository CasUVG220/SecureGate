'use strict';
/**
 * Rate limiting REAL, con los límites de producción (login 20/IP + 10/cuenta,
 * activar 10, heartbeat 60, refresh 120, ocr 30/min, general 1000 — todos por
 * 15 min salvo ocr). Nada se relaja: el contador vive en memoria y se pone a
 * cero reiniciando el contenedor entre secciones (mismo secreto y BD).
 *
 * Para cada límite: request que lo agota, request que lo rebasa (429),
 * cabeceras informativas y que falsificar X-Forwarded-For no lo evade.
 */
const L = require('./lib');

const F = L.fixtures();
const S = new L.Suite('09-ratelimit', 'Rate limit real: /licencias/activar, /auth/login y demás límites de producción');
const rnd = () => Math.random().toString(16).slice(2, 10);
const IP_FALSA = () => `203.0.113.${1 + Math.floor(Math.random() * 250)}`;

const secuencia = async (n, fn) => { const out = []; for (let i = 0; i < n; i++) out.push(await fn(i)); return out; };
const resumen = a => { const c = {}; for (const s of a) c[s] = (c[s] || 0) + 1; return Object.entries(c).map(([k, v]) => `${k}×${v}`).join(', '); };
const primero = (a, s) => a.indexOf(s) + 1;

(async () => {
  L.autoReset(false);
  const fpOk = 'b'.repeat(64);

  // ── /api/licencias/activar : 10 / 15 min por IP ───────────────────────────
  await L.reiniciarBackend();
  let ultimo;
  const act = await secuencia(13, async i => {
    ultimo = await L.call('POST', '/api/licencias/activar', { body: { codigo: `SG-ZZZZ-ZZZZ-ZZZZ-${(1000 + i)}`, fingerprint: fpOk } });
    return ultimo.status;
  });
  S.registrar({ id: 'RL-activar-limite', titulo: '13 activaciones con códigos inválidos desde una IP', esperado: '404 ×10 y 429 desde el intento 11',
    request: { method: 'POST', path: '/api/licencias/activar', actor: 'anónimo (13 intentos)' }, real: { status: ultimo.status, body: `${resumen(act)}; primer 429 en el intento ${primero(act, 429)}` },
    resultado: primero(act, 429) === 11 && act.slice(0, 10).every(s => s === 404) ? 'OK' : 'FALLA', severidad: 'alta' });
  S.registrar({ id: 'RL-activar-cabeceras', titulo: 'El 429 informa el límite y el tiempo de espera', esperado: 'ratelimit-limit=10 y retry-after / ratelimit-reset',
    request: { method: 'POST', path: '/api/licencias/activar', actor: 'anónimo' }, real: { status: ultimo.status, body: `ratelimit-limit=${ultimo.headers['ratelimit-limit']}; ratelimit-remaining=${ultimo.headers['ratelimit-remaining']}; retry-after=${ultimo.headers['retry-after']}; ratelimit-reset=${ultimo.headers['ratelimit-reset']}` },
    resultado: ultimo.headers['ratelimit-limit'] === '10' && !!(ultimo.headers['retry-after'] || ultimo.headers['ratelimit-reset']) ? 'OK' : 'FALLA', severidad: 'baja' });
  const xff = await secuencia(5, () => L.call('POST', '/api/licencias/activar', { headers: { 'X-Forwarded-For': IP_FALSA() }, body: { codigo: 'SG-AAAA-BBBB-CCCC-DDDD', fingerprint: fpOk } }).then(r => r.status));
  S.registrar({ id: 'RL-activar-xff', titulo: 'Rotar X-Forwarded-For en cada intento no reinicia el contador', esperado: '429 en los 5',
    request: { method: 'POST', path: '/api/licencias/activar', actor: 'anónimo + XFF aleatorio' }, real: { status: xff[0], body: resumen(xff) }, resultado: xff.every(s => s === 429) ? 'OK' : 'FALLA', severidad: 'alta' });
  // ¿Un código VÁLIDO también queda bloqueado (el límite cuenta todo, no solo fallos)?
  const valido = await L.call('POST', '/api/licencias/activar', { body: { codigo: F.licencias['A1-libre'].codigo, fingerprint: F.licencias['A1-libre'].fingerprint } });
  S.registrar({ id: 'RL-activar-valido-bloqueado', titulo: 'Un código válido tampoco pasa cuando se agotó el cupo de la IP', esperado: '429 (informativo: el límite cuenta también los intentos correctos)',
    request: { method: 'POST', path: '/api/licencias/activar', actor: 'anónimo, código válido' }, real: { status: valido.status, body: valido.text.slice(0, 100) }, resultado: 'INFO',
    nota: 'Una garita detrás del mismo NAT que un atacante no puede activarse durante 15 min. Aceptable frente a la fuerza bruta, a costa de disponibilidad.' });

  // ── /api/auth/login ───────────────────────────────────────────────────────
  // a) por cuenta: 10 fallos y el 11.º ya es 429, incluso con la contraseña correcta.
  await L.reiniciarBackend();
  let l;
  const porCuenta = await secuencia(12, async i => { l = await L.call('POST', '/api/auth/login', { body: { email: L.EMAIL.resA1, password: `Mala-${i}-clave1` } }); return l.status; });
  S.registrar({ id: 'RL-login-cuenta', titulo: '12 contraseñas erróneas contra UNA cuenta (desde una IP)', esperado: '401 ×10 y 429 desde el 11 (límite por cuenta)',
    request: { method: 'POST', path: '/api/auth/login', actor: 'anónimo' }, real: { status: l.status, body: `${resumen(porCuenta)}; primer 429 en el intento ${primero(porCuenta, 429)}; mensaje: ${l.text}` },
    resultado: primero(porCuenta, 429) === 11 ? 'OK' : 'FALLA', severidad: 'alta' });
  const correcta = await L.call('POST', '/api/auth/login', { body: { email: L.EMAIL.resA1, password: L.PW } });
  S.registrar({ id: 'RL-login-cuenta-bloquea-titular', titulo: 'Con la cuenta bloqueada, el titular con la contraseña CORRECTA también recibe 429', esperado: 'informativo',
    request: { method: 'POST', path: '/api/auth/login', actor: 'titular legítimo' }, real: { status: correcta.status, body: correcta.text.slice(0, 100) }, resultado: 'INFO',
    nota: correcta.status === 429 ? 'Cualquiera que conozca el correo de una cuenta (incluida la del owner) puede dejarla sin acceso 15 min con 10 peticiones. Trade-off documentado en auth.routes.ts; conviene añadir aviso al titular y no bloquear a quien llega con un dispositivo/IP ya conocido.' : 'El titular no quedó bloqueado.' });
  const mayus = await L.call('POST', '/api/auth/login', { body: { email: L.EMAIL.resA1.toUpperCase(), password: 'Otra-mala-1' } });
  S.registrar({ id: 'RL-login-mayusculas', titulo: 'Cambiar mayúsculas del correo no evade el límite por cuenta', esperado: '429',
    request: { method: 'POST', path: '/api/auth/login', actor: 'anónimo (email en MAYÚSCULAS)' }, real: { status: mayus.status, body: mayus.text.slice(0, 80) }, resultado: mayus.status === 429 ? 'OK' : 'FALLA', severidad: 'alta' });
  const espacios = await L.call('POST', '/api/auth/login', { body: { email: ` ${L.EMAIL.resA1} `, password: 'Otra-mala-2' } });
  S.registrar({ id: 'RL-login-espacios', titulo: 'Espacios alrededor del correo no evaden el límite por cuenta', esperado: '429 (o 4xx por validación)',
    request: { method: 'POST', path: '/api/auth/login', actor: 'anónimo (email con espacios)' }, real: { status: espacios.status, body: espacios.text.slice(0, 80) }, resultado: [429, 422, 400].includes(espacios.status) ? 'OK' : 'FALLA', severidad: 'alta' });

  // b) por IP: 22 cuentas distintas, 20 fallos permitidos.
  await L.reiniciarBackend();
  let l2;
  const porIp = await secuencia(22, async i => { l2 = await L.call('POST', '/api/auth/login', { body: { email: `st.rl.${rnd()}.${i}@sectest.local`, password: 'Mala-clave-1a' } }); return l2.status; });
  S.registrar({ id: 'RL-login-ip', titulo: '22 intentos fallidos contra 22 cuentas distintas (password spraying) desde una IP', esperado: '401 ×20 y 429 desde el 21',
    request: { method: 'POST', path: '/api/auth/login', actor: 'anónimo' }, real: { status: l2.status, body: `${resumen(porIp)}; primer 429 en el intento ${primero(porIp, 429)}; mensaje: ${l2.text}` },
    resultado: primero(porIp, 429) === 21 ? 'OK' : 'FALLA', severidad: 'alta' });
  const xffLogin = await secuencia(3, () => L.call('POST', '/api/auth/login', { headers: { 'X-Forwarded-For': IP_FALSA() }, body: { email: `st.rl.${rnd()}@sectest.local`, password: 'Mala-clave-1a' } }).then(r => r.status));
  S.registrar({ id: 'RL-login-xff', titulo: 'Rotar X-Forwarded-For no evade el límite por IP de login', esperado: '429 ×3',
    request: { method: 'POST', path: '/api/auth/login', actor: 'anónimo + XFF aleatorio' }, real: { status: xffLogin[0], body: resumen(xffLogin) }, resultado: xffLogin.every(s => s === 429) ? 'OK' : 'FALLA', severidad: 'alta' });
  const okDuranteBloqueo = await L.call('POST', '/api/auth/login', { body: { email: L.EMAIL.resB1, password: L.PW } });
  S.registrar({ id: 'RL-login-ip-bloquea-legitimos', titulo: 'Con el cupo de IP agotado, un usuario legítimo de la misma IP con la contraseña correcta también recibe 429', esperado: 'informativo',
    request: { method: 'POST', path: '/api/auth/login', actor: 'residente B1 (misma IP)' }, real: { status: okDuranteBloqueo.status, body: okDuranteBloqueo.text.slice(0, 100) }, resultado: 'INFO',
    nota: 'Varias personas detrás del mismo NAT (una administración) comparten los 20 intentos fallidos de la IP.' });

  // c) los intentos correctos no consumen cupo.
  await L.reiniciarBackend();
  const buenos = await secuencia(25, () => L.call('POST', '/api/auth/login', { body: { email: L.EMAIL.resA2, password: L.PW } }).then(r => r.status));
  S.registrar({ id: 'RL-login-exitosos-no-cuentan', titulo: '25 inicios de sesión correctos seguidos', esperado: '200 ×25 (skipSuccessfulRequests)',
    request: { method: 'POST', path: '/api/auth/login', actor: 'residente A2' }, real: { status: buenos[24], body: resumen(buenos) }, resultado: buenos.every(s => s === 200) ? 'OK' : 'FALLA', severidad: 'media' });

  // ── /api/licencias/heartbeat : 60 / 15 min ────────────────────────────────
  await L.reiniciarBackend();
  let h;
  const hb = await secuencia(62, async () => { h = await L.call('POST', '/api/licencias/heartbeat', { licencia: 'no.es.un.token', body: {} }); return h.status; });
  S.registrar({ id: 'RL-heartbeat', titulo: '62 heartbeats con token basura', esperado: '403 ×60 y 429 desde el 61',
    request: { method: 'POST', path: '/api/licencias/heartbeat', actor: 'anónimo' }, real: { status: h.status, body: `${resumen(hb)}; primer 429 en el intento ${primero(hb, 429)}` },
    resultado: primero(hb, 429) === 61 ? 'OK' : 'FALLA', severidad: 'media' });

  // ── /api/auth/refresh : 120 / 15 min ──────────────────────────────────────
  await L.reiniciarBackend();
  let rf;
  const rfs = await secuencia(122, async () => { rf = await L.call('POST', '/api/auth/refresh', {}); return rf.status; });
  S.registrar({ id: 'RL-refresh', titulo: '122 refresh sin cookie', esperado: '401 ×120 y 429 desde el 121',
    request: { method: 'POST', path: '/api/auth/refresh', actor: 'anónimo' }, real: { status: rf.status, body: `${resumen(rfs)}; primer 429 en el intento ${primero(rfs, 429)}` },
    resultado: primero(rfs, 429) === 121 ? 'OK' : 'FALLA', severidad: 'baja' });

  // ── /api/ocr : 30 / min (proxy que cuesta dinero) ─────────────────────────
  await L.reiniciarBackend();
  const T = await L.tokens(true);
  let oc;
  const ocrs = await secuencia(32, async () => { oc = await L.call('POST', '/api/ocr/dpi', { token: T.agenteA1, body: { imagen: 'x' } }); return oc.status; });
  S.registrar({ id: 'RL-ocr', titulo: '32 llamadas al proxy OCR (Google Vision) con un agente', esperado: '429 desde la 31',
    request: { method: 'POST', path: '/api/ocr/dpi', actor: 'agenteA1' }, real: { status: oc.status, body: `${resumen(ocrs)}; primer 429 en el intento ${primero(ocrs, 429)}` },
    resultado: primero(ocrs, 429) === 31 ? 'OK' : 'FALLA', severidad: 'media' });

  // ── Límite general : 1000 / 15 min por IP ─────────────────────────────────
  await L.reiniciarBackend();
  let g;
  const gen = [];
  for (let i = 0; i < 1003; i++) { g = await L.call('GET', '/api/status'); gen.push(g.status); if (gen[gen.length - 1] === 429 && gen.filter(x => x === 429).length >= 2) break; }
  S.registrar({ id: 'RL-general', titulo: 'Ráfaga de peticiones a /api/status desde una IP', esperado: '200 ×1000 y 429 desde la 1001',
    request: { method: 'GET', path: '/api/status', actor: 'anónimo (~1000 peticiones)' }, real: { status: g.status, body: `${resumen(gen)}; primer 429 en la petición ${primero(gen, 429)}` },
    resultado: primero(gen, 429) === 1001 ? 'OK' : 'FALLA', severidad: 'media' });
  const salud = await L.call('GET', '/health');
  S.registrar({ id: 'RL-general-health-exento', titulo: '/health sigue respondiendo con el cupo agotado (lo consulta Docker)', esperado: '200', request: { method: 'GET', path: '/health', actor: 'anónimo' },
    real: { status: salud.status, body: salud.text.slice(0, 80) }, resultado: salud.status === 200 ? 'OK' : 'FALLA', severidad: 'baja' });
  const legit = await L.call('GET', '/api/residentes/me', { token: T.resA1 });
  S.registrar({ id: 'RL-general-tokens-no-evaden', titulo: 'El límite general es por IP: un token válido no lo evita', esperado: '429',
    request: { method: 'GET', path: '/api/residentes/me', actor: 'resA1 con token válido' }, real: { status: legit.status, body: legit.text.slice(0, 80) }, resultado: legit.status === 429 ? 'OK' : 'FALLA', severidad: 'baja' });

  // Restaurar: contador a cero, mismos límites de producción.
  await L.reiniciarBackend();
  L.autoReset(true);
  S.save();
})().catch(e => { console.error(e); process.exit(1); });
