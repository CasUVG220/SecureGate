import { Router } from 'express';
import { requireAdminSucursal } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { getAreas, createArea, updateArea, deleteArea } from '../controllers/areas.controller';

const router = Router();

// Lectura: residentes y staff (el filtro multi-tenant vive en el controlador)
router.get('/', getAreas);

// Administración de áreas
router.post('/',      requireAdminSucursal, auditLog({ accion: 'AREA_CREADA',      tabla: 'areas_comunes' }), createArea);
router.put('/:id',    requireAdminSucursal, auditLog({ accion: 'AREA_ACTUALIZADA', tabla: 'areas_comunes' }), updateArea);
router.delete('/:id', requireAdminSucursal, auditLog({ accion: 'AREA_ELIMINADA',   tabla: 'areas_comunes' }), deleteArea);

export default router;
