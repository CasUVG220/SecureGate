/**
 * Alta autoservicio de una empresa (T12): asistente de onboarding.
 *
 * Flujo (modelo de amenazas en `docs/saas_nucleo.md`, sección 8):
 *   1. `POST /onboarding/solicitar` (público): correo + nombre de empresa. Se manda un enlace al correo; solo quien lo recibe puede seguir.
 *   2. El enlace abre el asistente (`/onboarding/<token>`): empresa, primera sucursal y plan. El borrador se guarda en la fila (retomable).
 *   3. `POST /onboarding/:token/completar`: en UNA transacción crea la empresa, la primera sucursal, la suscripción en prueba y la INVITACIÓN de
 *      administrador de empresa (la misma tabla y el mismo flujo de aceptación de las invitaciones en cascada). Nada queda a medias.
 *   4. Al aceptar la invitación, el administrador entra y termina el último paso —emitir el código de su primera garita— con la ruta normal.
 *
 * El asistente no crea usuarios ni sesiones: la cuenta nace SOLO al aceptar la invitación. Por eso el enlace del asistente nunca da acceso a datos.
 */
import { generarToken, hashToken } from '../controllers/invitaciones.controller';
import { appUrl, enviarEmail } from './email';
import { planPorCodigo, asignarSuscripcion, type Consultable } from './suscripciones';
import { TIPOS_SUCURSAL } from '../utils/sucursal';

export const TTL_SOLICITUD_DIAS = 7;
export const MAX_SOLICITUDES_POR_CORREO_24H = 3;
export const MAX_REENVIOS = 3;
export const INVITACION_TTL_HORAS_AUTOSERVICIO = 72;

// ── Validaciones (puras) ─────────────────────────────────────────────────────────────────────────────────

export type ResultadoValidacion<T> = { ok: true; valores: T } | { ok: false; error: string };

/** Sin caracteres de control ni `<` `>`: los nombres terminan en correos, tablas y archivos. */
const TEXTO_SEGURO = /^[^\u0000-\u001F\u007F<>]*$/u;
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
/** NIT de Guatemala: hasta 12 dígitos, guion opcional y un dígito o K de control (no se valida el dígito verificador). */
const NIT_RE = /^[0-9]{1,12}-?[0-9K]$/;

export function texto(v: unknown, min: number, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.normalize('NFC').trim().replace(/\s+/g, ' ');
  return t.length >= min && t.length <= max && TEXTO_SEGURO.test(t) ? t : null;
}

export function normalizarEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

export interface DatosSolicitud { email: string; empresa_nombre: string }

/** `sitio_web` es un campo trampa (honeypot): invisible para personas, lo llenan los robots. */
export function validarSolicitud(b: Record<string, unknown>): ResultadoValidacion<DatosSolicitud> {
  const email = normalizarEmail(b.email);
  if (!email) return { ok: false, error: 'email inválido' };
  const empresa = texto(b.empresa_nombre, 2, 150);
  if (!empresa) return { ok: false, error: 'empresa_nombre: de 2 a 150 caracteres, sin < > ni caracteres de control' };
  if (b.acepta_terminos !== true) return { ok: false, error: 'Debes aceptar los términos de uso' };
  return { ok: true, valores: { email, empresa_nombre: empresa } };
}

export interface Borrador {
  empresa_nombre: string;
  nit: string | null;
  sucursal_nombre: string;
  direccion: string | null;
  tipo: string | null;
  plan_codigo: string;
}

