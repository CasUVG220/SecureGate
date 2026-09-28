'use strict';
/**
 * Utilidades comunes de las pruebas de seguridad (Sprint 8).
 *
 * - SOLO apunta al stack local: aborta si SG_BASE no es localhost / 127.0.0.1 /
 *   host.docker.internal. Nunca contra la VM de GCP ni Cloud SQL.
 * - `Suite` ejecuta cada comprobación, guarda request / esperado / real y el
 *   veredicto en results/<id>.json (de ahí sale RESULTADOS.md).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = process.env.SG_BASE || 'http://localhost:3000';
const HOSTS_LOCALES = ['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal'];
if (!HOSTS_LOCALES.includes(new URL(BASE).hostname)) {
  console.error(`ABORTO: SG_BASE=${BASE} no es un host local. Estas pruebas solo corren contra el stack de docker-compose.`);
  process.exit(1);
}

const PROD_BASE = process.env.SG_PROD_BASE || 'http://localhost:3100';
if (!HOSTS_LOCALES.includes(new URL(PROD_BASE).hostname)) { console.error('ABORTO: SG_PROD_BASE no es local.'); process.exit(1); }
const RESULTS = path.join(__dirname, 'results');
fs.mkdirSync(RESULTS, { recursive: true });

const PW = 'Sec#Test2026a';
const DOM = 'sectest.local';
const EMAIL = {
  owner:      `st.owner@${DOM}`,
  adminEmpA:  `st.adminemp.a@${DOM}`,
  adminSucA1: `st.adminsuc.a1@${DOM}`,
  agenteA1:   `st.agente.a1@${DOM}`,
  resA1:      `st.res.a1@${DOM}`,
  adminSucA2: `st.adminsuc.a2@${DOM}`,
  resA2:      `st.res.a2@${DOM}`,
  adminEmpB:  `st.adminemp.b@${DOM}`,
  adminSucB1: `st.adminsuc.b1@${DOM}`,
  agenteB1:   `st.agente.b1@${DOM}`,
  resB1:      `st.res.b1@${DOM}`,
  cobayaA:    `st.cobaya.a@${DOM}`,
};

const truncar = (s, n = 260) => {
  const t = typeof s === 'string' ? s : JSON.stringify(s);
  if (t === undefined) return '';
  return t.length > n ? `${t.slice(0, n)}…(+${t.length - n})` : t;
};

/**
 * El limitador general de producción (1000 req / 15 min por IP) se queda en su
 * valor real. Como el contador vive en memoria, las suites largas reinician el
 * contenedor del backend (mismo JWT_SECRET, mismos límites, misma BD) cada
 * ~850 peticiones en vez de relajar la configuración. Las suites de rate limit
 * desactivan esto con L.autoReset(false).
 */
