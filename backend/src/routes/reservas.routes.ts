import { Router } from 'express';
import { requireAdminSucursal } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';
import {
  getDisponibilidad,
  crearReserva,
  aprobarReserva,
  rechazarReserva,
  cancelarReserva,
  getPreviewCancelacion,
  getMisReservas,
  getReservas,
} from '../controllers/reservas.controller';

const router = Router();

// Rutas literales antes de cualquier '/:id'
router.get('/disponibilidad', getDisponibilidad);
router.get('/mis-reservas',   getMisReservas);

// Residente
router.post('/', auditLog({ accion: 'CREAR_RESERVA', tabla: 'reservas_areas' }), crearReserva);
router.get('/:id/preview-cancelacion', getPreviewCancelacion);
router.patch(
  '/:id/cancelar',
  auditLog({ accion: 'RESERVA_CANCELADA', tabla: 'reservas_areas' }),
  cancelarReserva
);

// Admin
router.get('/', requireAdminSucursal, getReservas);
router.patch(
  '/:id/aprobar',
  requireAdminSucursal,
  auditLog({ accion: 'RESERVA_APROBADA', tabla: 'reservas_areas' }),
  aprobarReserva
);
router.patch(
  '/:id/rechazar',
  requireAdminSucursal,
  auditLog({ accion: 'RESERVA_RECHAZADA', tabla: 'reservas_areas' }),
  rechazarReserva
);

export default router;
