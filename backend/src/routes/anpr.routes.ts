import { Router } from 'express';
import { verifyToken, requireAdminSucursal, requireStaff } from '../middleware/auth.middleware';
import { verifyLicencia } from '../middleware/licencia.middleware';
import { auditLog } from '../middleware/audit.middleware';
import {
  listarVehiculos, crearVehiculo, actualizarVehiculo, darDeBajaVehiculo,
  registrarAccesoAnpr, registrarSalidaAnpr, registrarEventoAnpr, subirEvidencia, verEvidencia,
} from '../controllers/anpr.controller';

/**
 * ANPR continuo (Sprint 10). Ver docs/anpr_continuo.md y controllers/anpr.controller.ts.
 *
 * - `/vehiculos`: vehículos autorizados de los residentes (administración de sucursal hacia arriba).
 * - `/accesos`, `/salidas`, `/eventos`, `/evidencias` (POST): los sube la garita desde su cola offline. Doble llave: sesión del
 *   agente + licencia del equipo (`verifyLicencia`: empresa suspendida → 423). La auditoría va ANTES de la licencia para que un
 *   intento rechazado (403/423) también quede en la bitácora.
 */
const router = Router();

router.get('/vehiculos', verifyToken, requireAdminSucursal, listarVehiculos);
router.post('/vehiculos', verifyToken, requireAdminSucursal, auditLog({ accion: 'VEHICULO_RESIDENTE_CREADO', tabla: 'vehiculos_residentes' }), crearVehiculo);
router.patch('/vehiculos/:id', verifyToken, requireAdminSucursal, auditLog({ accion: 'VEHICULO_RESIDENTE_ACTUALIZADO', tabla: 'vehiculos_residentes' }), actualizarVehiculo);
router.delete('/vehiculos/:id', verifyToken, requireAdminSucursal, auditLog({ accion: 'VEHICULO_RESIDENTE_DADO_DE_BAJA', tabla: 'vehiculos_residentes' }), darDeBajaVehiculo);

// La acción por defecto se cambia en el controlador según el modo (ANPR_ACCESO_VERIFICADO) o el tipo de evento.
router.post('/accesos', verifyToken, requireStaff, auditLog({ accion: 'ANPR_ACCESO_AUTOMATICO', tabla: 'registros_acceso' }), verifyLicencia, registrarAccesoAnpr);
router.post('/salidas', verifyToken, requireStaff, auditLog({ accion: 'ANPR_SALIDA', tabla: 'registros_acceso' }), verifyLicencia, registrarSalidaAnpr);
router.post('/eventos', verifyToken, requireStaff, auditLog({ accion: 'ANPR_EVENTO', tabla: 'anpr_eventos' }), verifyLicencia, registrarEventoAnpr);
router.post('/evidencias', verifyToken, requireStaff, auditLog({ accion: 'ANPR_EVIDENCIA', tabla: 'evidencias_anpr' }), verifyLicencia, subirEvidencia);
router.get('/evidencias/:id_cliente/:tipo', verifyToken, requireStaff, verEvidencia);

export default router;
