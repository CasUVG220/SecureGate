import { Request, Response } from 'express';
import pool from '../db/pool';

const escapeCSV = (value: unknown): string => {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const toRow = (fields: unknown[]): string => fields.map(escapeCSV).join(',');

export const reporteAccesos = async (req: Request, res: Response) => {
  const { desde, hasta } = req.query as { desde?: string; hasta?: string };
  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Parámetros desde y hasta requeridos' });
  }

  try {
    const result = await pool.query(
      `SELECT
         DATE(ra.timestamp_entrada)                   AS fecha,
         TO_CHAR(ra.timestamp_entrada, 'HH24:MI:SS') AS hora_entrada,
         TO_CHAR(ra.timestamp_salida,  'HH24:MI:SS') AS hora_salida,
         v.nombre                                     AS nombre_visitante,
         v.numero_dpi,
         ve.placa,
         r.numero_casa,
         CASE WHEN ca.id IS NOT NULL THEN 'Sí' ELSE 'No' END AS cargo_generado
       FROM registros_acceso ra
       JOIN  visitantes v           ON ra.visitante_id       = v.id
       JOIN  residentes r           ON ra.residente_id       = r.id
       LEFT JOIN vehiculos ve       ON ra.vehiculo_id        = ve.id
       LEFT JOIN cargos_automaticos ca ON ca.registro_acceso_id = ra.id
       WHERE ra.timestamp_entrada >= $1::date
         AND ra.timestamp_entrada <  $2::date + INTERVAL '1 day'
       ORDER BY ra.timestamp_entrada DESC`,
      [desde, hasta]
    );

    const headers = [
      'fecha', 'hora_entrada', 'hora_salida',
      'nombre_visitante', 'numero_dpi', 'placa',
      'numero_casa', 'cargo_generado',
    ];
    const lines = [
      headers.join(','),
      ...result.rows.map(row =>
        toRow([
          row.fecha, row.hora_entrada, row.hora_salida,
          row.nombre_visitante, row.numero_dpi, row.placa,
          row.numero_casa, row.cargo_generado,
        ])
      ),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="accesos_${desde}_${hasta}.csv"`);
    res.send(lines.join('\n'));
  } catch (error) {
    res.status(500).json({ error: 'Error al generar reporte de accesos', detail: String(error) });
  }
};

export const reportePagos = async (req: Request, res: Response) => {
  const { desde, hasta } = req.query as { desde?: string; hasta?: string };
  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Parámetros desde y hasta requeridos' });
  }

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
       WHERE p.fecha_pago >= $1::date
         AND p.fecha_pago <  $2::date + INTERVAL '1 day'
       ORDER BY p.fecha_pago DESC`,
      [desde, hasta]
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
    res.status(500).json({ error: 'Error al generar reporte de pagos', detail: String(error) });
  }
};
