import { Router } from 'express';
import { body } from 'express-validator';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { login, refresh, logout } from '../controllers/auth.controller';
import { validateRequest } from '../middleware/validate.middleware';
import { auditLog } from '../middleware/audit.middleware';

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
const loginPorIp = rateLimit({
  windowMs: VENTANA,
  max: parseInt(process.env.RATE_LIMIT_LOGIN_MAX || '20', 10),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login' },
});

const loginPorCuenta = rateLimit({
  windowMs: VENTANA,
  max: parseInt(process.env.RATE_LIMIT_LOGIN_CUENTA_MAX || '10', 10),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return email ? `cuenta:${email}` : ipKeyGenerator(req.ip ?? '');
  },
  message: { error: 'Demasiados intentos para esta cuenta; espera 15 minutos' },
});

/** refresh y logout ya no comparten el cupo del login (antes eran 10 por 15 min en total). */
const sesionLimiter = rateLimit({
  windowMs: VENTANA,
  max: parseInt(process.env.RATE_LIMIT_SESION_MAX || '120', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de sesión' },
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
router.post('/logout',  sesionLimiter, logout);

export default router;
