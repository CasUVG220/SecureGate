import { Router } from 'express';
import * as ctrl from '../controllers/onboarding.controller';
import { verifyToken, requireAdminEmpresa } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { crearLimitador } from '../middleware/limitadores';

const router = Router();

/**
 * Rutas PÚBLICAS (quien llega todavía no tiene cuenta): cada una con su límite por IP y los bloqueos (429) auditados.
 * El tope por correo (3 en 24 h) vive en el servicio. Modelo de amenazas: docs/saas_nucleo.md, sección 8.
 */
const limite = (nombre: string, accion: string, ventanaMin: number, env: string, defecto: number) => crearLimitador({
  nombre, windowMs: ventanaMin * 60 * 1000, max: parseInt(process.env[env] || String(defecto), 10), accion, tabla: 'onboarding_solicitudes',
  mensaje: 'Demasiados intentos; espera un momento',
});
const solicitarLimiter = limite('onboarding-solicitar-ip', 'ONBOARDING_SOLICITADO', 60, 'RATE_LIMIT_ONBOARDING_SOLICITAR_MAX', 5);
const enlaceLimiter    = limite('onboarding-enlace-ip', 'ONBOARDING_BORRADOR_GUARDADO', 15, 'RATE_LIMIT_ONBOARDING_MAX', 60);
const completarLimiter = limite('onboarding-completar-ip', 'ONBOARDING_COMPLETADO', 60, 'RATE_LIMIT_ONBOARDING_COMPLETAR_MAX', 10);
const reenviarLimiter  = limite('onboarding-reenviar-ip', 'ONBOARDING_INVITACION_REENVIADA', 60, 'RATE_LIMIT_ONBOARDING_REENVIAR_MAX', 10);

router.post('/solicitar', solicitarLimiter, auditLog({ accion: 'ONBOARDING_SOLICITADO', tabla: 'onboarding_solicitudes' }), ctrl.solicitarAlta);

// Con sesión (admin de la empresa): antes de '/:token' para que "progreso" no se tome por un enlace.
router.get('/progreso', verifyToken, requireAdminEmpresa, ctrl.getProgreso);

router.get('/:token', enlaceLimiter, ctrl.getOnboarding);
router.put('/:token/borrador', enlaceLimiter, auditLog({ accion: 'ONBOARDING_BORRADOR_GUARDADO', tabla: 'onboarding_solicitudes' }), ctrl.putBorrador);
router.post('/:token/completar', completarLimiter, auditLog({ accion: 'ONBOARDING_COMPLETADO', tabla: 'onboarding_solicitudes' }), ctrl.completar);
router.post('/:token/reenviar', reenviarLimiter, auditLog({ accion: 'ONBOARDING_INVITACION_REENVIADA', tabla: 'onboarding_solicitudes' }), ctrl.reenviar);

export default router;
