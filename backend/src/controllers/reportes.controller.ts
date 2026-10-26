import { Request, Response } from 'express';
import pool from '../db/pool';
import { tenantFilter } from '../utils/tenant';
import { serverError } from '../utils/http';
import { JOINS_ACCESO, METODO_SQL, METODO_TEXTO, type MetodoAcceso } from '../utils/accesos';

/**
 * Escapa una celda CSV y neutraliza la "inyección de fórmulas": un visitante
 * registrado como `=HYPERLINK(...)` o `@SUM(...)` se ejecutaría al abrir el
 * archivo en Excel/Sheets. Las celdas de texto que empiezan con = + - @ (o
 * tab/retorno) se prefijan con una comilla simple, que las vuelve texto.
 * Los números negativos legítimos (monto) se dejan tal cual.
 */
const escapeCSV = (value: unknown): string => {
  let str = value == null ? '' : String(value);
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

const toRow = (fields: unknown[]): string => fields.map(escapeCSV).join(',');

export const reporteAccesos = async (req: Request, res: Response) => {
  const { desde, hasta } = req.query as { desde?: string; hasta?: string };
  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Parámetros desde y hasta requeridos' });
  }
  if (!FECHA_RE.test(desde) || !FECHA_RE.test(hasta)) {
    return res.status(400).json({ error: 'desde y hasta deben tener el formato AAAA-MM-DD' });
  }

  const ts = tenantFilter(req.user!, 'ra');
  const desdeOffset = ts.params.length + 1;
  const hastaOffset = ts.params.length + 2;

  try {
    const result = await pool.query(
      `SELECT
         DATE(ra.timestamp_entrada)                   AS fecha,
         TO_CHAR(ra.timestamp_entrada, 'HH24:MI:SS') AS hora_entrada,
         TO_CHAR(ra.timestamp_salida,  'HH24:MI:SS') AS hora_salida,
         v.nombre                                     AS nombre_visitante,
         v.numero_dpi,
         COALESCE(vr.placa, ve.placa)                 AS placa,
         r.numero_casa,
         CASE WHEN ca.id IS NOT NULL THEN 'Sí' ELSE 'No' END AS cargo_generado,
         (${METODO_SQL})                              AS metodo,
         CASE WHEN ra.visitante_id IS NULL THEN 'Residente' ELSE 'Visitante' END AS persona,
         ur.nombre                                    AS residente_nombre,
         CASE WHEN ra.verificado_por IS NOT NULL THEN 'Sí' ELSE 'No' END AS verificado_por_agente,
         ra.confianza::float8                         AS confianza
       FROM registros_acceso ra
       ${JOINS_ACCESO}
       LEFT JOIN cargos_automaticos ca ON ca.registro_acceso_id = ra.id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
         AND ra.timestamp_entrada >= $${desdeOffset}::date
         AND ra.timestamp_entrada <  $${hastaOffset}::date + INTERVAL '1 day'
       ORDER BY ra.timestamp_entrada DESC`,
      [...ts.params, desde, hasta]
    );

    // Las columnas nuevas (Sprint 10) van al final para no mover las que ya leen otras hojas de cálculo.
    const headers = [
      'fecha', 'hora_entrada', 'hora_salida',
      'nombre_visitante', 'numero_dpi', 'placa',
      'numero_casa', 'cargo_generado',
      'metodo', 'persona', 'residente', 'verificado_por_agente', 'confianza',
    ];
    const lines = [
      headers.join(','),
      ...result.rows.map(row =>
        toRow([
          row.fecha, row.hora_entrada, row.hora_salida,
          row.nombre_visitante, row.numero_dpi, row.placa,
          row.numero_casa, row.cargo_generado,
          METODO_TEXTO[row.metodo as MetodoAcceso] ?? row.metodo, row.persona, row.residente_nombre, row.verificado_por_agente,
          row.confianza == null ? null : Number(row.confianza).toFixed(2),
        ])
      ),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="accesos_${desde}_${hasta}.csv"`);
    res.send(lines.join('\n'));
  } catch (error) {
    serverError(res, error, 'Error al generar reporte de accesos');
  }
};

export const reportePagos = async (req: Request, res: Response) => {
  const { desde, hasta } = req.query as { desde?: string; hasta?: string };
  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Parámetros desde y hasta requeridos' });
  }
  if (!FECHA_RE.test(desde) || !FECHA_RE.test(hasta)) {
    return res.status(400).json({ error: 'desde y hasta deben tener el formato AAAA-MM-DD' });
  }

  const ts = tenantFilter(req.user!, 'p');
  const desdeOffset = ts.params.length + 1;
  const hastaOffset = ts.params.length + 2;
  const rechazadosOffset = ts.params.length + 3;
  // Un pago rechazado no es un ingreso: fuera del reporte salvo que se pidan expresamente.
  const incluirRechazados = req.query.incluir_rechazados === '1';

  try {
    const result = await pool.query(
      `SELECT
         DATE(p.fecha_pago) AS fecha,
         r.numero_casa,
         p.monto,
         p.metodo,
         p.estado
       FROM pagos p
       JOIN residentes r ON p.residente_id = r.id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
         AND p.fecha_pago >= $${desdeOffset}::date
         AND p.fecha_pago <  $${hastaOffset}::date + INTERVAL '1 day'
         AND ($${rechazadosOffset}::boolean OR p.estado <> 'rechazado')
       ORDER BY p.fecha_pago DESC`,
      [...ts.params, desde, hasta, incluirRechazados]
    );

    const headers = ['fecha', 'numero_casa', 'monto', 'metodo', 'estado'];
    const lines = [
      headers.join(','),
      ...result.rows.map(row =>
        toRow([row.fecha, row.numero_casa, row.monto, row.metodo, row.estado])
      ),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pagos_${desde}_${hasta}.csv"`);
    res.send(lines.join('\n'));
  } catch (error) {
    serverError(res, error, 'Error al generar reporte de pagos');
  }
};
