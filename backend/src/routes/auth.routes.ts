import { Router } from 'express';
import { body } from 'express-validator';
import { ipKeyGenerator } from 'express-rate-limit';
import { login, refresh, logout } from '../controllers/auth.controller';
import { estado, iniciar, confirmar, desactivar, regenerarCodigos, verificar } from '../controllers/twofa.controller';
import { validateRequest } from '../middleware/validate.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { crearLimitador } from '../middleware/limitadores';
import { verifyToken, requireAdminSucursal } from '../middleware/auth.middleware';

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

/**
 * Verificación en dos pasos de los administradores (SCRUM-123, docs/verificacion_dos_pasos.md).
 *
 * El intento de adivinar el segundo factor está acotado de tres maneras: la cuenta por PERSONA en la base (5 fallos en
 * 15 min → bloqueada 15 min, vengan de las IPs que vengan; ver twofa.controller), este límite por IP en el ingreso y un
 * límite por usuario en las rutas con sesión. Sólo cuentan los intentos fallidos, y los bloqueados (429) quedan auditados.
 *
 * Las rutas con sesión son de los tres roles de administración (owner, admin de empresa, admin de sucursal): el personal
 * de garita y los residentes no la usan.
 */
const dosPasosPorIp = crearLimitador({
  nombre: 'dos-pasos-ip',
  windowMs: VENTANA,
  max: parseInt(process.env.RATE_LIMIT_2FA_MAX || '30', 10),
  soloFallidos: true,
  accion: 'TWOFA_VERIFICACION',
  tabla: 'usuario_2fa',
  mensaje: 'Demasiados intentos de verificación; espera 15 minutos',
});

const dosPasosPorUsuario = (accion: string, max: number) => crearLimitador({
  nombre: `dos-pasos-usuario-${accion.toLowerCase().replace('twofa_', '')}`,
  windowMs: VENTANA,
  max,
  porUsuario: true,
  soloFallidos: true,
  accion,
  tabla: 'usuario_2fa',
  mensaje: 'Demasiados intentos; espera 15 minutos',
});

const conSesion = [verifyToken, requireAdminSucursal];
router.post('/2fa/verificar', dosPasosPorIp, auditLog({ accion: 'TWOFA_VERIFICACION', tabla: 'usuario_2fa' }), verificar);
router.get('/2fa/estado', ...conSesion, estado);
router.post('/2fa/iniciar', ...conSesion, auditLog({ accion: 'TWOFA_INICIADO', tabla: 'usuario_2fa' }), iniciar);
router.post('/2fa/confirmar', ...conSesion, dosPasosPorUsuario('TWOFA_ACTIVADO', parseInt(process.env.RATE_LIMIT_2FA_CONFIRMAR_MAX || '10', 10)),
  auditLog({ accion: 'TWOFA_ACTIVADO', tabla: 'usuario_2fa' }), confirmar);
router.post('/2fa/desactivar', ...conSesion, dosPasosPorUsuario('TWOFA_DESACTIVADO', parseInt(process.env.RATE_LIMIT_2FA_DESACTIVAR_MAX || '5', 10)),
  auditLog({ accion: 'TWOFA_DESACTIVADO', tabla: 'usuario_2fa' }), desactivar);
router.post('/2fa/codigos-recuperacion', ...conSesion, dosPasosPorUsuario('TWOFA_CODIGOS_REGENERADOS', parseInt(process.env.RATE_LIMIT_2FA_CODIGOS_MAX || '10', 10)),
  auditLog({ accion: 'TWOFA_CODIGOS_REGENERADOS', tabla: 'usuario_2fa' }), regenerarCodigos);

export default router;
