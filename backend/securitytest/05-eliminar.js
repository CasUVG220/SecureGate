'use strict';
/**
 * POST /api/empresas/:id/eliminar-definitivo — contraseña incorrecta repetida y
 * bitácora. Se ataca una empresa DESECHABLE creada aquí (nunca A ni B).
 *
 *  - X intentos con contraseña mala: 403 hasta el límite (5 / 15 min por IP) y
 *    luego 429; la empresa sigue existiendo.
 *  - audit_logs: cada intento que llega al controlador deja fila con
 *    status_code 403, usuario, IP y registro_id; la contraseña no se guarda.
 *  - ¿Qué pasa con los intentos bloqueados por el limitador (429)?
 *  - ¿El límite es por IP o por usuario? (segundo owner desde la misma IP).
 *  - Camino feliz con la contraseña correcta (empresa desechable 2).
 */
const L = require('./lib');
const { execSync } = require('child_process');

const S = new L.Suite('05-eliminar', 'eliminar-definitivo: contraseña incorrecta repetida y audit_logs');

const filas = id => L.psql(
  `SELECT coalesce(status_code::text,'NULL')||'|'||coalesce(usuario_id::text,'NULL')||'|'||coalesce(ip_address,'NULL')||'|'||coalesce(registro_id::text,'NULL')||'|'||coalesce(datos_nuevos::text,'NULL')
     FROM audit_logs WHERE accion='EMPRESA_ELIMINADA_DEFINITIVO' AND registro_id='${id}' ORDER BY created_at`)
  .split('\n').filter(Boolean);