let _usadas = 0;
let _auto = true;
const autoReset = v => { _auto = v; };
async function reiniciarBackend() {
  execSync('docker restart securegate-backend', { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) break; } catch { /* aún arrancando */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  await new Promise(r => setTimeout(r, 1500)); // migraciones del arranque
  _usadas = 0;
}

/** Llamada HTTP cruda. Nunca lanza por status; sí por error de red. */
async function call(method, urlPath, opts = {}) {
  if (_auto && _usadas >= 850) await reiniciarBackend();
  _usadas++;
  const { token, headers = {}, body, rawBody, cookie, licencia, timeout = 20000, base = BASE } = opts;
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (licencia) h['X-Licencia-Token'] = licencia;
  if (cookie) h.Cookie = cookie;
  let payload;
  if (rawBody !== undefined) payload = rawBody;
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = h['Content-Type'] || 'application/json'; }
  const t0 = process.hrtime.bigint();
  const res = await fetch(`${base}${urlPath}`, {
    method, headers: h, body: payload, redirect: 'manual', signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  let json; try { json = JSON.parse(text); } catch { json = undefined; }
  return {
    status: res.status, text, json, ms,
    headers: Object.fromEntries(res.headers.entries()),
    setCookie: typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [],
  };
}

async function login(email, password = PW, extra = {}) {
  const r = await call('POST', '/api/auth/login', { body: { email, password }, ...extra });
  const cookie = (r.setCookie.find(c => c.startsWith('refresh_token=')) || '').split(';')[0] || null;
  return { status: r.status, token: r.json?.token, usuario: r.json?.usuario, cookie, resp: r };
}

let _tokens;
async function tokens(force = false) {
  if (_tokens && !force) return _tokens;
  const out = {};
  for (const [k, email] of Object.entries(EMAIL)) {
    const r = await login(email);
    if (!r.token) throw new Error(`login de ${k} (${email}) falló: ${r.status} ${r.resp.text}. ¿Corriste seed.js?`);
    out[k] = r.token;
  }
  _tokens = out;
  return out;
}

const FIXTURES_FILE = path.join(RESULTS, 'fixtures.json');
const fixtures = () => JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf8'));

/** JWT_SECRET del contenedor local (nunca se escribe a disco ni al reporte). */
let _secret;
const jwtSecret = () => {
  if (!_secret) _secret = execSync('docker exec securegate-backend printenv JWT_SECRET').toString().trim();
  return _secret;
};
const jwt = () => require('../node_modules/jsonwebtoken');

/** psql dentro del contenedor local de Postgres. */
const psql = sql =>
  execSync('docker exec -i securegate-db psql -U sguser -d securegate -At -F "|"', { input: sql }).toString().trim();

const sleep = ms => new Promise(r => setTimeout(r, ms));

class Suite {
  constructor(id, titulo) { this.id = id; this.titulo = titulo; this.items = []; this.fecha = new Date().toISOString(); }

  /**
   * @param {object} c
   * @param {string} c.id        identificador estable (p. ej. IDOR-residentes-GET)
   * @param {string} c.titulo
   * @param {string} c.method
   * @param {string} c.path
   * @param {string} c.actor     quién llama (texto para el reporte)
   * @param {string} [c.esperado] texto legible de la respuesta esperada
   * @param {(r:object)=>boolean} c.ok  true = el sistema se comportó como debe
   * @param {string} [c.severidad] si falla: crítica|alta|media|baja
   * @param {string} [c.nota]
   */
  async check(c) {
    const { method, path: p, token, licencia, cookie, headers, body, rawBody, base } = c;
    let r;
    try { r = await call(method, p, { token, licencia, cookie, headers, body, rawBody, base }); }
    catch (e) { r = { status: 0, text: `ERROR DE RED: ${e.message}`, json: undefined, headers: {}, ms: 0 }; }
    const bien = !!c.ok(r);
    const it = {
      id: c.id, titulo: c.titulo,
      request: { method, path: p, actor: c.actor, body: body !== undefined ? truncar(body, 200) : (rawBody !== undefined ? truncar(rawBody, 200) : undefined) },
      esperado: c.esperado,
      real: { status: r.status, body: truncar(r.text), ms: Math.round(r.ms) },
      resultado: bien ? 'OK' : 'FALLA',
      severidad: bien ? undefined : c.severidad,
      nota: c.nota,
    };
    this.items.push(it);
    console.log(`${bien ? '  ok   ' : '  FALLA'}  ${c.id.padEnd(46)} ${method.padEnd(6)} ${p.slice(0, 60).padEnd(60)} → ${r.status}${bien ? '' : `   (esperado ${c.esperado})`}`);
    return { ...r, bien };
  }

  /** Comprobación que no es una sola petición (medición, conteo, observación). */
  registrar(it) {
    this.items.push(it);
    console.log(`${it.resultado === 'OK' ? '  ok   ' : it.resultado === 'INFO' ? '  info ' : '  FALLA'}  ${it.id.padEnd(46)} ${it.titulo}`);
  }

  save() {
    const f = path.join(RESULTS, `${this.id}.json`);
    fs.writeFileSync(f, JSON.stringify({ id: this.id, titulo: this.titulo, fecha: this.fecha, base: BASE, items: this.items }, null, 2));
    const fallas = this.items.filter(i => i.resultado === 'FALLA').length;
    console.log(`\n${this.id}: ${this.items.length} comprobaciones, ${fallas} fallas → ${path.relative(process.cwd(), f)}`);
    return fallas;
  }
}

module.exports = {
  BASE, PROD_BASE, RESULTS, PW, EMAIL, call, autoReset, reiniciarBackend, login, tokens, fixtures, FIXTURES_FILE, jwtSecret, jwt, psql, sleep, Suite, truncar,
};
