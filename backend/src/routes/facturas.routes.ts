import { Router } from 'express';
import * as ctrl from '../controllers/facturas.controller';
import { requireOwner, requireAdminEmpresa } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { crearLimitador } from '../middleware/limitadores';

const router = Router();

/**
 * Correr la facturación a mano recorre todas las empresas y manda correos: cupo por usuario (no por IP) y los bloqueos (429) quedan auditados.
 * Los dos límites son independientes para que revisar vencimientos no gaste el cupo de generar.
 */
const limite = (nombre: string, accion: string) => crearLimitador({
  nombre, windowMs: 15 * 60 * 1000, max: parseInt(process.env.RATE_LIMIT_FACTURACION_MAX || '5', 10), porUsuario: true, accion, tabla: 'facturas_saas',
  mensaje: 'Demasiadas ejecuciones; espera 15 minutos',
});
export const generarLimiter = limite('facturacion-generar-usuario', 'FACTURAS_SAAS_GENERADAS');
export const revisarLimiter = limite('facturacion-revisar-usuario', 'FACTURAS_SAAS_REVISADAS');

router.get('/',                  requireOwner, ctrl.getFacturas);
router.post('/generar',          requireOwner, generarLimiter, auditLog({ accion: 'FACTURAS_SAAS_GENERADAS', tabla: 'facturas_saas' }), ctrl.generarFacturas);
router.post('/revisar-vencidas', requireOwner, revisarLimiter, auditLog({ accion: 'FACTURAS_SAAS_REVISADAS', tabla: 'facturas_saas' }), ctrl.revisarVencidas);
router.get('/:id',               requireAdminEmpresa, ctrl.getFactura);
router.post('/:id/pagar',        requireOwner, auditLog({ accion: 'FACTURA_SAAS_PAGADA', tabla: 'facturas_saas' }), ctrl.pagar);
router.post('/:id/anular',       requireOwner, auditLog({ accion: 'FACTURA_SAAS_ANULADA', tabla: 'facturas_saas' }), ctrl.anular);

export default router;
