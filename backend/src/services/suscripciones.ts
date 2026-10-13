/**
 * SaaS · planes, suscripciones y medición de uso (T10).
 *
 * Reglas:
 *  - Los planes y sus precios viven en la tabla `planes` (nunca aquí). Dinero en CENTAVOS enteros.
 *  - Una empresa tiene a lo más una suscripción (estado: prueba / activa / vencida / cancelada). Cada cambio de plan o de estado deja una
 *    fila en `suscripcion_historial` (quién, cuándo, por qué).
 *  - Uso = visitas por empresa y MES CALENDARIO en America/Guatemala. Una visita es una fila de `registros_acceso` (la salida actualiza la
 *    misma fila) autorizada; los registros rechazados (`autorizado = FALSE`) no cuentan y un reenvío idempotente (mismo `id_cliente`) no
 *    suma dos veces. El mes se corta a las 00:00 de Guatemala, no a las 00:00 UTC.
 *  - Los límites de sucursales y garitas del plan se hacen cumplir al CREAR una nueva (`reservarCupo`); una empresa sin suscripción no tiene límites
 *    (empresas anteriores a los planes).
 */
import { APP_TZ } from '../utils/reservas';

export interface Consultable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

export const ESTADOS = ['prueba', 'activa', 'vencida', 'cancelada'] as const;
export type EstadoSuscripcion = (typeof ESTADOS)[number];

export interface Plan {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  precio_mensual_centavos: number;
  visitas_incluidas: number;
  precio_visita_extra_centavos: number;
  max_sucursales: number | null;
  max_garitas: number | null;
  dias_prueba: number;
  moneda: string;
  supuesto: boolean;
  activo: boolean;
  orden: number;
}

// BIGINT llega como texto desde pg: se normaliza a número (los montos caben de sobra en 2^53).
const PLAN_SQL = `id, codigo, nombre, descripcion, precio_mensual_centavos::float8 AS precio_mensual_centavos, visitas_incluidas,
  precio_visita_extra_centavos::float8 AS precio_visita_extra_centavos, max_sucursales, max_garitas, dias_prueba, moneda, supuesto, activo, orden`;

// ── Planes ───────────────────────────────────────────────────────────────────────────────────────────────

export async function listarPlanes(db: Consultable, soloActivos: boolean): Promise<Plan[]> {
  const r = await db.query(`SELECT ${PLAN_SQL} FROM planes ${soloActivos ? 'WHERE activo = TRUE' : ''} ORDER BY orden, precio_mensual_centavos`);
  return r.rows as Plan[];
}

export async function planPorId(db: Consultable, id: string): Promise<Plan | null> {
  const r = await db.query(`SELECT ${PLAN_SQL} FROM planes WHERE id = $1`, [id]);
  return (r.rows[0] as Plan) ?? null;
}

export async function planPorCodigo(db: Consultable, codigo: string): Promise<Plan | null> {
  const r = await db.query(`SELECT ${PLAN_SQL} FROM planes WHERE codigo = $1`, [codigo]);
  return (r.rows[0] as Plan) ?? null;
}

export type ResultadoValidacion<T> = { ok: true; valores: T } | { ok: false; error: string };

const entero = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;

/**
 * Valida el cuerpo de un plan. `parcial` = edición (solo lo que venga). El dinero se pide en CENTAVOS ENTEROS: un decimal (float) se rechaza
 * para que ningún `0.1 + 0.2` llegue a una factura.
 */
