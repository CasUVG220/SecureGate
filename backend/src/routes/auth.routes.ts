import { Router } from 'express';
import { body } from 'express-validator';
import { ipKeyGenerator } from 'express-rate-limit';
import { login, refresh, logout } from '../controllers/auth.controller';
import { validateRequest } from '../middleware/validate.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { crearLimitador } from '../middleware/limitadores';

const router = Router();

const VENTANA = 15 * 60 * 1000;

/**
 * Fuerza bruta contra el login: dos límites independientes que sólo cuentan los
 * intentos FALLIDOS (`skipSuccessfulRequests`), así un equipo entrando bien
 * desde la misma IP no se bloquea a sí mismo.
 *
 * - Por IP: frena a quien prueba muchas cuentas desde un mismo origen. Con
 *   `trust proxy` bien configurado (index.ts) la IP es la real, no la del proxy.
 * - Por cuenta: frena a quien prueba muchas contraseñas contra UN correo desde
 *   muchas IPs, algo que el límite por IP no ve. El precio es que alguien podría
 *   bloquear a propósito una cuenta ajena durante 15 min; es el trade-off
 *   estándar y mucho menos grave que un acceso no autorizado.
 *
 * Overrides (RATE_LIMIT_LOGIN_MAX / RATE_LIMIT_LOGIN_CUENTA_MAX) sólo para
 * pruebas de carga.
 */
// Los intentos bloqueados por estos límites también quedan en audit_logs (acción LOGIN, status 429, con el correo
// intentado y el límite que frenó), no sólo los que llegan a verificar la contraseña (RNF-10).
const loginPorIp = crearLimitador({
  nombre: 'login-ip',
  windowMs: VENTANA,
  max: parseInt(process.env.RATE_LIMIT_LOGIN_MAX || '20', 10),
  soloFallidos: true,
  accion: 'LOGIN',
  mensaje: 'Demasiados intentos de login',
});

const loginPorCuenta = crearLimitador({
  nombre: 'login-cuenta',
  windowMs: VENTANA,
  max: parseInt(process.env.RATE_LIMIT_LOGIN_CUENTA_MAX || '10', 10),
  soloFallidos: true,
  accion: 'LOGIN',
  clave: req => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return email ? `cuenta:${email}` : ipKeyGenerator(req.ip ?? '');
  },
  mensaje: 'Demasiados intentos para esta cuenta; espera 15 minutos',
});

/** refresh y logout ya no comparten el cupo del login (antes eran 10 por 15 min en total). */
const sesionLimiter = crearLimitador({
  nombre: 'sesion-ip',
  windowMs: VENTANA,
  max: parseInt(process.env.RATE_LIMIT_SESION_MAX || '120', 10),
  accion: 'LIMITE_SESION',
  tabla: 'refresh_tokens',
  mensaje: 'Demasiadas solicitudes de sesión',
});

router.post(
  '/login',
  loginPorIp,
  body('email').isEmail().normalizeEmail(),
  body('password').isString().isLength({ min: 6, max: 100 }),
  validateRequest,
  loginPorCuenta,
  auditLog({ accion: 'LOGIN' }),
  login,
);

router.post('/refresh', sesionLimiter, refresh);
router.post('/logout',  sesionLimiter, auditLog({ accion: 'LOGOUT', tabla: 'refresh_tokens' }), logout);

export default router;
