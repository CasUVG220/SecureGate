import { Request, Response } from 'express';
import pool from '../db/pool';
import { tenantFilter } from '../utils/tenant';
import { serverError } from '../utils/http';

/**
 * Estadísticas agregadas del periodo para la pantalla de Análisis.
 *
 * Todo sale agregado desde la base (conteos y sumas): la respuesta no lleva
 * nombres de visitantes ni DPI, a diferencia de los CSV. Cada consulta aplica
 * el mismo filtro de alcance que el resto de la administración, así que un
 * admin de sucursal sólo ve la suya y uno de empresa, las de su empresa.
 *
 * El periodo anterior es el tramo de la misma longitud que termina justo antes
 * de `desde`: es lo que permite decir "subió un 12 %" en vez de mostrar un
 * número sin referencia.
 */

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;
/** Un año y un día: cubre "este año" y cualquier comparación anual. */
export const MAX_DIAS = 366;
const TOP_CASAS = 8;
const TOP_AREAS = 6;

const ESTADOS_PAGO = ['aprobado', 'pendiente', 'rechazado'] as const;
const ESTADOS_TICKET = ['abierto', 'en_proceso', 'cerrado'] as const;
const ESTADOS_RESERVA = ['pendiente_aprobacion', 'confirmada', 'completada', 'cancelada', 'rechazada'] as const;
/** Reservas que sí ocuparon (u ocuparán) el área: las que cuentan para el ranking. */
const RESERVA_EFECTIVA = new Set(['pendiente_aprobacion', 'confirmada', 'completada']);

