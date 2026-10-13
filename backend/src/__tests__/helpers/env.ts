/**
 * Entorno de las pruebas de integración (setupFiles: corre en cada archivo de
 * test ANTES de importar la app). Todos los valores son de prueba, sin secretos.
 * Los valores ya presentes en el entorno (CI, .env local) tienen prioridad.
 */
import { validarBaseDePrueba } from './guardaBd';

const def = (k: string, v: string) => { if (!process.env[k]) process.env[k] = v; };

def('DATABASE_URL', 'postgresql://postgres:postgres@127.0.0.1:55432/securegate_test');
def('JWT_SECRET', 'secreto-de-prueba-solo-para-tests-0123456789abcdef');
process.env.NODE_ENV = 'test';
def('EMAIL_TRANSPORT', 'log');
def('APP_URL', 'http://localhost:5173');
def('DB_POOL_MAX', '5');

// Los limitadores viven en memoria y cada archivo de test carga módulos nuevos;
// se suben los topes para que el volumen de las pruebas no los dispare. Las
// pruebas que verifican un límite concreto lo bajan antes de importar la app.
for (const k of [
  'GENERAL', 'LOGIN', 'LOGIN_CUENTA', 'SESION', 'ACTIVAR', 'HEARTBEAT', 'INVITACION', 'OCR', 'ELIMINAR', 'FACTURACION', 'EXPORTAR', 'ONBOARDING_SOLICITAR', 'ONBOARDING', 'ONBOARDING_COMPLETAR', 'ONBOARDING_REENVIAR',
  '2FA', '2FA_CONFIRMAR', '2FA_DESACTIVAR', '2FA_CODIGOS',
]) def(`RATE_LIMIT_${k}_MAX`, '100000');

validarBaseDePrueba(process.env.DATABASE_URL);
