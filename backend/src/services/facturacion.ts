/**
 * Facturación interna mensual de SecureGate a las empresas (T11).
 *
 * Cada mes, por cada empresa con suscripción, se genera UNA factura (`facturas_saas`, única por empresa y periodo) con la cuota del plan y las
 * visitas excedentes del mes calendario de America/Guatemala. Es un control de cobro interno: no es un documento tributario.
 *
 * Reglas (todas con ejemplos en `docs/saas_nucleo.md` y en las pruebas):
 *  - Se factura el mes ya CERRADO. El job mensual corre el día 1 y factura el mes anterior; pedir un mes que no terminó es un error.
 *  - Mes parcial: se cobran los días en que la suscripción estuvo corriendo. Empieza el día que termina la prueba (o el día del alta, si no hubo
 *    prueba) y, si se canceló, termina el día de la cancelación (inclusive). Cuota = round(cuota × días facturados / días del mes), en enteros.
 *    Las visitas incluidas se prorratean igual (hacia arriba, a favor del cliente) y solo se cuentan las visitas de esos días.
 *  - Se factura con el plan vigente al generar la factura (un cambio de plan a mitad de mes aplica a todo el mes: simplificación documentada).
 *  - Una factura de Q0.00 no se genera. Estado de la suscripción no decide si se cobra; deciden las fechas.
 *  - Dinero: centavos enteros siempre; ningún número con decimales entra ni sale de los cálculos.
 *  - NO se suspende ninguna empresa por falta de pago (decisión y motivos en `docs/saas_nucleo.md`).
 */
import { APP_TZ } from '../utils/reservas';
import { enviarEmail } from './email';
import type { ConfirmacionPago, ProveedorCobro } from './cobros';
import { mesActual, mesSiguiente, periodoTexto, suscripcionDe, VISITA_SQL, type Consultable, type Mes, type Suscripcion } from './suscripciones';

export type Cliente = Consultable & { release(): void };
export type PoolLike = Consultable & { connect(): Promise<Cliente> };

export class MesNoCerradoError extends Error {
  constructor(public readonly periodo: string) {
    super(`El mes ${periodo} todavía no termina: solo se factura un mes cerrado`);
    this.name = 'MesNoCerradoError';
  }
}
export class FacturaNoEncontradaError extends Error {
  constructor() { super('Factura no encontrada'); this.name = 'FacturaNoEncontradaError'; }
}
export class EstadoFacturaError extends Error {
  constructor(mensaje: string) { super(mensaje); this.name = 'EstadoFacturaError'; }
}

// ── Configuración ────────────────────────────────────────────────────────────────────────────────────────

export interface ConfigFacturacion {
  /** Días que tiene la empresa para pagar desde que se emite la factura. */
  diasPago: number;
  /** Días de gracia DESPUÉS del vencimiento antes de mandar el aviso de pago vencido. */
  diasGracia: number;
}

const enteroDeEntorno = (nombre: string, defecto: number, min: number, max: number): number => {
  const bruto = process.env[nombre];
  if (bruto === undefined || bruto.trim() === '') return defecto;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < min || n > max) {
    console.warn(`[facturacion] ${nombre}="${bruto}" no es un entero entre ${min} y ${max}; se usa ${defecto}`);
    return defecto;
  }
  return n;
};

/** `SAAS_DIAS_PAGO` (por defecto 10) y `SAAS_DIAS_GRACIA` (por defecto 5). */
export const configFacturacion = (): ConfigFacturacion => ({
  diasPago: enteroDeEntorno('SAAS_DIAS_PAGO', 10, 1, 90),
  diasGracia: enteroDeEntorno('SAAS_DIAS_GRACIA', 5, 0, 90),
});

// ── Utilidades de fecha y dinero (puras) ─────────────────────────────────────────────────────────────────

/** Fecha calendario (AAAA-MM-DD) de un instante en la zona de la app. */
export function fechaEnGuatemala(d: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
}

export const diasDelMes = (m: Mes): number => new Date(Date.UTC(m.anio, m.mes, 0)).getUTCDate();

export const mesAnterior = (m: Mes): Mes => (m.mes === 1 ? { anio: m.anio - 1, mes: 12 } : { anio: m.anio, mes: m.mes - 1 });

/** Suma días a una fecha AAAA-MM-DD sin pasar por la zona horaria del servidor. */
export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

const diasEntre = (desde: string, hasta: string): number => {
  const t = (f: string) => { const [a, m, d] = f.split('-').map(Number); return Date.UTC(a, m - 1, d); };
  return Math.round((t(hasta) - t(desde)) / 86_400_000);
};