/** `parcial`: guardar el borrador permite enviar solo lo que ya se llenó. Los campos desconocidos se rechazan (no se guardan a ciegas). */
export function validarBorrador(b: Record<string, unknown>, parcial: boolean): ResultadoValidacion<Partial<Borrador>> {
  const CAMPOS = ['empresa_nombre', 'nit', 'sucursal_nombre', 'direccion', 'tipo', 'plan_codigo'];
  const extra = Object.keys(b).filter(k => !CAMPOS.includes(k));
  if (extra.length) return { ok: false, error: `Campos no permitidos: ${extra.join(', ')}` };
  const v: Partial<Borrador> = {};
  const tiene = (k: string) => b[k] !== undefined;
  const falta = (k: string) => !parcial && !tiene(k);

  if (falta('empresa_nombre') || (tiene('empresa_nombre') && !texto(b.empresa_nombre, 2, 150))) return { ok: false, error: 'empresa_nombre: de 2 a 150 caracteres' };
  if (tiene('empresa_nombre')) v.empresa_nombre = texto(b.empresa_nombre, 2, 150)!;
  if (tiene('nit')) {
    if (b.nit === null || b.nit === '') v.nit = null;
    else {
      const nit = typeof b.nit === 'string' ? b.nit.trim().toUpperCase() : '';
      if (!NIT_RE.test(nit)) return { ok: false, error: 'nit inválido (ejemplo: 1234567-8)' };
      v.nit = nit;
    }
  }
  if (falta('sucursal_nombre') || (tiene('sucursal_nombre') && !texto(b.sucursal_nombre, 2, 150))) return { ok: false, error: 'sucursal_nombre: de 2 a 150 caracteres' };
  if (tiene('sucursal_nombre')) v.sucursal_nombre = texto(b.sucursal_nombre, 2, 150)!;
  if (tiene('direccion')) {
    if (b.direccion === null || b.direccion === '') v.direccion = null;
    else {
      const d = texto(b.direccion, 3, 250);
      if (!d) return { ok: false, error: 'direccion: de 3 a 250 caracteres' };
      v.direccion = d;
    }
  }
  if (tiene('tipo')) {
    if (b.tipo === null || b.tipo === '') v.tipo = null;
    else if (typeof b.tipo === 'string' && (TIPOS_SUCURSAL as readonly string[]).includes(b.tipo)) v.tipo = b.tipo;
    else return { ok: false, error: `tipo inválido (${TIPOS_SUCURSAL.join(', ')})` };
  }
  if (falta('plan_codigo') || (tiene('plan_codigo') && (typeof b.plan_codigo !== 'string' || !/^[a-z0-9_-]{2,30}$/.test(b.plan_codigo)))) return { ok: false, error: 'plan_codigo inválido' };
  if (tiene('plan_codigo')) v.plan_codigo = b.plan_codigo as string;
  if (parcial && Object.keys(v).length === 0) return { ok: false, error: 'No hay nada que guardar' };
  return { ok: true, valores: v };
}

// ── Solicitudes ──────────────────────────────────────────────────────────────────────────────────────────

export interface Solicitud {
  id: string; email: string; empresa_nombre: string; estado: 'abierta' | 'invitada'; borrador: Partial<Borrador>;
  empresa_id: string | null; sucursal_id: string | null; invitacion_id: string | null; reenvios: number; vencida: boolean; expira_en: string;
}

export const enlaceOnboarding = (token: string): string => `${appUrl()}/onboarding/${token}`;

const COLUMNAS = `id, email, empresa_nombre, estado, borrador, empresa_id, sucursal_id, invitacion_id, reenvios, expira_en, (expira_en <= NOW()) AS vencida`;

export async function solicitudPorToken(db: Consultable, token: unknown, bloquear = false): Promise<Solicitud | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const r = await db.query(`SELECT ${COLUMNAS} FROM onboarding_solicitudes WHERE token_hash = $1${bloquear ? ' FOR UPDATE' : ''}`, [hashToken(token)]);
  return (r.rows[0] as Solicitud) ?? null;
}

export type ResultadoSolicitar =
  | { tipo: 'creada'; token: string }
  | { tipo: 'limite_correo' }
  | { tipo: 'cuenta_existente' };

/**
 * Crea la solicitud y manda el enlace. NO revela si el correo ya tiene cuenta: en ese caso se avisa por correo (al dueño de la bandeja) y la
 * respuesta HTTP es la misma. El tope por correo cuenta solicitudes de las últimas 24 h, exista o no la cuenta.
 */
