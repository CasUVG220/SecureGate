import { Router } from 'express';
import pool from '../db/pool';
import authRouter from './auth.routes';
import residentesRouter from './residentes.routes';
import accesosRouter from './accesos.routes';
import cargosRouter from './cargos.routes';
import pagosRouter from './pagos.routes';
import preautorizacionesRouter from './preautorizaciones.routes';
import ocrRouter from './ocr.routes';
import reportesRouter from './reportes.routes';

const router = Router();

router.use('/auth', authRouter);
router.use('/residentes', residentesRouter);
router.use('/accesos', accesosRouter);
router.use('/cargos', cargosRouter);
router.use('/pagos', pagosRouter);
router.use('/preautorizaciones', preautorizacionesRouter);
router.use('/ocr', ocrRouter);
router.use('/reportes', reportesRouter);

router.get('/dashboard', async (_req, res) => {
  try {
    const [accesosHoy, residentesMora, pagosPendientes, accesosRecientes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM registros_acceso
         WHERE DATE(timestamp_entrada) = CURRENT_DATE`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM residentes
         WHERE estado_pago = 'mora'`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM pagos
         WHERE estado = 'pendiente'`
      ),
      pool.query(
        `SELECT ra.id,
                v.nombre           AS nombre_visitante,
                r.numero_casa,
                ra.timestamp_entrada,
                ra.timestamp_salida
         FROM registros_acceso ra
         JOIN visitantes v ON ra.visitante_id = v.id
         JOIN residentes r ON ra.residente_id = r.id
         ORDER BY ra.timestamp_entrada DESC
         LIMIT 10`
      ),
    ]);

    res.json({
      accesos_hoy:       accesosHoy.rows[0].total,
      residentes_mora:   residentesMora.rows[0].total,
      pagos_pendientes:  pagosPendientes.rows[0].total,
      accesos_recientes: accesosRecientes.rows,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener datos del dashboard', detail: String(error) });
  }
});

router.get('/status', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as tiempo, current_database() as base_datos');
    res.json({
      backend: 'conectado',
      base_datos: 'conectada',
      info: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({ backend: 'conectado', base_datos: 'error', error: String(error) });
  }
});