/** 123456 → «Q1,234.56» (quetzal pegado a la cifra, dos decimales: docs/glosario.md). */
export function dinero(centavos: number): string {
  const signo = centavos < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(centavos));
  const enteros = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${signo}Q${enteros}.${String(abs % 100).padStart(2, '0')}`;
}

export const numeroTexto = (n: number): string => `SG-${String(n).padStart(6, '0')}`;

const fechaCorta = (f: string): string => { const [a, m, d] = f.split('-'); return `${d}/${m}/${a}`; };

// ── Cálculo (puro) ───────────────────────────────────────────────────────────────────────────────────────

export interface VentanaCobro {
  /** Primer día cobrado (AAAA-MM-DD, inclusive). */
  desde: string;
  /** Último día cobrado (inclusive). */
  hasta: string;
  dias: number;
}

type FechaSuscripcion = Date | string | null;
export interface FechasDeSuscripcion {
  inicio_en: FechaSuscripcion;
  prueba_hasta: FechaSuscripcion;
  cancelada_en: FechaSuscripcion;
}

/** Los días de `m` en que la suscripción estuvo corriendo y se cobran, o `null` si ninguno. */
export function ventanaDeCobro(m: Mes, s: FechasDeSuscripcion): VentanaCobro | null {
  const primero = `${periodoTexto(m)}-01`;
  const ultimo = `${periodoTexto(m)}-${String(diasDelMes(m)).padStart(2, '0')}`;
  const inicioCobro = fechaEnGuatemala((s.prueba_hasta ?? s.inicio_en) as Date | string);
  const desde = inicioCobro > primero ? inicioCobro : primero;
  const fin = s.cancelada_en ? fechaEnGuatemala(s.cancelada_en) : ultimo;
  const hasta = fin < ultimo ? fin : ultimo;
  if (desde > hasta) return null;
  return { desde, hasta, dias: diasEntre(desde, hasta) + 1 };
}

export interface PlanParaCalculo {
  codigo: string;
  nombre: string;
  precio_mensual_centavos: number;
  visitas_incluidas: number;
  precio_visita_extra_centavos: number;
}

export interface LineaFactura {
  concepto: string;
  cantidad: number;
  precio_unitario_centavos: number;
  monto_centavos: number;
}

export interface CalculoFactura {
  cuota_centavos: number;
  visitas: number;
  visitas_incluidas: number;
  excedente_visitas: number;
  excedente_centavos: number;
  total_centavos: number;
  dias_del_mes: number;
  dias_facturados: number;
  parcial: boolean;
  lineas: LineaFactura[];
}

/**
 * Cuota + excedente de un mes, todo en enteros. Mes completo: cuota del plan tal cual. Mes parcial: cuota prorrateada por días
 * (redondeo al centavo más cercano, mitades hacia arriba) y visitas incluidas prorrateadas hacia arriba.
 */
export function calcularFactura(plan: PlanParaCalculo, diasMes: number, diasFacturados: number, visitas: number): CalculoFactura {
  for (const [n, v] of Object.entries({ precio: plan.precio_mensual_centavos, incluidas: plan.visitas_incluidas, extra: plan.precio_visita_extra_centavos, visitas })) {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`calcularFactura: ${n} debe ser un entero >= 0`);
  }
  if (!Number.isInteger(diasMes) || !Number.isInteger(diasFacturados) || diasFacturados < 1 || diasFacturados > diasMes) {
    throw new Error('calcularFactura: días inválidos');
  }
  const parcial = diasFacturados < diasMes;
  const cuota = parcial ? Math.floor((plan.precio_mensual_centavos * diasFacturados * 2 + diasMes) / (diasMes * 2)) : plan.precio_mensual_centavos;
  const incluidas = parcial ? Math.floor((plan.visitas_incluidas * diasFacturados + diasMes - 1) / diasMes) : plan.visitas_incluidas;
  const excedente = Math.max(0, visitas - incluidas);
  const excedenteCentavos = excedente * plan.precio_visita_extra_centavos;

  const lineas: LineaFactura[] = [{
    concepto: parcial ? `Cuota del plan ${plan.nombre} (${diasFacturados} de ${diasMes} días)` : `Cuota del plan ${plan.nombre}`,
    cantidad: 1, precio_unitario_centavos: plan.precio_mensual_centavos, monto_centavos: cuota,
  }];
  if (excedente > 0) {
    lineas.push({
      concepto: `Visitas adicionales (${visitas} registradas, ${incluidas} incluidas)`,
      cantidad: excedente, precio_unitario_centavos: plan.precio_visita_extra_centavos, monto_centavos: excedenteCentavos,
    });
  }
  return {
    cuota_centavos: cuota, visitas, visitas_incluidas: incluidas, excedente_visitas: excedente, excedente_centavos: excedenteCentavos,
    total_centavos: cuota + excedenteCentavos, dias_del_mes: diasMes, dias_facturados: diasFacturados, parcial, lineas,
  };
}

// ── Generación ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Visitas autorizadas de la empresa entre dos días de Guatemala (inclusive), sin duplicados por `id_cliente`. Solo de visitantes: las
 * entradas de residentes (ANPR) no se facturan (`VISITA_SQL`).
 */
export async function visitasEnRango(db: Consultable, empresaId: string, desde: string, hasta: string): Promise<number> {
  const r = await db.query(
    `SELECT COUNT(DISTINCT COALESCE(ra.id_cliente, ra.id))::int AS visitas
       FROM registros_acceso ra
       JOIN sucursales s ON s.id = ra.sucursal_id
      WHERE s.empresa_id = $1 AND ${VISITA_SQL}
        AND ra.timestamp_entrada >= ($2::date)::timestamp AT TIME ZONE $4::text
        AND ra.timestamp_entrada <  ($3::date + 1)::timestamp AT TIME ZONE $4::text`,
    [empresaId, desde, hasta, APP_TZ],
  );
  return r.rows[0].visitas;
}

export type ResultadoEmpresa = 'generada' | 'existente' | 'sin_cobro';

/** Genera (si corresponde) la factura de una empresa y un mes. Debe llamarse dentro de BEGIN…COMMIT. Idempotente. */
export async function generarFacturaDeEmpresa(
  db: Consultable, empresaId: string, mes: Mes, hoy: string, cfg: ConfigFacturacion,
): Promise<{ resultado: ResultadoEmpresa; total_centavos: number }> {
  const periodo = periodoTexto(mes);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`factura:${empresaId}:${periodo}`]);

  const previa = await db.query('SELECT 1 FROM facturas_saas WHERE empresa_id = $1 AND periodo = $2', [empresaId, periodo]);
  if (previa.rows.length > 0) return { resultado: 'existente', total_centavos: 0 };

  const susc: Suscripcion | null = await suscripcionDe(db, empresaId);
  if (!susc) return { resultado: 'sin_cobro', total_centavos: 0 };
  const ventana = ventanaDeCobro(mes, susc);
  if (!ventana) return { resultado: 'sin_cobro', total_centavos: 0 };

  const visitas = await visitasEnRango(db, empresaId, ventana.desde, ventana.hasta);
  const calculo = calcularFactura(susc.plan, diasDelMes(mes), ventana.dias, visitas);
  if (calculo.total_centavos === 0) return { resultado: 'sin_cobro', total_centavos: 0 };

  const contador = await db.query(`UPDATE saas_contadores SET valor = valor + 1 WHERE clave = 'factura_saas' RETURNING valor::float8 AS valor`);
  const numero: number = contador.rows[0].valor;
  const detalle = { periodo, ventana: { desde: ventana.desde, hasta: ventana.hasta }, lineas: calculo.lineas };
  const ins = await db.query(
    `INSERT INTO facturas_saas
       (numero, empresa_id, suscripcion_id, periodo, plan_codigo, plan_nombre, dias_del_mes, dias_facturados, cuota_centavos,
        visitas, visitas_incluidas, excedente_visitas, precio_visita_extra_centavos, excedente_centavos, total_centavos, moneda, detalle, vence_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::date)
     ON CONFLICT (empresa_id, periodo) DO NOTHING
     RETURNING id`,
    [numero, empresaId, susc.id, periodo, susc.plan.codigo, susc.plan.nombre, calculo.dias_del_mes, calculo.dias_facturados, calculo.cuota_centavos,
      calculo.visitas, calculo.visitas_incluidas, calculo.excedente_visitas, susc.plan.precio_visita_extra_centavos, calculo.excedente_centavos,
      calculo.total_centavos, susc.plan.moneda, JSON.stringify(detalle), sumarDias(hoy, cfg.diasPago)],
  );
  if (ins.rows.length === 0) return { resultado: 'existente', total_centavos: 0 };
  return { resultado: 'generada', total_centavos: calculo.total_centavos };
}

export interface ResumenGeneracion {
  periodo: string;
  generadas: number;
  existentes: number;
  sin_cobro: number;
  errores: number;
  total_centavos: number;
}

/**
 * Genera las facturas de un mes cerrado para todas las empresas con suscripción (por defecto, el mes anterior de Guatemala).
 * Cada empresa va en su propia transacción: una empresa con problemas no frena a las demás. Volver a correrlo no duplica nada.
 */
export async function generarFacturasMensuales(pool: PoolLike, opts: { mes?: Mes } = {}): Promise<ResumenGeneracion> {
  const actual = await mesActual(pool);
  const mes = opts.mes ?? mesAnterior(actual);
  const sigue = mesSiguiente(mes);
  if (sigue.anio > actual.anio || (sigue.anio === actual.anio && sigue.mes > actual.mes)) throw new MesNoCerradoError(periodoTexto(mes));

  const cfg = configFacturacion();
  const hoy = fechaEnGuatemala(new Date());
  const empresas = await pool.query(`SELECT empresa_id FROM suscripciones ORDER BY created_at, id`);
  const resumen: ResumenGeneracion = { periodo: periodoTexto(mes), generadas: 0, existentes: 0, sin_cobro: 0, errores: 0, total_centavos: 0 };

  const client = await pool.connect();
  try {
    for (const { empresa_id } of empresas.rows as Array<{ empresa_id: string }>) {
      try {
        await client.query('BEGIN');
        const r = await generarFacturaDeEmpresa(client, empresa_id, mes, hoy, cfg);
        await client.query('COMMIT');
        if (r.resultado === 'generada') { resumen.generadas++; resumen.total_centavos += r.total_centavos; }
        else if (r.resultado === 'existente') resumen.existentes++;
        else resumen.sin_cobro++;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        resumen.errores++;
        console.error(`[facturacion] No se pudo facturar a la empresa ${empresa_id} (${resumen.periodo}):`, (error as Error).message);
      }
    }
  } finally {
    client.release();
  }
  return resumen;
}

// ── Vencimientos y avisos ────────────────────────────────────────────────────────────────────────────────

/** Las facturas pendientes cuya fecha de pago ya pasó (hora de Guatemala) pasan a «vencida». Devuelve cuántas. */
export async function marcarVencidas(db: Consultable): Promise<number> {
  const r = await db.query(
    `UPDATE facturas_saas SET estado = 'vencida', updated_at = NOW()
      WHERE estado = 'pendiente' AND vence_en < (NOW() AT TIME ZONE $1::text)::date
      RETURNING id`,
    [APP_TZ],
  );
  return r.rowCount ?? 0;
}

export interface ResumenAvisos {
  emitidas: number;
  vencidas: number;
  sin_destinatarios: number;
  errores: number;
}

interface FacturaParaAviso {
  id: string; numero: number; periodo: string; total_centavos: number; vence_en: string; empresa_id: string; empresa_nombre: string;
}

/**
 * Manda por correo (hoy el transporte `log`) el aviso de factura emitida y, pasada la gracia, el de pago vencido a los administradores de la
 * empresa. Un aviso por factura y tipo (UNIQUE): correr el job dos veces no manda dos correos. Si no hay a quién avisar NO se marca como enviado.
 */
export async function enviarAvisos(db: Consultable, cfg: ConfigFacturacion = configFacturacion()): Promise<ResumenAvisos> {
  const resumen: ResumenAvisos = { emitidas: 0, vencidas: 0, sin_destinatarios: 0, errores: 0 };
  const columnas = `f.id, f.numero::float8 AS numero, f.periodo, f.total_centavos::float8 AS total_centavos,
                    to_char(f.vence_en, 'YYYY-MM-DD') AS vence_en, f.empresa_id, e.nombre AS empresa_nombre`;
  const emitidas = await db.query(
    `SELECT ${columnas} FROM facturas_saas f JOIN empresas e ON e.id = f.empresa_id
      WHERE f.estado IN ('pendiente', 'vencida')
        AND NOT EXISTS (SELECT 1 FROM facturas_saas_avisos a WHERE a.factura_id = f.id AND a.tipo = 'emitida')
      ORDER BY f.numero`,
  );
  const vencidas = await db.query(
    `SELECT ${columnas} FROM facturas_saas f JOIN empresas e ON e.id = f.empresa_id
      WHERE f.estado = 'vencida'
        AND f.vence_en + $2::int < (NOW() AT TIME ZONE $1::text)::date
        AND NOT EXISTS (SELECT 1 FROM facturas_saas_avisos a WHERE a.factura_id = f.id AND a.tipo = 'vencida')
      ORDER BY f.numero`,
    [APP_TZ, cfg.diasGracia],
  );

  const avisar = async (f: FacturaParaAviso, tipo: 'emitida' | 'vencida') => {
    const dest = await db.query(
      `SELECT email FROM usuarios WHERE rol = 'admin_empresa' AND empresa_id = $1 AND activo = TRUE AND email IS NOT NULL ORDER BY email`,
      [f.empresa_id],
    );
    const correos = (dest.rows as Array<{ email: string }>).map(r => r.email);
    if (correos.length === 0) { resumen.sin_destinatarios++; return; }

    // Se reserva el aviso ANTES de mandar: dos réplicas del job no pueden mandar el mismo correo. Si falla todo el envío, se libera para reintentar.
    const reserva = await db.query(
      `INSERT INTO facturas_saas_avisos (factura_id, tipo, destinatarios) VALUES ($1, $2, $3) ON CONFLICT (factura_id, tipo) DO NOTHING RETURNING id`,
      [f.id, tipo, correos.length],
    );
    if (reserva.rows.length === 0) return;

    const asunto = tipo === 'emitida'
      ? `Factura ${numeroTexto(f.numero)} de SecureGate (${f.periodo})`
      : `Pago vencido: factura ${numeroTexto(f.numero)} de SecureGate`;
    const texto = tipo === 'emitida'
      ? `Hola,\n\nSe emitió la factura ${numeroTexto(f.numero)} de ${f.empresa_nombre} por el servicio SecureGate de ${f.periodo}, por ${dinero(f.total_centavos)}.\n` +
        `Fecha límite de pago: ${fechaCorta(f.vence_en)}.\n\nPuedes ver el detalle en tu panel. Si ya pagaste, responde con tu número de boleta.\n`
      : `Hola,\n\nLa factura ${numeroTexto(f.numero)} de ${f.empresa_nombre} por ${dinero(f.total_centavos)} venció el ${fechaCorta(f.vence_en)} y todavía no tenemos tu pago.\n` +
        `Tu servicio sigue funcionando. Por favor regulariza el pago o escríbenos si ya lo hiciste.\n`;
    let enviados = 0;
    for (const to of correos) {
      try { await enviarEmail({ to, subject: asunto, text: texto }); enviados++; } catch (error) {
        resumen.errores++;
        console.error(`[facturacion] No se pudo avisar a ${to}:`, (error as Error).message);
      }
    }
    if (enviados === 0) {
      await db.query('DELETE FROM facturas_saas_avisos WHERE id = $1', [reserva.rows[0].id]);
      return;
    }
    if (tipo === 'emitida') resumen.emitidas++; else resumen.vencidas++;
  };

  for (const f of emitidas.rows as FacturaParaAviso[]) await avisar(f, 'emitida');
  for (const f of vencidas.rows as FacturaParaAviso[]) await avisar(f, 'vencida');
  return resumen;
}

/** Lo que corre el día 1: genera las facturas del mes anterior y avisa. */
export async function ejecutarFacturacionMensual(pool: PoolLike): Promise<ResumenGeneracion & { avisos: ResumenAvisos }> {
  const generacion = await generarFacturasMensuales(pool);
  return { ...generacion, avisos: await enviarAvisos(pool) };
}

/** Lo que corre cada día: marca las vencidas y manda los avisos que toquen. */
export async function revisarVencimientos(pool: PoolLike): Promise<{ vencidas: number; avisos: ResumenAvisos }> {
  const vencidas = await marcarVencidas(pool);
  return { vencidas, avisos: await enviarAvisos(pool) };
}

// ── Consulta y cambios de estado ─────────────────────────────────────────────────────────────────────────

const COLUMNAS_FACTURA = `f.id, f.numero::float8 AS numero, f.empresa_id, e.nombre AS empresa_nombre, f.periodo, f.plan_codigo, f.plan_nombre,
  f.dias_del_mes, f.dias_facturados, f.cuota_centavos::float8 AS cuota_centavos, f.visitas, f.visitas_incluidas, f.excedente_visitas,
  f.precio_visita_extra_centavos::float8 AS precio_visita_extra_centavos, f.excedente_centavos::float8 AS excedente_centavos,
  f.total_centavos::float8 AS total_centavos, f.moneda, f.detalle, f.estado, f.emitida_en, to_char(f.vence_en, 'YYYY-MM-DD') AS vence_en,
  f.pagada_en, f.metodo_pago, f.referencia_pago, f.nota_pago, f.proveedor_cobro, f.anulada_en, f.anulada_motivo`;

export interface Factura {
  id: string; numero: number; numero_texto: string; empresa_id: string; empresa_nombre: string; periodo: string; estado: 'pendiente' | 'pagada' | 'vencida' | 'anulada';
  total_centavos: number; vence_en: string; [campo: string]: unknown;
}

const conNumeroTexto = (f: Record<string, unknown> & { numero: number }): Factura => ({ ...f, numero_texto: numeroTexto(f.numero) } as Factura);

export async function facturaPorId(db: Consultable, id: string, empresaId?: string): Promise<Factura | null> {
  const r = await db.query(
    `SELECT ${COLUMNAS_FACTURA} FROM facturas_saas f JOIN empresas e ON e.id = f.empresa_id WHERE f.id = $1 AND ($2::uuid IS NULL OR f.empresa_id = $2::uuid)`,
    [id, empresaId ?? null],
  );
  return r.rows[0] ? conNumeroTexto(r.rows[0]) : null;
}

export async function listarFacturas(
  db: Consultable, filtro: { empresaId?: string; estado?: string; periodo?: string; limite?: number },
): Promise<Factura[]> {
  const r = await db.query(
    `SELECT ${COLUMNAS_FACTURA} FROM facturas_saas f JOIN empresas e ON e.id = f.empresa_id
      WHERE ($1::uuid IS NULL OR f.empresa_id = $1::uuid) AND ($2::text IS NULL OR f.estado = $2::text) AND ($3::text IS NULL OR f.periodo = $3::text)
      ORDER BY f.periodo DESC, f.numero DESC LIMIT $4::int`,
    [filtro.empresaId ?? null, filtro.estado ?? null, filtro.periodo ?? null, Math.min(filtro.limite ?? 100, 500)],
  );
  return r.rows.map(conNumeroTexto);
}

/** Marca una factura como pagada vía el proveedor de cobro. Dentro de BEGIN…COMMIT. */
export async function pagarFactura(
  db: Consultable, id: string, confirmacion: ConfirmacionPago, proveedor: ProveedorCobro, usuarioId: string,
): Promise<Factura> {
  const f = await db.query(
    `SELECT id, numero::float8 AS numero, empresa_id, total_centavos::float8 AS total_centavos, moneda, estado FROM facturas_saas WHERE id = $1 FOR UPDATE`, [id]);
  if (f.rows.length === 0) throw new FacturaNoEncontradaError();
  const fila = f.rows[0];
  if (fila.estado === 'pagada') throw new EstadoFacturaError('La factura ya está pagada');
  if (fila.estado === 'anulada') throw new EstadoFacturaError('La factura está anulada: no se puede pagar');

  const cobro = await proveedor.confirmarPago(
    { facturaId: fila.id, numero: fila.numero, empresaId: fila.empresa_id, totalCentavos: fila.total_centavos, moneda: fila.moneda }, confirmacion);
  await db.query(
    `UPDATE facturas_saas SET estado = 'pagada', pagada_en = NOW(), metodo_pago = $2, referencia_pago = $3, nota_pago = $4, proveedor_cobro = $5,
            marcada_por = $6, updated_at = NOW() WHERE id = $1`,
    [id, cobro.metodo, cobro.referencia, cobro.nota, proveedor.nombre, usuarioId],
  );
  return (await facturaPorId(db, id))!;
}

/** Anula una factura pendiente o vencida (error de generación, acuerdo comercial). La del mes NO se vuelve a generar. Dentro de BEGIN…COMMIT. */
export async function anularFactura(db: Consultable, id: string, motivo: string): Promise<Factura> {
  const f = await db.query(`SELECT estado FROM facturas_saas WHERE id = $1 FOR UPDATE`, [id]);
  if (f.rows.length === 0) throw new FacturaNoEncontradaError();
  if (f.rows[0].estado === 'pagada') throw new EstadoFacturaError('Una factura pagada no se anula');
  if (f.rows[0].estado === 'anulada') throw new EstadoFacturaError('La factura ya está anulada');
  await db.query(`UPDATE facturas_saas SET estado = 'anulada', anulada_en = NOW(), anulada_motivo = $2, updated_at = NOW() WHERE id = $1`, [id, motivo]);
  return (await facturaPorId(db, id))!;
}
