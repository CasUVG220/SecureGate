import { Router } from 'express';
import * as ctrl from '../controllers/anuncios.controller';
import { requireAdminSucursal } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';

const router = Router();

// Residente
router.get('/mis',       ctrl.getMisAnuncios);
router.post('/:id/leer', ctrl.marcarLeido);

// Admin
router.get('/',    requireAdminSucursal, ctrl.getAnuncios);
router.post('/',   requireAdminSucursal, auditLog({ accion: 'ANUNCIO_CREADO', tabla: 'anuncios' }), ctrl.createAnuncio);
router.put('/:id', requireAdminSucursal, ctrl.updateAnuncio);
router.delete('/:id', requireAdminSucursal, auditLog({ accion: 'ANUNCIO_ELIMINADO', tabla: 'anuncios' }), ctrl.deleteAnuncio);

export default router;
