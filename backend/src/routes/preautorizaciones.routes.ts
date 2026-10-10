import { Router } from 'express';
import { verifyToken, requireStaff, requireAdminSucursal } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';
import {
  getPreautorizaciones,
  createPreautorizacion,
  deletePreautorizacion,
  getMisPreautorizaciones,
  createMisPreautorizacion,
  deleteMisPreautorizacion,
  buscarPreautorizacion,
} from '../controllers/preautorizaciones.controller';

const router = Router();

// Lectura y administración: sólo personal. El residente usa /mis (lo suyo).
router.get('/buscar',     verifyToken, requireStaff, buscarPreautorizacion);
router.get('/mis',        verifyToken, getMisPreautorizaciones);
router.post('/mis',       verifyToken, auditLog({ accion: 'PREAUTORIZACION_CREADA', tabla: 'preautorizaciones' }), createMisPreautorizacion);
router.delete('/mis/:id', verifyToken, auditLog({ accion: 'PREAUTORIZACION_ELIMINADA', tabla: 'preautorizaciones' }), deleteMisPreautorizacion);

router.get('/',       verifyToken, requireStaff, getPreautorizaciones);
router.post('/',      verifyToken, requireAdminSucursal, auditLog({ accion: 'PREAUTORIZACION_CREADA', tabla: 'preautorizaciones' }), createPreautorizacion);
router.delete('/:id', verifyToken, requireAdminSucursal, auditLog({ accion: 'PREAUTORIZACION_ELIMINADA', tabla: 'preautorizaciones' }), deletePreautorizacion);

export default router;