export function validarPlan(body: Record<string, unknown>, parcial: boolean): ResultadoValidacion<Partial<Omit<Plan, 'id'>>> {
  const v: Partial<Omit<Plan, 'id'>> = {};
  const tiene = (k: string) => body[k] !== undefined;
  const falta = (k: string) => !parcial && !tiene(k);

  if (falta('codigo') || (tiene('codigo') && (typeof body.codigo !== 'string' || !/^[a-z0-9_-]{2,30}$/.test(body.codigo)))) {
    return { ok: false, error: 'codigo: de 2 a 30 caracteres, solo minúsculas, números, guion y guion bajo' };
  }
  if (tiene('codigo')) v.codigo = body.codigo as string;
  if (falta('nombre') || (tiene('nombre') && (typeof body.nombre !== 'string' || !body.nombre.trim() || body.nombre.length > 80))) {
    return { ok: false, error: 'nombre: de 1 a 80 caracteres' };
  }
  if (tiene('nombre')) v.nombre = (body.nombre as string).trim();
  if (tiene('descripcion')) {
    if (body.descripcion !== null && (typeof body.descripcion !== 'string' || body.descripcion.length > 300)) return { ok: false, error: 'descripcion: máximo 300 caracteres' };
    v.descripcion = (body.descripcion as string | null) ?? null;
  }
  const dinero: Array<[keyof Plan, string]> = [['precio_mensual_centavos', 'precio_mensual_centavos'], ['precio_visita_extra_centavos', 'precio_visita_extra_centavos']];
  for (const [k, nombre] of dinero) {
    if (falta(nombre)) return { ok: false, error: `${nombre}: requerido (entero en centavos)` };
    if (tiene(nombre)) {
      const n = entero(body[nombre], 0, 100_000_000);
      if (n === null) return { ok: false, error: `${nombre}: debe ser un entero en centavos entre 0 y 100000000 (sin decimales)` };
      (v as Record<string, unknown>)[k] = n;
    }
  }
  if (falta('visitas_incluidas')) return { ok: false, error: 'visitas_incluidas: requerido' };
  if (tiene('visitas_incluidas')) {
    const n = entero(body.visitas_incluidas, 0, 100_000_000);
    if (n === null) return { ok: false, error: 'visitas_incluidas: entero entre 0 y 100000000' };
    v.visitas_incluidas = n;
  }
  for (const k of ['max_sucursales', 'max_garitas'] as const) {
    if (tiene(k)) {
      if (body[k] === null) v[k] = null;                                        // sin límite
      else {
        const n = entero(body[k], 1, 100_000);
        if (n === null) return { ok: false, error: `${k}: entero mayor a 0, o null para sin límite` };
        v[k] = n;
      }
    }
  }
  if (tiene('dias_prueba')) {
    const n = entero(body.dias_prueba, 0, 90);
    if (n === null) return { ok: false, error: 'dias_prueba: entero entre 0 y 90' };
    v.dias_prueba = n;
  }
  if (tiene('orden')) {
    const n = entero(body.orden, 0, 1000);
    if (n === null) return { ok: false, error: 'orden: entero entre 0 y 1000' };
    v.orden = n;
  }
  for (const k of ['activo', 'supuesto'] as const) {
    if (tiene(k)) {
      if (typeof body[k] !== 'boolean') return { ok: false, error: `${k}: debe ser true o false` };
      v[k] = body[k] as boolean;
    }
  }
  if (parcial && Object.keys(v).length === 0) return { ok: false, error: 'No hay nada que actualizar' };
  return { ok: true, valores: v };
}

export async function crearPlan(db: Consultable, v: Partial<Omit<Plan, 'id'>>): Promise<Plan> {
  const r = await db.query(
    `INSERT INTO planes (codigo, nombre, descripcion, precio_mensual_centavos, visitas_incluidas, precio_visita_extra_centavos,
                         max_sucursales, max_garitas, dias_prueba, supuesto, activo, orden)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 14), COALESCE($10, TRUE), COALESCE($11, TRUE), COALESCE($12, 0))
     RETURNING ${PLAN_SQL}`,
    [v.codigo, v.nombre, v.descripcion ?? null, v.precio_mensual_centavos, v.visitas_incluidas, v.precio_visita_extra_centavos,
     v.max_sucursales ?? null, v.max_garitas ?? null, v.dias_prueba ?? null, v.supuesto ?? null, v.activo ?? null, v.orden ?? null],
  );
  return r.rows[0] as Plan;
}

