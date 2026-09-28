'use strict';
/**
 * Invitaciones administrativas: reuso, expirada (410), revocada/usada (409),
 * carrera entre dos aceptaciones, política de contraseña, mass assignment en
 * la aceptación, alcance de quién puede invitar y fuerza bruta del token.
 * (La fuerza bruta va al final, con el limitador real de 30/15 min.)
 */
const L = require('./lib');
const { execSync } = require('child_process');

const F = L.fixtures();
const S = new L.Suite('04-invitaciones', 'Invitaciones: reuso, expiración, revocación, carrera y fuerza bruta del token');
const run = Date.now().toString(36);
const mail = n => `st.inv.${run}.${n}@sectest.local`;
const tokenDe = enlace => enlace.split('/invitacion/')[1];

(async () => {
  await L.reiniciarBackend();
  const T = await L.tokens(true);
  const crear = async (n, tokenKey = 'owner', extra = {}) => {
    const body = { email: mail(n), rol_invitado: 'admin_empresa', empresa_id: F.empresas.A, ...extra };
    const r = await L.call('POST', '/api/invitaciones', { token: T[tokenKey], body });
    if (r.status !== 201) throw new Error(`no se pudo crear invitación ${n}: ${r.status} ${r.text}`);
    return { id: r.json.id, token: tokenDe(r.json.enlace), email: body.email };
  };

  // ── Reuso: aceptada una vez, no vale otra vez ──────────────────────────────
  const inv1 = await crear('reuso');
  await S.check({ id: 'INV-consulta-valida', titulo: 'GET /invitaciones/:token de una invitación pendiente', method: 'GET', path: `/api/invitaciones/${inv1.token}`,
    actor: 'anónimo con el token', esperado: '200 (solo email, rol, nombre de empresa)', ok: r => r.status === 200 && !('id' in (r.json || {})) && !('invitado_por' in (r.json || {})) });
  const acepta1 = await S.check({ id: 'INV-aceptar-1', titulo: 'Primera aceptación', method: 'POST', path: `/api/invitaciones/${inv1.token}/aceptar`,
    actor: 'anónimo con el token', body: { nombre: 'ST Invitado Uno', password: 'Invitado2026x' }, esperado: '200 + sesión', ok: r => r.status === 200 && !!r.json?.token });
  await S.check({ id: 'INV-reuso-aceptar', titulo: 'Segunda aceptación del mismo token (reuso)', method: 'POST', path: `/api/invitaciones/${inv1.token}/aceptar`,
    actor: 'anónimo con el token ya usado', body: { nombre: 'ST Invitado Dos', password: 'Invitado2026y' }, esperado: '409', severidad: 'alta',
    ok: r => r.status === 409 });
  await S.check({ id: 'INV-reuso-consulta', titulo: 'GET del token ya usado', method: 'GET', path: `/api/invitaciones/${inv1.token}`,
    actor: 'anónimo', esperado: '409', severidad: 'baja', ok: r => r.status === 409 });
  // El usuario resultante tiene el rol y el tenant INVITADOS, sin importar el body.
  const inv2 = await crear('mass');
  await S.check({ id: 'INV-mass-assignment', titulo: 'Aceptar con {rol:"owner", empresa_id: B} en el body', method: 'POST', path: `/api/invitaciones/${inv2.token}/aceptar`,
    actor: 'anónimo con el token', body: { nombre: 'ST Mass', password: 'Invitado2026z', rol: 'owner', empresa_id: F.empresas.B, rol_invitado: 'owner', sucursal_id: F.sucursales.B1 },
    esperado: 'usuario admin_empresa de la empresa A (lo invitado)', severidad: 'crítica',
    ok: r => r.status === 200 && L.psql(`SELECT rol||'|'||empresa_id FROM usuarios WHERE email='${inv2.email}'`) === `admin_empresa|${F.empresas.A}` });

  // ── Expirada → 410 ─────────────────────────────────────────────────────────
  const inv3 = await crear('expirada');
  L.psql(`UPDATE invitaciones SET expira_en = NOW() - interval '1 minute' WHERE id = '${inv3.id}'`);
  await S.check({ id: 'INV-expirada-consulta', titulo: 'GET de una invitación vencida', method: 'GET', path: `/api/invitaciones/${inv3.token}`,
    actor: 'anónimo', esperado: '410', severidad: 'media', ok: r => r.status === 410 });
  await S.check({ id: 'INV-expirada-aceptar', titulo: 'Aceptar una invitación vencida', method: 'POST', path: `/api/invitaciones/${inv3.token}/aceptar`,
    actor: 'anónimo', body: { nombre: 'ST Tarde', password: 'Invitado2026t' }, esperado: '410 y no se crea el usuario', severidad: 'alta',
    ok: r => r.status === 410 && L.psql(`SELECT count(*) FROM usuarios WHERE email='${inv3.email}'`) === '0' });

  const inv3b = await crear('expirada7h');
  L.psql(`UPDATE invitaciones SET expira_en = NOW() - interval '7 hours' WHERE id = '${inv3b.id}'`);
  await S.check({ id: 'INV-expirada-7h-consulta', titulo: 'GET de una invitación vencida hace 7 horas', method: 'GET', path: `/api/invitaciones/${inv3b.token}`,
    actor: 'anónimo', esperado: '410', severidad: 'media', ok: r => r.status === 410,
    nota: 'Control del desfase de zona horaria: con >6 h de vencimiento sí responde 410; entre 0 y 6 h sigue aceptándose.' });

  // ── Revocada → 409 ─────────────────────────────────────────────────────────
  const inv4 = await crear('revocada');
  await S.check({ id: 'INV-revocar', titulo: 'El owner revoca la invitación', method: 'PATCH', path: `/api/invitaciones/${inv4.id}/revocar`,
    actor: 'owner', token: T.owner, body: {}, esperado: '200', ok: r => r.status === 200 });
  await S.check({ id: 'INV-revocada-consulta', titulo: 'GET de una invitación revocada', method: 'GET', path: `/api/invitaciones/${inv4.token}`,
    actor: 'anónimo', esperado: '409', severidad: 'media', ok: r => r.status === 409 });
  await S.check({ id: 'INV-revocada-aceptar', titulo: 'Aceptar una invitación revocada', method: 'POST', path: `/api/invitaciones/${inv4.token}/aceptar`,
    actor: 'anónimo', body: { nombre: 'ST Revocada', password: 'Invitado2026r' }, esperado: '409 y no se crea el usuario', severidad: 'alta',
    ok: r => r.status === 409 && L.psql(`SELECT count(*) FROM usuarios WHERE email='${inv4.email}'`) === '0' });
  await S.check({ id: 'INV-revocar-dos-veces', titulo: 'Revocar una ya revocada', method: 'PATCH', path: `/api/invitaciones/${inv4.id}/revocar`,
    actor: 'owner', token: T.owner, body: {}, esperado: '409', severidad: 'baja', ok: r => r.status === 409 });

  // ── Reenviar invalida el token anterior ────────────────────────────────────
  const inv5 = await crear('reenviar');
  const re = await L.call('POST', `/api/invitaciones/${inv5.id}/reenviar`, { token: T.owner, body: {} });
  await S.check({ id: 'INV-reenviar-invalida-viejo', titulo: 'Tras reenviar, el token anterior deja de servir', method: 'GET', path: `/api/invitaciones/${inv5.token}`,
    actor: 'anónimo con el token viejo', esperado: '404', severidad: 'media', ok: r => re.status === 200 && r.status === 404 });
  await S.check({ id: 'INV-reenviar-nuevo-sirve', titulo: 'El token nuevo sí sirve', method: 'GET', path: `/api/invitaciones/${tokenDe(re.json.enlace)}`,
    actor: 'anónimo con el token nuevo', esperado: '200', ok: r => r.status === 200 });

  // ── Carrera: dos aceptaciones simultáneas ──────────────────────────────────
  const inv6 = await crear('carrera');
  const [c1, c2, c3] = await Promise.all([1, 2, 3].map(i =>
    L.call('POST', `/api/invitaciones/${inv6.token}/aceptar`, { body: { nombre: `ST Carrera ${i}`, password: `Carrera2026${i}x` } })));
  const ok200 = [c1, c2, c3].filter(r => r.status === 200).length;
  const usuarios = L.psql(`SELECT count(*) FROM usuarios WHERE email='${inv6.email}'`);
  S.registrar({ id: 'INV-carrera', titulo: 'Tres aceptaciones simultáneas del mismo token', esperado: 'exactamente un 200 y un solo usuario',
    request: { method: 'POST', path: `/api/invitaciones/:token/aceptar (x3 en paralelo)`, actor: 'anónimo' },
    real: { status: 0, body: `estados=${[c1, c2, c3].map(r => r.status).join(',')}; usuarios creados=${usuarios}` },
    resultado: ok200 === 1 && usuarios === '1' ? 'OK' : 'FALLA', severidad: 'alta' });

  // ── Contraseña ─────────────────────────────────────────────────────────────
  const inv7 = await crear('pass');
  for (const [pw, nombre] of [['abc', 'muy corta'], ['12345678', 'común'], ['soloLetrasAqui', 'sin números'], ['x'.repeat(80) + '1', 'más de 72 bytes']]) {
    await S.check({ id: `INV-password-${nombre.replace(/\W+/g, '-')}`, titulo: `Aceptar con contraseña ${nombre}`, method: 'POST', path: `/api/invitaciones/${inv7.token}/aceptar`,
      actor: 'anónimo', body: { nombre: 'ST Pass', password: pw }, esperado: '400/422', severidad: 'media', ok: r => r.status === 400 || r.status === 422 });
  }

  // ── Quién puede invitar (alcance) ──────────────────────────────────────────
  await S.check({ id: 'INV-adminEmp-invita-adminEmp', titulo: 'admin_empresa intenta invitar a otro admin_empresa', method: 'POST', path: '/api/invitaciones', actor: 'adminEmpA',
    token: T.adminEmpA, body: { email: mail('esc1'), rol_invitado: 'admin_empresa', empresa_id: F.empresas.A }, esperado: '403', severidad: 'alta', ok: r => r.status === 403 });
  await S.check({ id: 'INV-adminEmp-invita-sucursal-B', titulo: 'admin_empresa A invita a admin_sucursal de una sucursal de la empresa B', method: 'POST', path: '/api/invitaciones', actor: 'adminEmpA',
    token: T.adminEmpA, body: { email: mail('esc2'), rol_invitado: 'admin_sucursal', sucursal_id: F.sucursales.B1 }, esperado: '403', severidad: 'crítica', ok: r => r.status === 403 });
  await S.check({ id: 'INV-owner-invita-adminSuc', titulo: 'owner intenta invitar directamente a admin_sucursal', method: 'POST', path: '/api/invitaciones', actor: 'owner',
    token: T.owner, body: { email: mail('esc3'), rol_invitado: 'admin_sucursal', sucursal_id: F.sucursales.A1 }, esperado: '403 (solo admin_empresa)', severidad: 'baja', ok: r => r.status === 403 });
  await S.check({ id: 'INV-agente-invita', titulo: 'agente intenta invitar', method: 'POST', path: '/api/invitaciones', actor: 'agenteA1',
    token: T.agenteA1, body: { email: mail('esc4'), rol_invitado: 'admin_sucursal', sucursal_id: F.sucursales.A1 }, esperado: '403', severidad: 'alta', ok: r => r.status === 403 });
  await S.check({ id: 'INV-rol-owner', titulo: 'Invitar con rol_invitado = owner', method: 'POST', path: '/api/invitaciones', actor: 'owner',
    token: T.owner, body: { email: mail('esc5'), rol_invitado: 'owner', empresa_id: F.empresas.A }, esperado: '400/422', severidad: 'crítica', ok: r => r.status === 400 || r.status === 422 });
  await S.check({ id: 'INV-email-existente', titulo: 'Invitar a un correo que ya es usuario', method: 'POST', path: '/api/invitaciones', actor: 'owner',
    token: T.owner, body: { email: L.EMAIL.resA1, rol_invitado: 'admin_empresa', empresa_id: F.empresas.A }, esperado: '409', severidad: 'baja', ok: r => r.status === 409 });

  // ── Entradas hostiles en el token ──────────────────────────────────────────
  for (const [t, n] of [["'%20OR%201=1--", 'sqli'], ['..%2F..%2Fetc%2Fpasswd', 'traversal'], ['A'.repeat(5000), 'largo'], ['%00%00%00%00%00%00%00%00%00%00%00', 'nulo'], ['<script>alert(1)</script>x', 'xss']]) {
    await S.check({ id: `INV-token-hostil-${n}`, titulo: `GET /invitaciones/<token ${n}>`, method: 'GET', path: `/api/invitaciones/${t}`, actor: 'anónimo',
      esperado: '404 (o 4xx), nunca 5xx', severidad: 'media', ok: r => r.status >= 400 && r.status < 500 });
  }

  // ── Fuerza bruta del token (límite real de producción: 30 / 15 min por IP) ─
  await L.reiniciarBackend();
  L.autoReset(false);
  const cod = [];
  const inicio = Date.now();
  for (let i = 0; i < 40; i++) {
    const candidato = require('crypto').randomBytes(32).toString('base64url');
    const r = await L.call('GET', `/api/invitaciones/${candidato}`);
    cod.push(r.status);
  }
  const ms = Date.now() - inicio;
  const first429 = cod.indexOf(429) + 1;
  S.registrar({ id: 'INV-fuerza-bruta', titulo: '40 tokens aleatorios de 256 bits contra GET /invitaciones/:token', esperado: '404 hasta el intento 30 y 429 desde el 31 (30/15 min por IP)',
    request: { method: 'GET', path: '/api/invitaciones/<random 43 chars> (x40)', actor: 'anónimo' },
    real: { status: 429, body: `404 x${cod.filter(c => c === 404).length}, 429 x${cod.filter(c => c === 429).length}; primer 429 en el intento ${first429}; ${ms} ms` },
    resultado: first429 === 31 ? 'OK' : 'FALLA', severidad: 'media',
    nota: 'Espacio de búsqueda 2^256; a 30 intentos/15 min por IP, adivinar un token es inviable. El límite sirve contra abuso, no como única defensa.' });
  const aceptar429 = await L.call('POST', `/api/invitaciones/${require('crypto').randomBytes(32).toString('base64url')}/aceptar`, { body: { nombre: 'ST x', password: 'Invitado2026q' } });
  S.registrar({ id: 'INV-fuerza-bruta-aceptar-comparte-cupo', titulo: 'El cupo de fuerza bruta se comparte con POST /aceptar', esperado: '429',
    request: { method: 'POST', path: '/api/invitaciones/<random>/aceptar', actor: 'anónimo' },
    real: { status: aceptar429.status, body: aceptar429.text.slice(0, 100) }, resultado: aceptar429.status === 429 ? 'OK' : 'FALLA', severidad: 'baja' });
  L.autoReset(true);

  S.save();
  execSync(`${__dirname}/snapshot.sh restore seeded`, { stdio: 'inherit' });
})().catch(e => { console.error(e); process.exit(1); });