export async function solicitar(db: Consultable, d: DatosSolicitud, ip: string | null): Promise<ResultadoSolicitar> {
  const recientes = await db.query(
    `SELECT COUNT(*)::int AS n FROM onboarding_solicitudes WHERE email = $1 AND created_at > NOW() - interval '24 hours'`, [d.email]);
  if (recientes.rows[0].n >= MAX_SOLICITUDES_POR_CORREO_24H) return { tipo: 'limite_correo' };

  const existe = (await db.query('SELECT 1 FROM usuarios WHERE email = $1', [d.email])).rows.length > 0;
  const token = generarToken();
  if (existe) {
    // Se registra la solicitud (cuenta para el tope de 24 h, para que esto no sirva de grifo de correos) pero ya nace cerrada y el enlace nunca se manda.
    await db.query(
      `INSERT INTO onboarding_solicitudes (email, empresa_nombre, token_hash, estado, ip_origen, expira_en) VALUES ($1, $2, $3, 'invitada', $4, NOW())`,
      [d.email, d.empresa_nombre, hashToken(token), ip]);
    await enviarEmail({
      to: d.email, subject: 'Ya tienes una cuenta en SecureGate',
      text: 'Hola,\n\nAlguien pidió crear una empresa en SecureGate con este correo, pero ya existe una cuenta con él.\nSi fuiste tú, inicia sesión en lugar de registrarte. Si no, ignora este mensaje.\n',
    });
    return { tipo: 'cuenta_existente' };
  }
  await db.query(
    `INSERT INTO onboarding_solicitudes (email, empresa_nombre, token_hash, borrador, ip_origen, expira_en)
     VALUES ($1, $2, $3, $4::jsonb, $5, NOW() + make_interval(days => $6::int))`,
    [d.email, d.empresa_nombre, hashToken(token), JSON.stringify({ empresa_nombre: d.empresa_nombre }), ip, TTL_SOLICITUD_DIAS],
  );
  await enviarEmail({
    to: d.email, subject: 'Continúa el alta de tu empresa en SecureGate',
    text: `Hola,\n\nPara continuar con el alta de "${d.empresa_nombre}" en SecureGate abre este enlace (válido ${TTL_SOLICITUD_DIAS} días):\n${enlaceOnboarding(token)}\n\n` +
      'Podrás elegir tu plan y registrar tu primera sucursal. Si no fuiste tú, ignora este correo: no se crea nada hasta que sigas el enlace.\n',
  });
  return { tipo: 'creada', token };
}

export async function guardarBorrador(db: Consultable, id: string, parcial: Partial<Borrador>): Promise<Partial<Borrador>> {
  const r = await db.query(
    `UPDATE onboarding_solicitudes
        SET borrador = borrador || $2::jsonb, empresa_nombre = COALESCE($3, empresa_nombre), updated_at = NOW()
      WHERE id = $1 RETURNING borrador`,
    [id, JSON.stringify(parcial), parcial.empresa_nombre ?? null],
  );
  return r.rows[0].borrador;
}

export class OnboardingError extends Error {
  constructor(public readonly status: number, mensaje: string, public readonly codigo?: string) {
    super(mensaje);
    this.name = 'OnboardingError';
  }
}

const BORRADOR_REQUERIDO: Array<keyof Borrador> = ['empresa_nombre', 'sucursal_nombre', 'plan_codigo'];

/**
 * Crea empresa + primera sucursal + suscripción en prueba + invitación de administrador, todo en la transacción del llamador.
 * Devuelve lo necesario para mandar el correo cuando la transacción termine.
 */