/** Actualiza solo los campos que vengan. Una edición de precios NO toca las facturas ya emitidas (T11 guarda su propio detalle). */
export async function actualizarPlan(db: Consultable, id: string, v: Partial<Omit<Plan, 'id'>>): Promise<Plan | null> {
  const columnas = Object.keys(v) as Array<keyof typeof v>;
  const sets = columnas.map((c, i) => `${c} = $${i + 2}`);
  const r = await db.query(
    `UPDATE planes SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING ${PLAN_SQL}`,
    [id, ...columnas.map(c => v[c])],
  );
  return (r.rows[0] as Plan) ?? null;
}

// ── Suscripciones ────────────────────────────────────────────────────────────────────────────────────────

export interface Suscripcion {
  id: string;
  empresa_id: string;
  plan_id: string;
  estado: EstadoSuscripcion;
  ciclo: 'mensual';
  inicio_en: string;
  prueba_hasta: string | null;
  cancelada_en: string | null;
  plan: Plan;
}

export async function suscripcionDe(db: Consultable, empresaId: string): Promise<Suscripcion | null> {
  const r = await db.query(
    `SELECT s.id, s.empresa_id, s.plan_id, s.estado, s.ciclo, s.inicio_en, s.prueba_hasta, s.cancelada_en,
            p.id AS p_id, p.codigo, p.nombre, p.descripcion, p.precio_mensual_centavos::float8 AS precio_mensual_centavos, p.visitas_incluidas,
            p.precio_visita_extra_centavos::float8 AS precio_visita_extra_centavos, p.max_sucursales, p.max_garitas, p.dias_prueba, p.moneda,
            p.supuesto, p.activo, p.orden
       FROM suscripciones s JOIN planes p ON p.id = s.plan_id
      WHERE s.empresa_id = $1`,
    [empresaId],
  );
  const f = r.rows[0];
  if (!f) return null;
  return {
    id: f.id, empresa_id: f.empresa_id, plan_id: f.plan_id, estado: f.estado, ciclo: f.ciclo, inicio_en: f.inicio_en, prueba_hasta: f.prueba_hasta, cancelada_en: f.cancelada_en,
    plan: {
      id: f.p_id, codigo: f.codigo, nombre: f.nombre, descripcion: f.descripcion, precio_mensual_centavos: f.precio_mensual_centavos, visitas_incluidas: f.visitas_incluidas,
      precio_visita_extra_centavos: f.precio_visita_extra_centavos, max_sucursales: f.max_sucursales, max_garitas: f.max_garitas, dias_prueba: f.dias_prueba,
      moneda: f.moneda, supuesto: f.supuesto, activo: f.activo, orden: f.orden,
    },
  };
}

export interface CambioSuscripcion {
  empresaId: string;
  /** Plan nuevo (si no se indica en una suscripción existente, se conserva el actual). */
  plan?: Plan;
  estado?: EstadoSuscripcion;
  motivo?: string | null;
  usuarioId: string | null;
}

/**
 * Crea la suscripción de una empresa (por defecto en `prueba`, con los días de prueba del plan) o cambia su plan y/o estado.
 * Escribe el histórico en la misma transacción que llame: `db` debe ser un cliente dentro de BEGIN…COMMIT para que cambio e histórico sean atómicos.
 * Devuelve `{ creada, cambio }` para que el controlador sepa qué decir.
 */
