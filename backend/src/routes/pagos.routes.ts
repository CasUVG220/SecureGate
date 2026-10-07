import { Router } from 'express';
import { verifyToken, requireAdminSucursal } from '../middleware/auth.middleware';
import {
  getPagos, createPago, aprobarPago, rechazarPago,
  crearTransferencia, getPendientesVerificacion, getMisPagos, getMiResumenMes,
  pagarConTarjeta, getEstadoTarjeta,
} from '../controllers/pagos.controller';
import { auditLog } from '../middleware/audit.middleware';
import { crearLimitador } from '../middleware/limitadores';

const router = Router();

// Límites POR USUARIO (RNF-10). La tarjeta es el vector clásico de «card testing» (probar números hasta que uno pasa) y la
// transferencia sube una imagen de hasta 8 MB al servidor: ninguna de las dos tenía tope. Los bloqueos (429) quedan auditados.
const tarjetaLimiter = crearLimitador({
  nombre: 'pago-tarjeta-usuario', windowMs: 15 * 60 * 1000, max: parseInt(process.env.RATE_LIMIT_PAGO_TARJETA_MAX || '10', 10),
  porUsuario: true, accion: 'PAGO_TARJETA_SIMULADO', tabla: 'pagos', mensaje: 'Demasiados intentos de pago; espera unos minutos',
});
const transferenciaLimiter = crearLimitador({
  nombre: 'pago-transferencia-usuario', windowMs: 15 * 60 * 1000, max: parseInt(process.env.RATE_LIMIT_PAGO_TRANSFERENCIA_MAX || '10', 10),
  porUsuario: true, accion: 'PAGO_TRANSFERENCIA_ENVIADA', tabla: 'pagos', mensaje: 'Demasiados comprobantes enviados; espera unos minutos',
});

router.get('/pendientes-verificacion', verifyToken, requireAdminSucursal, getPendientesVerificacion);
router.get('/mis',                     verifyToken, getMisPagos);
router.get('/mi-resumen',              verifyToken, getMiResumenMes);
router.post('/transferencia',          verifyToken, transferenciaLimiter, auditLog({ accion: 'PAGO_TRANSFERENCIA_ENVIADA', tabla: 'pagos' }), crearTransferencia);
router.get('/tarjeta/estado',          verifyToken, getEstadoTarjeta);
router.post('/tarjeta',                verifyToken, tarjetaLimiter, auditLog({ accion: 'PAGO_TARJETA_SIMULADO', tabla: 'pagos' }), pagarConTarjeta);
// Listado de toda la sucursal: es de administración. El residente consulta lo
// suyo por /mis y /mi-resumen, que sí filtran por su propio residente_id.
router.get('/',                        verifyToken, requireAdminSucursal, getPagos);
router.post('/',                       verifyToken, requireAdminSucursal, auditLog({ accion: 'PAGO_EFECTIVO',  tabla: 'pagos' }), createPago);
router.put('/:id/aprobar',             verifyToken, requireAdminSucursal, auditLog({ accion: 'PAGO_APROBADO',  tabla: 'pagos' }), aprobarPago);
router.put('/:id/rechazar',            verifyToken, requireAdminSucursal, auditLog({ accion: 'PAGO_RECHAZADO', tabla: 'pagos' }), rechazarPago);

export default router;
