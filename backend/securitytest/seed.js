'use strict';
/**
 * Siembra idempotente para las pruebas de seguridad (SOLO Postgres local).
 *
 *   node backend/securitytest/seed.js
 *
 * Crea DOS empresas (A con dos sucursales, B con una), un usuario de cada rol
 * (owner, admin_empresa, admin_sucursal, agente, residente) y datos en cada
 * sucursal: residentes, accesos, pagos, tickets, anuncios, preautorizaciones,
 * invitaciones QR, áreas, cargos. Las licencias de garita y las invitaciones
 * administrativas se crean por la API (así se ejercita el camino real).
 * Todo lo sembrado lleva el prefijo "ST-" / dominio @sectest.local para poder
 * borrarlo con cleanup.js.
 */
const { Client } = require('../node_modules/pg');
const crypto = require('crypto');
const fs = require('fs');
const L = require('./lib');

const DB = process.env.ST_DATABASE_URL || 'postgresql://sguser:sgpassword123@127.0.0.1:5433/securegate';
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(DB)) {
  console.error('ABORTO: la siembra solo corre contra el Postgres local (127.0.0.1/localhost).');
  process.exit(1);
}

const fp = s => crypto.createHash('sha256').update(s).digest('hex');

(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const one = async (sql, p) => (await db.query(sql, p)).rows[0];

  // ── Empresas y sucursales ──────────────────────────────────────────────
  const empresa = async nombre =>
    (await one('SELECT id FROM empresas WHERE nombre = $1', [nombre]))?.id
    ?? (await one('INSERT INTO empresas (nombre, nit) VALUES ($1, $2) RETURNING id', [nombre, 'ST-NIT'])).id;
  const sucursal = async (empresa_id, nombre) =>
    (await one('SELECT id FROM sucursales WHERE empresa_id = $1 AND nombre = $2', [empresa_id, nombre]))?.id
    ?? (await one('INSERT INTO sucursales (empresa_id, nombre, direccion, tipo) VALUES ($1, $2, $3, $4) RETURNING id', [empresa_id, nombre, 'ST dirección', 'residencial'])).id;

  const F = { empresas: {}, sucursales: {}, usuarios: {}, residentes: {}, datos: { A1: {}, A2: {}, B1: {} }, licencias: {}, invitaciones: {} };
  F.empresas.A = await empresa('ST Empresa A');
  F.empresas.B = await empresa('ST Empresa B');
  F.sucursales.A1 = await sucursal(F.empresas.A, 'ST Sucursal A1');
  F.sucursales.A2 = await sucursal(F.empresas.A, 'ST Sucursal A2');
  F.sucursales.B1 = await sucursal(F.empresas.B, 'ST Sucursal B1');
  // Empresa sacrificial para el escaneo activo de ZAP (sus rutas destructivas apuntan aquí).
  F.zap = { empresa: await empresa('ST Empresa Z (ZAP)') };
  F.zap.sucursal = await sucursal(F.zap.empresa, 'ST Sucursal Z1');

  // ── Usuarios (bcrypt costo 12, igual que producción) ────────────────────
  const usuario = async (key, nombre, rol, sucursal_id, empresa_id) =>
    (F.usuarios[key] = (await one(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id, empresa_id, activo)
       VALUES ($1, $2, crypt($3, gen_salt('bf', 12)), $4, $5, $6, TRUE)
       ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, password_hash = EXCLUDED.password_hash,
         rol = EXCLUDED.rol, sucursal_id = EXCLUDED.sucursal_id, empresa_id = EXCLUDED.empresa_id, activo = TRUE
       RETURNING id`,
      [nombre, L.EMAIL[key], L.PW, rol, sucursal_id, empresa_id])).id);

  await usuario('owner',      'ST Owner',           'owner',          null, null);
  await usuario('adminEmpA',  'ST Admin Empresa A', 'admin_empresa',  null, F.empresas.A);
  await usuario('adminSucA1', 'ST Admin Suc A1',    'admin_sucursal', F.sucursales.A1, null);
  await usuario('agenteA1',   'ST Agente A1',       'agente',         F.sucursales.A1, null);
  await usuario('resA1',      'ST Residente A1',    'residente',      F.sucursales.A1, null);
  await usuario('adminSucA2', 'ST Admin Suc A2',    'admin_sucursal', F.sucursales.A2, null);
  await usuario('resA2',      'ST Residente A2',    'residente',      F.sucursales.A2, null);
  await usuario('adminEmpB',  'ST Admin Empresa B', 'admin_empresa',  null, F.empresas.B);
  await usuario('adminSucB1', 'ST Admin Suc B1',    'admin_sucursal', F.sucursales.B1, null);
  await usuario('agenteB1',   'ST Agente B1',       'agente',         F.sucursales.B1, null);
  await usuario('resB1',      'ST Residente B1',    'residente',      F.sucursales.B1, null);
  await usuario('cobayaA',    'ST Cobaya A',        'agente',         F.sucursales.A1, null); // objetivo desechable de asignaciones

  // ── Residentes ─────────────────────────────────────────────────────────
  const residente = async (key, suc, uKey, casa) =>
    (F.residentes[key] = (await one(
      `INSERT INTO residentes (usuario_id, sucursal_id, numero_casa, estado_pago, saldo_pendiente, telefono)
       VALUES ($1, $2, $3, 'pendiente', 250, '50255550000')
       ON CONFLICT (usuario_id) DO UPDATE SET numero_casa = EXCLUDED.numero_casa RETURNING id`,
      [F.usuarios[uKey], F.sucursales[suc], casa])).id);
  await residente('A1', 'A1', 'resA1', 'ST-A1-01');
  await residente('A2', 'A2', 'resA2', 'ST-A2-01');
  await residente('B1', 'B1', 'resB1', 'ST-B1-01');

  // ── Datos por sucursal ─────────────────────────────────────────────────
  const visitante = async (dpi, nombre) =>
    (await one('SELECT id FROM visitantes WHERE numero_dpi = $1', [dpi]))?.id
    ?? (await one('INSERT INTO visitantes (nombre, numero_dpi) VALUES ($1, $2) RETURNING id', [nombre, dpi])).id;
  const visA = await visitante('ST-DPI-0001', 'ST Visitante Uno');
  const visB = await visitante('ST-DPI-0002', 'ST Visitante Dos');
  F.visitantes = { A: visA, B: visB };

  const S = {
    A1: { agente: 'agenteA1', admin: 'adminSucA1', res: 'resA1', vis: visA },
    A2: { agente: 'adminSucA2', admin: 'adminSucA2', res: 'resA2', vis: visA },
    B1: { agente: 'agenteB1', admin: 'adminSucB1', res: 'resB1', vis: visB },
  };
  for (const [k, c] of Object.entries(S)) {
    const suc = F.sucursales[k];
    const res = F.residentes[k];
    const d = F.datos[k];
    const ensure = async (existeSql, insertSql, params, existeParams = params) =>
      (await one(existeSql, existeParams))?.id ?? (await one(insertSql, params)).id;

    d.registro_acceso = await ensure(
      `SELECT id FROM registros_acceso WHERE sucursal_id = $1 AND notas = 'ST-seed'`,
      `INSERT INTO registros_acceso (sucursal_id, visitante_id, residente_id, agente_id, tipo, notas)
       VALUES ($1, $2, $3, $4, 'entrada', 'ST-seed') RETURNING id`,
      [suc, c.vis, res, F.usuarios[c.agente]], [suc]);
    d.pago = await ensure(
      `SELECT id FROM pagos WHERE referencia = $1`,
      `INSERT INTO pagos (sucursal_id, residente_id, monto, metodo, estado, referencia, banco, registrado_por)
       VALUES ($1, $2, 100, 'transferencia', 'pendiente', $3, 'ST Banco', $4) RETURNING id`,
      [suc, res, `ST-REF-${k}`, F.usuarios[c.admin]], [`ST-REF-${k}`]);
    d.ticket = await ensure(
      `SELECT id FROM tickets WHERE titulo = $1`,
      `INSERT INTO tickets (sucursal_id, residente_id, tipo, titulo) VALUES ($1, $2, 'queja', $3) RETURNING id`,
      [suc, res, `ST-ticket-${k}`], [`ST-ticket-${k}`]);
    await db.query(
      `INSERT INTO ticket_mensajes (ticket_id, autor_id, mensaje)
       SELECT $1, $2, 'ST-mensaje-privado' WHERE NOT EXISTS (SELECT 1 FROM ticket_mensajes WHERE ticket_id = $1)`,
      [d.ticket, F.usuarios[c.res]]);
    d.anuncio = await ensure(
      `SELECT id FROM anuncios WHERE titulo = $1`,
      `INSERT INTO anuncios (sucursal_id, titulo, contenido, creado_por) VALUES ($1, $2, 'ST contenido', $3) RETURNING id`,
      [suc, `ST-anuncio-${k}`, F.usuarios[c.admin]], [`ST-anuncio-${k}`]);
    d.preautorizacion = await ensure(
      `SELECT id FROM preautorizaciones WHERE nombre_visitante = $1`,
      `INSERT INTO preautorizaciones (sucursal_id, residente_id, nombre_visitante, numero_dpi, fecha_inicio, fecha_fin)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE + 30) RETURNING id`,
      [suc, res, `ST-pre-${k}`, `ST-PRE-DPI-${k}`], [`ST-pre-${k}`]);
    d.invitacion_qr = await ensure(
      `SELECT id FROM invitaciones_qr WHERE etiqueta = $1`,
      `INSERT INTO invitaciones_qr (sucursal_id, residente_id, tipo, etiqueta, fecha_inicio, fecha_fin, usos_maximos)
       VALUES ($1, $2, 'grupal', $3, CURRENT_DATE, CURRENT_DATE + 30, 5) RETURNING id`,
      [suc, res, `ST-qr-${k}`], [`ST-qr-${k}`]);
    d.area = await ensure(
      `SELECT id FROM areas_comunes WHERE nombre = $1`,
      `INSERT INTO areas_comunes (sucursal_id, nombre, descripcion) VALUES ($1, $2, 'ST') RETURNING id`,
      [suc, `ST-area-${k}`], [`ST-area-${k}`]);
    d.config_cargo = await ensure(
      `SELECT id FROM configuracion_cargos WHERE nombre = $1`,
      `INSERT INTO configuracion_cargos (sucursal_id, nombre, monto) VALUES ($1, $2, 75) RETURNING id`,
      [suc, `ST-cargo-${k}`], [`ST-cargo-${k}`]);
    d.cargo_programado = await ensure(
      `SELECT id FROM cargos_programados WHERE nombre = $1`,
      `INSERT INTO cargos_programados (sucursal_id, nombre, monto, aplica_a, creado_por) VALUES ($1, $2, 50, 'todos', $3) RETURNING id`,
      [suc, `ST-cp-${k}`, F.usuarios[c.admin]], [`ST-cp-${k}`]);
    d.blacklist = await ensure(
      `SELECT id FROM visitante_blacklist WHERE sucursal_id = $1 AND razon = 'ST-bl'`,
      `INSERT INTO visitante_blacklist (visitante_id, sucursal_id, razon, creado_por) VALUES ($1, $2, 'ST-bl', $3) RETURNING id`,
      [c.vis, suc, F.usuarios[c.admin]], [suc]);
    d.reserva = await ensure(
      `SELECT id FROM reservas_areas WHERE area_id = $1 AND fecha = '2030-01-01'`,
      `INSERT INTO reservas_areas (area_id, residente_id, fecha, hora_inicio, hora_fin, estado)
       VALUES ($1, $2, '2030-01-01', '10:00', '11:00', 'confirmada') RETURNING id`,
      [d.area, res], [d.area]);
  }
  await db.end();

  // ── Por la API: licencias de garita e invitaciones ──────────────────────
  const T = await L.tokens(true);
  const lic = async (clave, sucKey, tokenKey, activar) => {
    // Reusa la licencia si ya existe (etiqueta ST-lic-…).
    const lista = await L.call('GET', '/api/licencias', { token: T[tokenKey] });
    let fila = (lista.json || []).find(l => l.etiqueta === `ST-lic-${clave}`);
    if (!fila) {
      const r = await L.call('POST', '/api/licencias', { token: T[tokenKey], body: { etiqueta: `ST-lic-${clave}`, sucursal_id: F.sucursales[sucKey] } });
      if (r.status !== 201) throw new Error(`crear licencia ${clave}: ${r.status} ${r.text}`);
      fila = r.json;
    }
    const out = { id: fila.id, codigo: fila.codigo_activacion, sucursal: sucKey, fingerprint: fp(`st-fp-${clave}`) };
    if (activar) {
      const a = await L.call('POST', '/api/licencias/activar', { body: { codigo: out.codigo, fingerprint: out.fingerprint, nombre_dispositivo: `ST-pc-${clave}` } });
      if (a.status !== 200) throw new Error(`activar licencia ${clave}: ${a.status} ${a.text}`);
      out.token = a.json.token_licencia;
    }
    F.licencias[clave] = out;
  };
  await lic('A1', 'A1', 'adminSucA1', true);
  await lic('B1', 'B1', 'adminSucB1', true);
  await lic('A1-libre', 'A1', 'adminSucA1', false);
  await lic('B1-libre', 'B1', 'adminSucB1', false);

  const inv = async (clave, tokenKey, body) => {
    const lista = await L.call('GET', '/api/invitaciones', { token: T[tokenKey] });
    let fila = (lista.json || []).find(i => i.email === body.email);
    if (!fila) {
      const r = await L.call('POST', '/api/invitaciones', { token: T[tokenKey], body });
      if (r.status !== 201) throw new Error(`crear invitación ${clave}: ${r.status} ${r.text}`);
      fila = r.json;
    }
    F.invitaciones[clave] = { id: fila.id, email: fila.email, estado: fila.estado };
  };
  await inv('A', 'adminEmpA', { email: 'st.inv.a@sectest.local', rol_invitado: 'admin_sucursal', sucursal_id: F.sucursales.A2 });
  await inv('B', 'adminEmpB', { email: 'st.inv.b@sectest.local', rol_invitado: 'admin_sucursal', sucursal_id: F.sucursales.B1 });
  await inv('owner-A', 'owner', { email: 'st.inv.owner.a@sectest.local', rol_invitado: 'admin_empresa', empresa_id: F.empresas.A });
  await inv('owner-B', 'owner', { email: 'st.inv.owner.b@sectest.local', rol_invitado: 'admin_empresa', empresa_id: F.empresas.B });

  fs.writeFileSync(L.FIXTURES_FILE, JSON.stringify(F, null, 2));
  console.log(`\nSiembra lista → ${L.FIXTURES_FILE}`);
  console.log(`  empresas: A=${F.empresas.A} B=${F.empresas.B}`);
  console.log(`  usuarios: ${Object.keys(F.usuarios).length}, licencias: ${Object.keys(F.licencias).length}, invitaciones: ${Object.keys(F.invitaciones).length}`);
})().catch(e => { console.error('Siembra falló:', e); process.exit(1); });