export async function asignarSuscripcion(db: Consultable, c: CambioSuscripcion): Promise<{ creada: boolean; huboCambio: boolean }> {
  const previa = await db.query(
    `SELECT id, plan_id, estado FROM suscripciones WHERE empresa_id = $1 FOR UPDATE`,
    [c.empresaId],
  );
  const motivo = c.motivo?.trim().slice(0, 300) || null;

  if (previa.rows.length === 0) {
    if (!c.plan) throw new Error('Para crear la suscripción hace falta un plan');
    const estado: EstadoSuscripcion = c.estado ?? 'prueba';
    const s = await db.query(
      `INSERT INTO suscripciones (empresa_id, plan_id, estado, prueba_hasta, cancelada_en)
       VALUES ($1, $2, $3::text, CASE WHEN $3::text = 'prueba' THEN NOW() + make_interval(days => $4::int) END, CASE WHEN $3::text = 'cancelada' THEN NOW() END)
       RETURNING id`,
      [c.empresaId, c.plan.id, estado, c.plan.dias_prueba],
    );
    await db.query(
      `INSERT INTO suscripcion_historial (suscripcion_id, empresa_id, plan_anterior_id, plan_nuevo_id, estado_anterior, estado_nuevo, motivo, cambiado_por)
       VALUES ($1, $2, NULL, $3, NULL, $4, $5, $6)`,
      [s.rows[0].id, c.empresaId, c.plan.id, estado, motivo ?? 'Alta de la suscripción', c.usuarioId],
    );
    return { creada: true, huboCambio: true };
  }

  const actual = previa.rows[0] as { id: string; plan_id: string; estado: EstadoSuscripcion };
  const planNuevoId = c.plan?.id ?? actual.plan_id;
  const estadoNuevo = c.estado ?? actual.estado;
  if (planNuevoId === actual.plan_id && estadoNuevo === actual.estado) return { creada: false, huboCambio: false };

  await db.query(
    `UPDATE suscripciones
        SET plan_id = $2, estado = $3::text, updated_at = NOW(),
            cancelada_en = CASE WHEN $3::text = 'cancelada' THEN COALESCE(cancelada_en, NOW()) ELSE NULL END,
            prueba_hasta = CASE WHEN $3::text = 'prueba' AND estado <> 'prueba' THEN NOW() + make_interval(days => $4::int)
                                -- Salir de la prueba (activar, cancelar…) la da por terminada hoy: la facturación (T11) cobra desde ahí.
                                WHEN $3::text <> 'prueba' AND estado = 'prueba' THEN LEAST(prueba_hasta, NOW())
                                ELSE prueba_hasta END
      WHERE id = $1`,
    [actual.id, planNuevoId, estadoNuevo, c.plan?.dias_prueba ?? 14],
  );
  await db.query(
    `INSERT INTO suscripcion_historial (suscripcion_id, empresa_id, plan_anterior_id, plan_nuevo_id, estado_anterior, estado_nuevo, motivo, cambiado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [actual.id, c.empresaId, actual.plan_id, planNuevoId, actual.estado, estadoNuevo, motivo, c.usuarioId],
  );
  return { creada: false, huboCambio: true };
}

export async function historialDe(db: Consultable, empresaId: string) {
  const r = await db.query(
    `SELECT h.id, h.created_at, h.estado_anterior, h.estado_nuevo, h.motivo,
            pa.codigo AS plan_anterior, pn.codigo AS plan_nuevo, u.nombre AS cambiado_por
       FROM suscripcion_historial h
       LEFT JOIN planes pa ON pa.id = h.plan_anterior_id
       JOIN planes pn ON pn.id = h.plan_nuevo_id
       LEFT JOIN usuarios u ON u.id = h.cambiado_por
      WHERE h.empresa_id = $1
      ORDER BY h.created_at DESC, h.id DESC`,
    [empresaId],
  );
  return r.rows;
}

// ── Medición de uso ──────────────────────────────────────────────────────────────────────────────────────

export interface Mes { anio: number; mes: number }

export const periodoTexto = (m: Mes): string => `${m.anio}-${String(m.mes).padStart(2, '0')}`;

/** «2026-10» → { anio, mes }, o `null` si no es un mes válido. */
export function parsearMes(texto: unknown): Mes | null {
  if (typeof texto !== 'string') return null;
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(texto);
  if (!m) return null;
  const anio = Number(m[1]);
  return anio >= 2020 && anio <= 2100 ? { anio, mes: Number(m[2]) } : null;
}

export const mesSiguiente = (m: Mes): Mes => (m.mes === 12 ? { anio: m.anio + 1, mes: 1 } : { anio: m.anio, mes: m.mes + 1 });

/** El mes calendario en curso en Guatemala (no en UTC: a las 19:00 del 30 de septiembre en Guatemala ya es octubre en UTC). */
export async function mesActual(db: Consultable): Promise<Mes> {
  const r = await db.query(
    `SELECT EXTRACT(YEAR FROM NOW() AT TIME ZONE $1)::int AS anio, EXTRACT(MONTH FROM NOW() AT TIME ZONE $1)::int AS mes`,
    [APP_TZ],
  );
  return { anio: r.rows[0].anio, mes: r.rows[0].mes };
}

/** Hoy en Guatemala: mes calendario y día del mes (el día 1 es el primero; sirve para proyectar el consumo del mes en curso). */
export async function hoyEnGuatemala(db: Consultable): Promise<Mes & { dia: number; diasDelMes: number }> {
  const r = await db.query(
    `SELECT EXTRACT(YEAR FROM NOW() AT TIME ZONE $1)::int AS anio, EXTRACT(MONTH FROM NOW() AT TIME ZONE $1)::int AS mes,
            EXTRACT(DAY FROM NOW() AT TIME ZONE $1)::int AS dia,
            EXTRACT(DAY FROM (date_trunc('month', NOW() AT TIME ZONE $1) + interval '1 month - 1 day'))::int AS dias`,
    [APP_TZ],
  );
  const f = r.rows[0];
  return { anio: f.anio, mes: f.mes, dia: f.dia, diasDelMes: f.dias };
}

export interface Proyeccion {
  visitas_proyectadas: number;
  excedente_proyectado: number;
  excedente_proyectado_centavos: number;
}

/**
 * Proyección lineal del mes: el ritmo de lo que va del mes (`visitas` en `dia` días) se extiende a `diasDelMes`. Redondea hacia arriba la
 * visita proyectada (mejor avisar de más que de menos). Es una estimación, no una factura: no distingue fines de semana ni eventos.
 */
export function proyectarMes(visitas: number, dia: number, diasDelMes: number, incluidas: number | null, precioExtraCentavos: number): Proyeccion {
  if (!Number.isInteger(visitas) || visitas < 0 || !Number.isInteger(dia) || dia < 1 || !Number.isInteger(diasDelMes) || dia > diasDelMes) {
    throw new Error('proyectarMes: valores inválidos');
  }
  const proyectadas = Math.floor((visitas * diasDelMes + dia - 1) / dia);
  const excedente = incluidas === null ? 0 : Math.max(0, proyectadas - incluidas);
  return { visitas_proyectadas: proyectadas, excedente_proyectado: excedente, excedente_proyectado_centavos: excedente * precioExtraCentavos };
}

/** Visitas AUTORIZADAS de una empresa en un mes calendario de Guatemala. Un `id_cliente` repetido cuenta una vez. */
export async function visitasDelMes(db: Consultable, empresaId: string, m: Mes): Promise<number> {
  const sig = mesSiguiente(m);
  const r = await db.query(
    `SELECT COUNT(DISTINCT COALESCE(ra.id_cliente, ra.id))::int AS visitas
       FROM registros_acceso ra
       JOIN sucursales s ON s.id = ra.sucursal_id
      WHERE s.empresa_id = $1
        AND ra.autorizado = TRUE
        AND ra.timestamp_entrada >= make_timestamptz($2::int, $3::int, 1, 0, 0, 0, $6::text)
        AND ra.timestamp_entrada <  make_timestamptz($4::int, $5::int, 1, 0, 0, 0, $6::text)`,
    [empresaId, m.anio, m.mes, sig.anio, sig.mes, APP_TZ],
  );
  return r.rows[0].visitas;
}

/** Visitas de TODAS las empresas en un mes (para la facturación mensual): una sola consulta. */
export async function visitasPorEmpresa(db: Consultable, m: Mes): Promise<Map<string, number>> {
  const sig = mesSiguiente(m);
  const r = await db.query(
    `SELECT s.empresa_id, COUNT(DISTINCT COALESCE(ra.id_cliente, ra.id))::int AS visitas
       FROM registros_acceso ra
       JOIN sucursales s ON s.id = ra.sucursal_id
      WHERE ra.autorizado = TRUE
        AND ra.timestamp_entrada >= make_timestamptz($1::int, $2::int, 1, 0, 0, 0, $5::text)
        AND ra.timestamp_entrada <  make_timestamptz($3::int, $4::int, 1, 0, 0, 0, $5::text)
      GROUP BY s.empresa_id`,
    [m.anio, m.mes, sig.anio, sig.mes, APP_TZ],
  );
  return new Map(r.rows.map((f: { empresa_id: string; visitas: number }) => [f.empresa_id, f.visitas]));
}

export interface UsoDeEmpresa {
  periodo: string;
  visitas: number;
  incluidas: number | null;
  excedente: number;
  /** Lo que costarían los excedentes con el precio del plan, en centavos (entero). */
  excedente_centavos: number;
  plan: string | null;
}

/** Consumo del mes contra lo incluido en el plan (sin plan: solo el conteo). */
export async function usoDeEmpresa(db: Consultable, empresaId: string, m?: Mes): Promise<UsoDeEmpresa> {
  const mes = m ?? await mesActual(db);
  const [visitas, susc] = await Promise.all([visitasDelMes(db, empresaId, mes), suscripcionDe(db, empresaId)]);
  const incluidas = susc?.plan.visitas_incluidas ?? null;
  const excedente = incluidas === null ? 0 : Math.max(0, visitas - incluidas);
  return {
    periodo: periodoTexto(mes), visitas, incluidas, excedente,
    excedente_centavos: susc ? excedente * susc.plan.precio_visita_extra_centavos : 0,
    plan: susc?.plan.codigo ?? null,
  };
}

// ── Límites del plan ─────────────────────────────────────────────────────────────────────────────────────

export type TipoLimite = 'sucursales' | 'garitas';

export async function usoDeLimites(db: Consultable, empresaId: string): Promise<{ sucursales: number; garitas: number }> {
  const r = await db.query(
    `SELECT (SELECT COUNT(*) FROM sucursales WHERE empresa_id = $1 AND activo = TRUE)::int AS sucursales,
            (SELECT COUNT(*) FROM licencias_dispositivo l JOIN sucursales s ON s.id = l.sucursal_id
              WHERE s.empresa_id = $1 AND l.estado = 'activa')::int AS garitas`,
    [empresaId],
  );
  return r.rows[0];
}

export interface Cupo { ok: boolean; usados: number; limite: number | null; plan: string | null }

/**
 * ¿Cabe una sucursal/garita más? Debe llamarse DENTRO de una transacción: toma un candado de la empresa (`pg_advisory_xact_lock`) para que dos
 * altas simultáneas no se pasen del límite. Sin suscripción no hay límites (empresas anteriores a los planes).
 */
export async function reservarCupo(db: Consultable, empresaId: string, tipo: TipoLimite): Promise<Cupo> {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cupo:${empresaId}`]);
  const susc = await suscripcionDe(db, empresaId);
  const usos = await usoDeLimites(db, empresaId);
  const limite = susc ? (tipo === 'sucursales' ? susc.plan.max_sucursales : susc.plan.max_garitas) : null;
  const usados = usos[tipo];
  return { ok: limite === null || usados < limite, usados, limite, plan: susc?.plan.nombre ?? null };
}

export const mensajeLimite = (tipo: TipoLimite, c: Cupo): string =>
  `Tu plan ${c.plan ?? ''} permite hasta ${c.limite} ${tipo === 'sucursales' ? 'sucursales' : 'garitas'} y ya usas ${c.usados}. Pide un plan mayor para agregar más.`.replace('plan  ', 'plan ');