export async function completarSolicitud(db: Consultable, s: Solicitud): Promise<{ empresaId: string; sucursalId: string; invitacionId: string; token: string }> {
  if (s.estado !== 'abierta') throw new OnboardingError(409, 'Esta solicitud ya se completó: revisa tu correo o pide que te reenviemos la invitación', 'YA_COMPLETADA');
  const faltan = BORRADOR_REQUERIDO.filter(k => !s.borrador[k]);
  if (faltan.length) throw new OnboardingError(422, `Faltan datos: ${faltan.join(', ')}`, 'BORRADOR_INCOMPLETO');
  const b = s.borrador as Borrador;

  const plan = await planPorCodigo(db, b.plan_codigo);
  if (!plan || !plan.activo) throw new OnboardingError(422, 'El plan elegido ya no está disponible', 'PLAN_NO_DISPONIBLE');

  // Entre la solicitud y ahora alguien pudo crear una cuenta o una invitación con ese correo.
  if ((await db.query('SELECT 1 FROM usuarios WHERE email = $1', [s.email])).rows.length) throw new OnboardingError(409, 'Ya existe una cuenta con ese correo');
  if ((await db.query(`SELECT 1 FROM invitaciones WHERE email = $1 AND estado = 'pendiente' AND expira_en > NOW()`, [s.email])).rows.length) {
    throw new OnboardingError(409, 'Ese correo ya tiene una invitación pendiente');
  }

  const empresa = await db.query('INSERT INTO empresas (nombre, nit) VALUES ($1, $2) RETURNING id', [b.empresa_nombre, b.nit ?? null]);
  const empresaId: string = empresa.rows[0].id;
  const sucursal = await db.query(
    'INSERT INTO sucursales (empresa_id, nombre, direccion, tipo) VALUES ($1, $2, $3, $4) RETURNING id', [empresaId, b.sucursal_nombre, b.direccion ?? null, b.tipo ?? null]);
  await asignarSuscripcion(db, { empresaId, plan, motivo: 'Alta por autoservicio', usuarioId: null });

  const token = generarToken();
  const inv = await db.query(
    `INSERT INTO invitaciones (email, rol_invitado, empresa_id, token_hash, invitado_por, expira_en)
     VALUES ($1, 'admin_empresa', $2, $3, NULL, NOW() + make_interval(hours => $4::int)) RETURNING id`,
    [s.email, empresaId, hashToken(token), INVITACION_TTL_HORAS_AUTOSERVICIO],
  );
  await db.query(
    `UPDATE onboarding_solicitudes SET estado = 'invitada', empresa_id = $2, sucursal_id = $3, invitacion_id = $4, updated_at = NOW() WHERE id = $1`,
    [s.id, empresaId, sucursal.rows[0].id, inv.rows[0].id],
  );
  return { empresaId, sucursalId: sucursal.rows[0].id, invitacionId: inv.rows[0].id, token };
}

// ── Progreso del asistente (derivado de los datos, no de un contador) ────────────────────────────────────

export interface PasoOnboarding { id: 'empresa' | 'sucursal' | 'plan' | 'admin' | 'garita'; hecho: boolean }

/**
 * Qué falta para que la empresa esté operando. Se calcula de lo que existe en la base, no de un estado guardado: así es retomable por
 * construcción (si alguien crea la sucursal por otro lado, el paso aparece como hecho) y no puede quedar desincronizado.
 */
export async function progresoDeEmpresa(db: Consultable, empresaId: string) {
  const r = await db.query(
    `SELECT (SELECT COUNT(*) FROM sucursales WHERE empresa_id = $1 AND activo = TRUE)::int AS sucursales,
            (SELECT COUNT(*) FROM suscripciones WHERE empresa_id = $1)::int AS suscripciones,
            (SELECT COUNT(*) FROM usuarios WHERE empresa_id = $1 AND rol = 'admin_empresa' AND activo = TRUE)::int AS admins,
            (SELECT COUNT(*) FROM licencias_dispositivo l JOIN sucursales s ON s.id = l.sucursal_id WHERE s.empresa_id = $1 AND l.estado = 'activa')::int AS licencias,
            (SELECT id FROM sucursales WHERE empresa_id = $1 AND activo = TRUE ORDER BY created_at LIMIT 1) AS primera_sucursal_id`,
    [empresaId],
  );
  const f = r.rows[0];
  const pasos: PasoOnboarding[] = [
    { id: 'empresa', hecho: true },
    { id: 'sucursal', hecho: f.sucursales > 0 },
    { id: 'plan', hecho: f.suscripciones > 0 },
    { id: 'admin', hecho: f.admins > 0 },
    { id: 'garita', hecho: f.licencias > 0 },
  ];
  return { pasos, completo: pasos.every(p => p.hecho), primera_sucursal_id: (f.primera_sucursal_id as string | null) ?? null };
}
