'use strict';
/**
 * Empresa suspendida (y dada de baja): 423 en login, refresh y heartbeat;
 * sesiones y licencias vivas se cortan; las credenciales incorrectas no
 * revelan el estado de la empresa; reactivar restaura el servicio.
 * Trabaja con una empresa propia (D) para no tocar A ni B.
 */
const L = require('./lib');
const crypto = require('crypto');
const { execSync } = require('child_process');

const S = new L.Suite('06-suspension', 'Empresa suspendida: 423 en login, refresh y heartbeat');
const fp = s => crypto.createHash('sha256').update(s).digest('hex');
const es423 = r => r.status === 423 && r.json?.codigo && r.json?.estado === 'suspendida';
const esSusp = r => r.status === 423 && r.json?.estado === 'suspendida';

(async () => {
  await L.reiniciarBackend();
  const T = await L.tokens(true);
  const sfx = Date.now().toString(36);

  // ── Empresa D con todos los roles ──────────────────────────────────────────
  const emp = await L.call('POST', '/api/empresas', { token: T.owner, body: { nombre: `ST Empresa D suspendible ${sfx}` } });
  const D = emp.json.id;
  const suc = await L.call('POST', '/api/sucursales', { token: T.owner, body: { empresa_id: D, nombre: `ST Suc D1 ${sfx}` } });
  if (suc.status !== 201) throw new Error(`crear sucursal: ${suc.status} ${suc.text}`);
  const D1 = suc.json.id;
  const mail = n => `st.d.${sfx}.${n}@sectest.local`;
  L.psql(`
    INSERT INTO usuarios (nombre,email,password_hash,rol,sucursal_id,empresa_id) VALUES
      ('ST D adminemp','${mail('adminemp')}',crypt('${L.PW}',gen_salt('bf',12)),'admin_empresa',NULL,'${D}'),
      ('ST D adminsuc','${mail('adminsuc')}',crypt('${L.PW}',gen_salt('bf',12)),'admin_sucursal','${D1}',NULL),
      ('ST D agente','${mail('agente')}',crypt('${L.PW}',gen_salt('bf',12)),'agente','${D1}',NULL),
      ('ST D residente','${mail('res')}',crypt('${L.PW}',gen_salt('bf',12)),'residente','${D1}',NULL);
    INSERT INTO residentes (usuario_id,sucursal_id,numero_casa) SELECT id,'${D1}','ST-D1-01' FROM usuarios WHERE email='${mail('res')}';`);
  const roles = ['adminemp', 'adminsuc', 'agente', 'res'];

  // Sesiones y licencia ANTES de suspender.
  const antes = {};
  for (const r of roles) antes[r] = await L.login(mail(r));
  const lic = await L.call('POST', '/api/licencias', { token: antes.adminsuc.token, body: { etiqueta: 'ST-lic-D' } });
  const licLibre = await L.call('POST', '/api/licencias', { token: antes.adminsuc.token, body: { etiqueta: 'ST-lic-D-libre' } });
  const FPD = fp(`st-fp-D-${sfx}`);
  const act = await L.call('POST', '/api/licencias/activar', { body: { codigo: lic.json.codigo_activacion, fingerprint: FPD } });
  const licToken = act.json.token_licencia;

  await S.check({ id: 'SUSP-ctrl-login', titulo: 'Control: antes de suspender, el agente de D inicia sesión', method: 'POST', path: '/api/auth/login', actor: 'agente D',
    body: { email: mail('agente'), password: L.PW }, esperado: '200', ok: r => r.status === 200 });
  await S.check({ id: 'SUSP-ctrl-heartbeat', titulo: 'Control: antes de suspender, el heartbeat responde 200', method: 'POST', path: '/api/licencias/heartbeat', actor: 'licencia D',
    licencia: licToken, body: { fingerprint: FPD }, esperado: '200', ok: r => r.status === 200 });
  await S.check({ id: 'SUSP-ctrl-sync', titulo: 'Control: antes de suspender, sync/garita responde 200', method: 'GET', path: '/api/sync/garita', actor: 'agente D + licencia D',
    token: antes.agente.token, licencia: licToken, esperado: '200', ok: r => r.status === 200 });

  // ── Suspender ──────────────────────────────────────────────────────────────
  await S.check({ id: 'SUSP-suspender', titulo: 'El owner suspende la empresa D', method: 'PATCH', path: `/api/empresas/${D}/suspender`, actor: 'owner',
    token: T.owner, body: { motivo: 'ST prueba: impago simulado' }, esperado: '200', ok: r => r.status === 200 });

  for (const r of roles) {
    await S.check({ id: `SUSP-login-${r}`, titulo: `Login de ${r} con la empresa suspendida`, method: 'POST', path: '/api/auth/login', actor: r,
      body: { email: mail(r), password: L.PW }, esperado: '423 + codigo + motivo', severidad: 'alta',
      ok: rr => es423(rr) && /impago/.test(rr.json?.motivo || '') });
  }
  await S.check({ id: 'SUSP-login-password-mala', titulo: 'Contraseña INCORRECTA en una empresa suspendida no revela su estado', method: 'POST', path: '/api/auth/login', actor: 'atacante',
    body: { email: mail('agente'), password: 'contraseña-equivocada1' }, esperado: '401 (no 423)', severidad: 'media', ok: r => r.status === 401 });
  for (const r of roles) {
    await S.check({ id: `SUSP-refresh-${r}`, titulo: `Refresh de ${r} (cookie emitida antes de suspender)`, method: 'POST', path: '/api/auth/refresh', actor: r,
      cookie: antes[r].cookie, esperado: '423 (contrato documentado en suspension.ts / suspenderEmpresa)', severidad: 'baja',
      nota: 'Suspender revoca los refresh tokens (revocarSesionesDeEmpresa), así que el refresh responde 401 y el cliente no puede distinguir «suspendida» de «sesión vencida» hasta que intenta el login (423). El acceso SÍ se corta.',
      ok: es423 });
  }
  await S.check({ id: 'SUSP-heartbeat', titulo: 'Heartbeat de la licencia de una empresa suspendida', method: 'POST', path: '/api/licencias/heartbeat', actor: 'licencia D',
    licencia: licToken, body: { fingerprint: FPD }, esperado: '423 (estado suspendida)', severidad: 'alta', ok: esSusp });
  await S.check({ id: 'SUSP-activar', titulo: 'Activar un código nuevo de una empresa suspendida', method: 'POST', path: '/api/licencias/activar', actor: 'anónimo',
    body: { codigo: licLibre.json.codigo_activacion, fingerprint: fp(`st-fp-D2-${sfx}`) }, esperado: '423', severidad: 'alta', ok: r => r.status === 423 });
  await S.check({ id: 'SUSP-sync', titulo: 'sync/garita con licencia y sesión de una empresa suspendida', method: 'GET', path: '/api/sync/garita', actor: 'agente D + licencia D',
    token: antes.agente.token, licencia: licToken, esperado: '401/403/423', severidad: 'alta', ok: r => [401, 403, 423].includes(r.status) });
  await S.check({ id: 'SUSP-accesos', titulo: 'POST /accesos con licencia de una empresa suspendida', method: 'POST', path: '/api/accesos', actor: 'agente D + licencia D',
    token: antes.agente.token, licencia: licToken, body: { nombre_visitante: 'ST susp', numero_dpi: 'ST-SUSP-1', residente_id: L.psql(`SELECT id FROM residentes WHERE sucursal_id='${D1}'`) },
    esperado: '401/403/423', severidad: 'alta', ok: r => [401, 403, 423].includes(r.status) });
  for (const r of roles) {
    await S.check({ id: `SUSP-token-vivo-${r}`, titulo: `El access token de ${r} emitido antes de suspender deja de valer`, method: 'GET', path: '/api/reservas/mis-reservas', actor: r,
      token: antes[r].token, esperado: '401 (Sesión revocada)', severidad: 'alta', ok: rr => rr.status === 401 });
  }
  await S.check({ id: 'SUSP-owner-libre', titulo: 'El owner no se ve afectado', method: 'GET', path: '/api/empresas', actor: 'owner', token: T.owner, esperado: '200', ok: r => r.status === 200 });
  await S.check({ id: 'SUSP-otra-empresa-libre', titulo: 'Las empresas A y B no se ven afectadas', method: 'POST', path: '/api/auth/login', actor: 'agente A1',
    body: { email: L.EMAIL.agenteA1, password: L.PW }, esperado: '200', ok: r => r.status === 200 });

  // ── Reactivar ──────────────────────────────────────────────────────────────
  await S.check({ id: 'SUSP-reactivar', titulo: 'El owner reactiva la empresa D', method: 'PATCH', path: `/api/empresas/${D}/reactivar`, actor: 'owner', token: T.owner, body: {}, esperado: '200', ok: r => r.status === 200 });
  await S.check({ id: 'SUSP-tras-reactivar-login', titulo: 'Tras reactivar, el login vuelve a funcionar', method: 'POST', path: '/api/auth/login', actor: 'agente D',
    body: { email: mail('agente'), password: L.PW }, esperado: '200', ok: r => r.status === 200 });
  await S.check({ id: 'SUSP-tras-reactivar-heartbeat', titulo: 'Tras reactivar, la misma licencia vuelve a validar', method: 'POST', path: '/api/licencias/heartbeat', actor: 'licencia D',
    licencia: licToken, body: { fingerprint: FPD }, esperado: '200 (la licencia no se revoca)', ok: r => r.status === 200 });

  // La rama 423 de /auth/refresh sí funciona cuando el refresh token sigue vigente (p. ej. suspensión aplicada fuera de la API).
  const vivo = await L.login(mail('agente'));
  L.psql(`UPDATE empresas SET suspendida = TRUE, suspension_motivo = 'ST directo en BD', suspendida_en = NOW() WHERE id = '${D}'`);
  await S.check({ id: 'SUSP-refresh-rama-423', titulo: 'Refresh con token vigente y empresa suspendida directamente en BD', method: 'POST', path: '/api/auth/refresh', actor: 'agente D',
    cookie: vivo.cookie, esperado: '423', ok: es423 });
  L.psql(`UPDATE empresas SET suspendida = FALSE, suspension_motivo = NULL, suspendida_en = NULL WHERE id = '${D}'`);

  // ── Baja (soft delete) ─────────────────────────────────────────────────────
  await S.check({ id: 'BAJA-eliminar', titulo: 'El owner da de baja la empresa D (DELETE)', method: 'DELETE', path: `/api/empresas/${D}`, actor: 'owner', token: T.owner, esperado: '200', ok: r => r.status === 200 });
  await S.check({ id: 'BAJA-login', titulo: 'Login de una empresa dada de baja', method: 'POST', path: '/api/auth/login', actor: 'agente D',
    body: { email: mail('agente'), password: L.PW }, esperado: '401 o 423 (nunca 200)', severidad: 'alta', ok: r => r.status === 423 || r.status === 401 });
  await S.check({ id: 'BAJA-heartbeat', titulo: 'Heartbeat de una licencia de empresa dada de baja', method: 'POST', path: '/api/licencias/heartbeat', actor: 'licencia D',
    licencia: licToken, body: { fingerprint: FPD }, esperado: '403/423 (nunca 200)', severidad: 'alta', ok: r => r.status === 423 || r.status === 403 });

  S.save();
  execSync(`${__dirname}/snapshot.sh restore seeded`, { stdio: 'inherit' });
})().catch(e => { console.error(e); process.exit(1); });
