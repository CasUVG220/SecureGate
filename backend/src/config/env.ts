import crypto from 'crypto';

/**
 * Validación del entorno al arrancar.
 *
 * El secreto JWT firma tanto las sesiones de usuario como los tokens de licencia
 * de las garitas: si es conocido (estaba escrito en docker-compose.yml y en
 * .env.example), cualquiera puede fabricarse un token de `owner`. Por eso:
 *
 * - En producción el arranque ABORTA si falta, es corto o es uno de los valores
 *   públicos del repositorio.
 * - Fuera de producción, si falta se genera uno aleatorio para esa ejecución
 *   (con aviso: las sesiones y licencias se invalidan al reiniciar; define
 *   JWT_SECRET en `.env` para conservarlas). Un valor público conocido se
 *   rechaza igual: nadie debería correr con él ni en desarrollo.
 */
export const JWT_SECRET_MIN = 32;

export const SECRETOS_CONOCIDOS = new Set([
  'change_me_in_production',
  'securegate_jwt_secret_dev',
  'secret',
  'changeme',
  'test',
]);

export const esProduccion = (): boolean => process.env.NODE_ENV === 'production';

export const validarJwtSecret = (env: NodeJS.ProcessEnv = process.env): { secret: string; generado: boolean } => {
  const actual = env.JWT_SECRET?.trim();
  const produccion = env.NODE_ENV === 'production';

  if (actual && SECRETOS_CONOCIDOS.has(actual)) {
    throw new Error('JWT_SECRET es un valor público conocido; genera uno propio (openssl rand -hex 48).');
  }
  if (actual && actual.length >= JWT_SECRET_MIN) return { secret: actual, generado: false };

  if (produccion) {
    throw new Error(
      `JWT_SECRET es obligatorio en producción y debe tener al menos ${JWT_SECRET_MIN} caracteres (openssl rand -hex 48).`,
    );
  }
  if (actual) {
    throw new Error(`JWT_SECRET debe tener al menos ${JWT_SECRET_MIN} caracteres.`);
  }
  return { secret: crypto.randomBytes(48).toString('hex'), generado: true };
};

/** Aplica la validación sobre process.env. Lanza si el entorno no es seguro. */
export const validarEntorno = (): void => {
  const { secret, generado } = validarJwtSecret();
  process.env.JWT_SECRET = secret;
  if (generado) {
    console.warn(
      '[env] JWT_SECRET no definido: se generó uno aleatorio para esta ejecución. ' +
      'Las sesiones y las licencias de garita se invalidarán al reiniciar. Define JWT_SECRET en .env.',
    );
  }

  if (esProduccion()) {
    if (!process.env.ALLOWED_ORIGINS?.trim()) {
      throw new Error('ALLOWED_ORIGINS es obligatorio en producción (lista de orígenes separados por coma).');
    }
    if (/sgpassword123/.test(process.env.DATABASE_URL ?? '')) {
      throw new Error('DATABASE_URL usa la contraseña de desarrollo del repositorio; cámbiala en producción.');
    }
  }
};

/**
 * Saltos de proxy de confianza para `req.ip` (express `trust proxy`).
 * 0 = sin proxy (default). Detrás de nginx: TRUST_PROXY=1.
 */
export const trustProxyHops = (env: NodeJS.ProcessEnv = process.env): number => {
  const n = parseInt(env.TRUST_PROXY ?? '0', 10);
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : 0;
};