/** 'AAAA-MM-DD' → Date a medianoche UTC, o null si no es una fecha real (p. ej. 2026-02-30). */
const parseFecha = (s: unknown): Date | null => {
  if (typeof s !== 'string' || !FECHA_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
};

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const sumarDias = (d: Date, n: number): Date => new Date(d.getTime() + n * DIA_MS);

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Redondeo a centavos: las sumas de DECIMAL llegan como texto y se operan como float. */
const centavos = (n: number): number => Math.round(n * 100) / 100;

/** Rellena con ceros los días sin movimiento para que la serie no tenga huecos. */
const serieDiaria = <K extends string>(
  desde: Date,
  dias: number,
  filas: Array<Record<string, unknown>>,
  campo: K,
): Array<{ fecha: string } & Record<K, number>> => {
  const porFecha = new Map(filas.map(f => [String(f.fecha), num(f[campo])]));
  return Array.from({ length: dias }, (_, i) => {
    const fecha = iso(sumarDias(desde, i));
    return { fecha, [campo]: porFecha.get(fecha) ?? 0 } as { fecha: string } & Record<K, number>;
  });
};

export const getEstadisticas = async (req: Request, res: Response) => {
  const { desde: desdeRaw, hasta: hastaRaw } = req.query as { desde?: string; hasta?: string };
  if (!desdeRaw || !hastaRaw) {
    return res.status(400).json({ error: 'Parámetros desde y hasta requeridos' });
  }
  const desde = parseFecha(desdeRaw);
  const hasta = parseFecha(hastaRaw);
  if (!desde || !hasta) {
    return res.status(400).json({ error: 'desde y hasta deben ser fechas válidas con formato AAAA-MM-DD' });
  }
  if (desde > hasta) {
    return res.status(400).json({ error: '"desde" no puede ser posterior a "hasta"' });
  }
  const dias = Math.round((hasta.getTime() - desde.getTime()) / DIA_MS) + 1;
  if (dias > MAX_DIAS) {
    return res.status(400).json({ error: `El rango máximo es de ${MAX_DIAS} días` });
  }

  const anteriorDesde = sumarDias(desde, -dias);
  const anteriorHasta = sumarDias(desde, -1);
  const user = req.user!;

  /**
   * Filtro de alcance + los parámetros de fecha, numerados a continuación de
   * los del tenant: $d (desde), $h (hasta) y $a (inicio del periodo anterior).
   * `$a` va último y sólo en `conAnterior`: Postgres rechaza una consulta que
   * recibe más parámetros de los que usa.
   */
  const alcance = (alias: string) => {
    const ts = tenantFilter(user, alias);
    const n = ts.params.length;
    const params = [...ts.params, iso(desde), iso(hasta)];
    return {
      join: ts.joinClause,
      where: ts.whereClause,
      d: `$${n + 1}::date`,
      h: `($${n + 2}::date + INTERVAL '1 day')`,
      hDate: `$${n + 2}::date`,
      a: `$${n + 3}::date`,
      params,
      conAnterior: [...params, iso(anteriorDesde)],
    };
  };

  const ra = alcance('ra');
  const p = alcance('p');
  const t = alcance('t');
  const ar = alcance('a');

  // La cartera es una foto del momento, no depende del periodo: sólo lleva
  // los parámetros del tenant.
  const r = tenantFilter(user, 'r');

  // Condiciones de periodo reutilizadas dentro de los FILTER.
  const accActual = `ra.timestamp_entrada >= ${ra.d}`;
  const pagActual = `p.fecha_pago >= ${p.d}`;

  try {
    const [
      accesosResumen, accesosDia, accesosFranja, topCasas,
      pagosResumen, pagosDia,
      cartera, tickets, reservas,
    ] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE ${accActual})::int                                  AS total,
           COUNT(*) FILTER (WHERE ra.timestamp_entrada < ${ra.d})::int               AS total_anterior,
           COUNT(DISTINCT ra.visitante_id) FILTER (WHERE ${accActual})::int          AS visitantes_unicos,
           COUNT(*) FILTER (WHERE ${accActual} AND ra.vehiculo_id IS NOT NULL)::int  AS con_vehiculo,
           COUNT(*) FILTER (WHERE ${accActual} AND ra.timestamp_salida IS NULL)::int AS sin_salida,
           COUNT(*) FILTER (WHERE ${accActual} AND ra.autorizado = FALSE)::int       AS no_autorizados,
           -- Mediana y no promedio: una salida olvidada de tres días no debe
           -- convertir la visita típica de 40 minutos en una de 5 horas.
           PERCENTILE_CONT(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (ra.timestamp_salida - ra.timestamp_entrada)) / 60
           ) FILTER (WHERE ${accActual} AND ra.timestamp_salida > ra.timestamp_entrada) AS duracion_mediana_min
         FROM registros_acceso ra
         ${ra.join}
         WHERE ${ra.where}
           AND ra.timestamp_entrada >= ${ra.a}
           AND ra.timestamp_entrada <  ${ra.h}`,
        ra.conAnterior,
      ),
      pool.query(
        `SELECT CASE WHEN ${accActual} THEN 'actual' ELSE 'anterior' END AS periodo,
                TO_CHAR(DATE(ra.timestamp_entrada), 'YYYY-MM-DD') AS fecha, COUNT(*)::int AS total
         FROM registros_acceso ra
         ${ra.join}
         WHERE ${ra.where}
           AND ra.timestamp_entrada >= ${ra.a}
           AND ra.timestamp_entrada <  ${ra.h}
         GROUP BY 1, 2`,
        ra.conAnterior,
      ),
      pool.query(
        `SELECT EXTRACT(ISODOW FROM ra.timestamp_entrada)::int AS dia,
                EXTRACT(HOUR   FROM ra.timestamp_entrada)::int AS hora,
                COUNT(*)::int AS total
         FROM registros_acceso ra
         ${ra.join}
         WHERE ${ra.where}
           AND ra.timestamp_entrada >= ${ra.d}
           AND ra.timestamp_entrada <  ${ra.h}
         GROUP BY 1, 2`,
        ra.params,
      ),
      pool.query(
        `SELECT res.numero_casa, COUNT(*)::int AS total
         FROM registros_acceso ra
         JOIN residentes res ON res.id = ra.residente_id
         ${ra.join}
         WHERE ${ra.where}
           AND ra.timestamp_entrada >= ${ra.d}
           AND ra.timestamp_entrada <  ${ra.h}
         GROUP BY res.id, res.numero_casa
         ORDER BY total DESC, res.numero_casa
         LIMIT ${TOP_CASAS}`,
        ra.params,
      ),
      // Los cargos de reserva (metodo = 'reserva') son deuda generada, no dinero
      // recibido: se excluyen para no contar dos veces lo que después se paga.
      pool.query(
        `SELECT CASE WHEN ${pagActual} THEN 'actual' ELSE 'anterior' END AS periodo,
                p.estado, p.metodo,
                COUNT(*)::int AS cantidad,
                COALESCE(SUM(p.monto), 0) AS monto
         FROM pagos p
         ${p.join}
         WHERE ${p.where}
           AND p.metodo <> 'reserva'
           AND p.fecha_pago >= ${p.a}
           AND p.fecha_pago <  ${p.h}
         GROUP BY 1, 2, 3`,
        p.conAnterior,
      ),
      pool.query(
        `SELECT CASE WHEN ${pagActual} THEN 'actual' ELSE 'anterior' END AS periodo,
                TO_CHAR(DATE(p.fecha_pago), 'YYYY-MM-DD') AS fecha, COALESCE(SUM(p.monto), 0) AS monto
         FROM pagos p
         ${p.join}
         WHERE ${p.where}
           AND p.metodo <> 'reserva'
           AND p.estado = 'aprobado'
           AND p.fecha_pago >= ${p.a}
           AND p.fecha_pago <  ${p.h}
         GROUP BY 1, 2`,
        p.conAnterior,
      ),
      pool.query(
        `SELECT COUNT(*)::int                                          AS residentes,
                COUNT(*) FILTER (WHERE r.estado_pago = 'al_dia')::int   AS al_dia,
                COUNT(*) FILTER (WHERE r.estado_pago = 'pendiente')::int AS pendiente,
                COUNT(*) FILTER (WHERE r.estado_pago = 'mora')::int     AS mora,
                COALESCE(SUM(r.saldo_pendiente), 0)                     AS saldo_pendiente
         FROM residentes r
         ${r.joinClause}
         WHERE ${r.whereClause}`,
        r.params,
      ),
      pool.query(
        `SELECT t.estado, t.tipo, COUNT(*)::int AS total
         FROM tickets t
         ${t.join}
         WHERE ${t.where}
           AND t.created_at >= ${t.d}
           AND t.created_at <  ${t.h}
         GROUP BY 1, 2`,
        t.params,
      ),
      pool.query(
        `SELECT a.nombre AS area, rs.estado,
                COUNT(*)::int AS total,
                COALESCE(SUM(rs.monto_cargo), 0) AS monto
         FROM reservas_areas rs
         JOIN areas_comunes a ON a.id = rs.area_id
         ${ar.join}
         WHERE ${ar.where}
           AND rs.fecha >= ${ar.d}
           AND rs.fecha <= ${ar.hDate}
         GROUP BY a.id, a.nombre, rs.estado`,
        ar.params,
      ),
    ]);

    // ── Accesos ─────────────────────────────────────────────────────────────
    const acc = accesosResumen.rows[0] ?? {};
    const deAhora = (f: Record<string, unknown>) => f.periodo === 'actual';
    const deAntes = (f: Record<string, unknown>) => f.periodo !== 'actual';
    const mediana = acc.duracion_mediana_min;

    // Matriz 7×24: fila 0 = lunes … 6 = domingo (ISODOW 1-7), columna = hora.
    const porFranja = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    for (const f of accesosFranja.rows) {
      const dia = num(f.dia) - 1;
      const hora = num(f.hora);
      if (dia >= 0 && dia < 7 && hora >= 0 && hora < 24) porFranja[dia][hora] = num(f.total);
    }

    // ── Pagos ───────────────────────────────────────────────────────────────
    const porEstado = Object.fromEntries(ESTADOS_PAGO.map(e => [e, { cantidad: 0, monto: 0 }])) as
      Record<(typeof ESTADOS_PAGO)[number], { cantidad: number; monto: number }>;
    const porMetodo = new Map<string, { cantidad: number; monto: number }>();
    let recaudadoAnterior = 0;
    for (const f of pagosResumen.rows) {
      const estado = String(f.estado) as (typeof ESTADOS_PAGO)[number];
      const monto = num(f.monto);
      const cantidad = num(f.cantidad);
      if (f.periodo === 'anterior') {
        if (estado === 'aprobado') recaudadoAnterior += monto;
        continue;
      }
      if (porEstado[estado]) {
        porEstado[estado].cantidad += cantidad;
        porEstado[estado].monto += monto;
      }
      if (estado === 'aprobado') {
        const m = porMetodo.get(String(f.metodo)) ?? { cantidad: 0, monto: 0 };
        m.cantidad += cantidad;
        m.monto += monto;
        porMetodo.set(String(f.metodo), m);
      }
    }
    for (const e of ESTADOS_PAGO) porEstado[e].monto = centavos(porEstado[e].monto);

    // ── Solicitudes ─────────────────────────────────────────────────────────
    const ticketsEstado = Object.fromEntries(ESTADOS_TICKET.map(e => [e, 0])) as Record<string, number>;
    const ticketsTipo = new Map<string, number>();
    let ticketsTotal = 0;
    for (const f of tickets.rows) {
      const total = num(f.total);
      ticketsTotal += total;
      if (f.estado in ticketsEstado) ticketsEstado[f.estado] += total;
      ticketsTipo.set(String(f.tipo), (ticketsTipo.get(String(f.tipo)) ?? 0) + total);
    }

    // ── Reservas ────────────────────────────────────────────────────────────
    const reservasEstado = Object.fromEntries(ESTADOS_RESERVA.map(e => [e, 0])) as Record<string, number>;
    const reservasArea = new Map<string, number>();
    let reservasTotal = 0;
    let reservasCargos = 0;
    for (const f of reservas.rows) {
      const total = num(f.total);
      reservasTotal += total;
      if (f.estado in reservasEstado) reservasEstado[f.estado] += total;
      if (RESERVA_EFECTIVA.has(f.estado)) {
        reservasArea.set(String(f.area), (reservasArea.get(String(f.area)) ?? 0) + total);
        reservasCargos += num(f.monto);
      }
    }

    const cart = cartera.rows[0] ?? {};

    res.json({
      periodo: {
        desde: iso(desde),
        hasta: iso(hasta),
        dias,
        anterior: { desde: iso(anteriorDesde), hasta: iso(anteriorHasta) },
      },
      accesos: {
        total:                num(acc.total),
        total_anterior:       num(acc.total_anterior),
        visitantes_unicos:    num(acc.visitantes_unicos),
        con_vehiculo:         num(acc.con_vehiculo),
        sin_salida:           num(acc.sin_salida),
        no_autorizados:       num(acc.no_autorizados),
        duracion_mediana_min: mediana == null ? null : Math.round(num(mediana)),
        por_dia:              serieDiaria(desde, dias, accesosDia.rows.filter(deAhora), 'total'),
        // Alineada por posición con por_dia (día 1 contra día 1): es la línea
        // de comparación del gráfico.
        por_dia_anterior:     serieDiaria(anteriorDesde, dias, accesosDia.rows.filter(deAntes), 'total').map(d => d.total),
        por_franja:           porFranja,
        top_casas:            topCasas.rows.map(f => ({ numero_casa: String(f.numero_casa), total: num(f.total) })),
      },
      pagos: {
        recaudado:          porEstado.aprobado.monto,
        recaudado_anterior: centavos(recaudadoAnterior),
        por_estado:         porEstado,
        por_metodo:         [...porMetodo.entries()]
          .map(([metodo, v]) => ({ metodo, cantidad: v.cantidad, monto: centavos(v.monto) }))
          .sort((x, y) => y.monto - x.monto),
        por_dia:            serieDiaria(desde, dias, pagosDia.rows.filter(deAhora), 'monto')
          .map(d => ({ ...d, monto: centavos(d.monto) })),
        por_dia_anterior:   serieDiaria(anteriorDesde, dias, pagosDia.rows.filter(deAntes), 'monto').map(d => centavos(d.monto)),
      },
      cartera: {
        residentes:      num(cart.residentes),
        al_dia:          num(cart.al_dia),
        pendiente:       num(cart.pendiente),
        mora:            num(cart.mora),
        saldo_pendiente: centavos(num(cart.saldo_pendiente)),
      },
      solicitudes: {
        total:      ticketsTotal,
        por_estado: ticketsEstado,
        por_tipo:   [...ticketsTipo.entries()]
          .map(([tipo, total]) => ({ tipo, total }))
          .sort((x, y) => y.total - x.total),
      },
      reservas: {
        total:      reservasTotal,
        por_estado: reservasEstado,
        // Lo cargado por reservas efectivas; se cobra aparte, como un pago.
        cargos:     centavos(reservasCargos),
        top_areas:  [...reservasArea.entries()]
          .map(([area, total]) => ({ area, total }))
          .sort((x, y) => y.total - x.total || x.area.localeCompare(y.area))
          .slice(0, TOP_AREAS),
      },
    });
  } catch (error) {
    serverError(res, error, 'Error al calcular estadísticas');
  }
};