(async () => {
  await L.reiniciarBackend();
  L.autoReset(false);
  const T = await L.tokens(true);
  const F = L.fixtures();

  const crear = async nombre => {
    const r = await L.call('POST', '/api/empresas', { token: T.owner, body: { nombre } });
    if (r.status !== 201) throw new Error(`no se pudo crear la empresa desechable: ${r.status} ${r.text}`);
    return r.json.id;
  };
  const C = await crear(`ST Empresa Desechable ${Date.now().toString(36)}`);

  for (let i = 1; i <= 7; i++) {
    await S.check({ id: `ELIM-mala-${i}`, titulo: `Intento ${i} con contraseña incorrecta`, method: 'POST', path: `/api/empresas/${C}/eliminar-definitivo`,
      actor: 'owner (contraseña mala)', token: T.owner, body: { password: `incorrecta-${i}` },
      esperado: i <= 5 ? '403 Contraseña incorrecta' : '429 (límite 5 / 15 min)', severidad: 'alta',
      ok: rr => (i <= 5 ? rr.status === 403 : rr.status === 429) });
  }
  const sigue = L.psql(`SELECT count(*) FROM empresas WHERE id='${C}' AND activo`);
  S.registrar({ id: 'ELIM-empresa-intacta', titulo: 'Tras 7 intentos fallidos la empresa sigue existiendo y activa', esperado: '1',
    request: { method: 'SQL', path: `SELECT count(*) FROM empresas WHERE id='${C}'`, actor: 'psql' },
    real: { status: 0, body: sigue }, resultado: sigue === '1' ? 'OK' : 'FALLA', severidad: 'crítica' });

  // ── audit_logs ─────────────────────────────────────────────────────────────
  const f = filas(C);
  const con403 = f.filter(x => x.startsWith('403|')).length;
  const con429 = f.filter(x => x.startsWith('429|')).length;
  const trazaOk = f.length > 0 && f.every(x => { const [, u, ip, reg] = x.split('|'); return u === F.usuarios.owner && ip !== 'NULL' && reg === C; });
  S.registrar({ id: 'ELIM-audit-intentos-fallidos', titulo: 'Cada intento fallido que llega al controlador deja fila en audit_logs (usuario, IP, empresa, status 403)',
    esperado: '5 filas con status_code 403, usuario = owner, ip_address y registro_id = empresa',
    request: { method: 'SQL', path: `audit_logs WHERE accion='EMPRESA_ELIMINADA_DEFINITIVO' AND registro_id=<C>`, actor: 'psql' },
    real: { status: 0, body: `filas=${f.length} (403: ${con403}, 429: ${con429}); ejemplo: ${f[0]}` },
    resultado: con403 === 5 && trazaOk ? 'OK' : 'FALLA', severidad: 'media' });
  S.registrar({ id: 'ELIM-audit-bloqueados-por-limitador', titulo: 'Los intentos bloqueados por el limitador (429) también quedan en la bitácora',
    esperado: 'los 2 intentos con 429 aparecen en audit_logs',
    request: { method: 'SQL', path: 'audit_logs (status_code = 429)', actor: 'psql' },
    real: { status: 0, body: `filas 429 = ${con429} de 2 intentos bloqueados. El limitador se ejecuta ANTES que auditLog, así que el atacante que insiste tras el bloqueo no deja rastro.` },
    resultado: con429 === 2 ? 'OK' : 'FALLA', severidad: 'baja',
    nota: 'Hueco de auditoría menor: solo los primeros 5 intentos quedan registrados por ventana de 15 min.' });
  S.registrar({ id: 'ELIM-audit-sin-password', titulo: 'La contraseña intentada no se guarda en audit_logs', esperado: 'ninguna fila contiene "incorrecta-"',
    request: { method: 'SQL', path: `SELECT ... FROM audit_logs WHERE datos_nuevos::text LIKE '%incorrecta-%'`, actor: 'psql' },
    real: { status: 0, body: L.psql(`SELECT count(*) FROM audit_logs WHERE datos_nuevos::text LIKE '%incorrecta-%' OR datos_anteriores::text LIKE '%incorrecta-%'`) },
    resultado: L.psql(`SELECT count(*) FROM audit_logs WHERE datos_nuevos::text LIKE '%incorrecta-%' OR datos_anteriores::text LIKE '%incorrecta-%'`) === '0' ? 'OK' : 'FALLA', severidad: 'alta' });

  // ── ¿Por IP o por usuario? ────────────────────────────────────────────────
  const owner2 = await L.login('admin@securegate.com', 'admin123');
  if (owner2.token) {
    const r2 = await L.call('POST', `/api/empresas/${C}/eliminar-definitivo`, { token: owner2.token, body: { password: 'otra-mala' } });
    S.registrar({ id: 'ELIM-limite-por-ip', titulo: 'El límite es por IP, no por usuario: un segundo owner desde la misma IP también recibe 429',
      esperado: 'informativo', request: { method: 'POST', path: `/api/empresas/${C}/eliminar-definitivo`, actor: 'segundo owner (misma IP)' },
      real: { status: r2.status, body: r2.text.slice(0, 120) }, resultado: 'INFO',
      nota: r2.status === 429
        ? 'Sin límite por cuenta: un JWT de owner robado permite 5 intentos de contraseña / 15 min POR CADA IP distinta (botnet), y el owner legítimo queda bloqueado si comparte IP con quien insiste.'
        : 'El segundo owner no quedó bloqueado (límite por cuenta).' });
  }
  const spoof = await L.call('POST', `/api/empresas/${C}/eliminar-definitivo`, { token: T.owner, headers: { 'X-Forwarded-For': '203.0.113.77' }, body: { password: 'spoof' } });
  S.registrar({ id: 'ELIM-xff-no-evade', titulo: 'Falsificar X-Forwarded-For no evade el límite', esperado: '429',
    request: { method: 'POST', path: `/api/empresas/${C}/eliminar-definitivo`, actor: 'owner + XFF falso' },
    real: { status: spoof.status, body: spoof.text.slice(0, 100) }, resultado: spoof.status === 429 ? 'OK' : 'FALLA', severidad: 'alta' });

  // ── Otras validaciones ────────────────────────────────────────────────────
  await L.reiniciarBackend();
  await S.check({ id: 'ELIM-sin-password', titulo: 'Sin contraseña en el body', method: 'POST', path: `/api/empresas/${C}/eliminar-definitivo`, actor: 'owner',
    token: T.owner, body: {}, esperado: '400', severidad: 'media', ok: r => r.status === 400 });
  await S.check({ id: 'ELIM-password-de-otro', titulo: 'Contraseña de OTRO owner (admin123) con el token de st.owner', method: 'POST', path: `/api/empresas/${C}/eliminar-definitivo`,
    actor: 'owner', token: T.owner, body: { password: 'admin123' }, esperado: '403', severidad: 'alta', ok: r => r.status === 403 });
  await S.check({ id: 'ELIM-password-tipo-objeto', titulo: 'password como objeto/array (NoSQL-style)', method: 'POST', path: `/api/empresas/${C}/eliminar-definitivo`,
    actor: 'owner', token: T.owner, body: { password: { $ne: null } }, esperado: '4xx, nunca 5xx ni borrado', severidad: 'alta',
    ok: r => r.status >= 400 && r.status < 500 && L.psql(`SELECT count(*) FROM empresas WHERE id='${C}'`) === '1' });
  await S.check({ id: 'ELIM-id-no-uuid', titulo: 'id de empresa no UUID', method: 'POST', path: `/api/empresas/no-es-uuid/eliminar-definitivo`, actor: 'owner',
    token: T.owner, body: { password: L.PW }, esperado: '4xx (400/404), nunca 500', severidad: 'baja', ok: r => r.status >= 400 && r.status < 500 });
  await S.check({ id: 'ELIM-empresa-inexistente', titulo: 'Empresa inexistente con contraseña correcta', method: 'POST', path: `/api/empresas/00000000-0000-0000-0000-000000000000/eliminar-definitivo`,
    actor: 'owner', token: T.owner, body: { password: L.PW }, esperado: '404', severidad: 'baja', ok: r => r.status === 404 });

  // ── Camino feliz (empresa desechable 2) ────────────────────────────────────
  await L.reiniciarBackend();   // el límite cuenta también los 400: se reinicia el contador en memoria
  const D = await crear(`ST Empresa Desechable2 ${Date.now().toString(36)}`);
  await S.check({ id: 'ELIM-contrasena-correcta', titulo: 'Contraseña correcta elimina la empresa desechable', method: 'POST', path: `/api/empresas/${D}/eliminar-definitivo`,
    actor: 'owner', token: T.owner, body: { password: L.PW }, esperado: '200 y la empresa ya no existe', severidad: 'media',
    ok: r => r.status === 200 && L.psql(`SELECT count(*) FROM empresas WHERE id='${D}'`) === '0' });
  const fd = filas(D);
  S.registrar({ id: 'ELIM-audit-exito', titulo: 'El borrado exitoso deja rastro en audit_logs con status 200', esperado: 'una fila con status_code 200',
    request: { method: 'SQL', path: `audit_logs WHERE registro_id=<D>`, actor: 'psql' },
    real: { status: 0, body: fd.join(' ; ') }, resultado: fd.some(x => x.startsWith('200|')) ? 'OK' : 'FALLA', severidad: 'media' });

  L.autoReset(true);
  S.save();
  execSync(`${__dirname}/snapshot.sh restore seeded`, { stdio: 'inherit' });
})().catch(e => { console.error(e); process.exit(1); });
