/**
 * Verificación en dos pasos (TOTP, RFC 6238) — SCRUM-123.
 *
 * Sólo piezas puras y de criptografía; el flujo HTTP vive en `controllers/twofa.controller.ts`.
 *
 * - El TOTP es la implementación mínima del RFC 6238 (HMAC-SHA1, 6 dígitos, 30 s) sobre el `crypto` de Node, sin
 *   dependencias nuevas: es lo que entienden Google Authenticator, Microsoft Authenticator, Authy, 1Password…, y se
 *   comprueba contra los vectores del RFC 4226/6238 (ver `__tests__/twofa.test.ts`). Se prefirió a una librería porque las
 *   actuales son sólo-ESM y no cargan en Jest ni en un `require` de Node 20 sin banderas, y la pieza cabe en 40 líneas.
 * - El secreto TOTP se guarda CIFRADO (AES-256-GCM, ligado al usuario con AAD): una copia de la base de datos sola no
 *   permite generar códigos. La llave sale de `TWOFA_KEY` si está definida y, si no, de `JWT_SECRET` (HKDF), así que la
 *   función no exige una variable de entorno nueva. Para rotar JWT_SECRET sin perder los secretos hay que fijar antes
 *   `TWOFA_KEY` con el valor ACTUAL de JWT_SECRET: la llave derivada es la misma (ver docs/verificacion_dos_pasos.md).
 * - Los códigos de recuperación se guardan como HMAC-SHA256 con otra llave derivada: son de 50 bits y un hash sin llave se
 *   podría adivinar fuera de línea si la base se filtrara; con la llave del servidor, no.
 * - El desafío entre la contraseña y el segundo factor es un JWT de 5 minutos con `typ: '2fa'`. `verifyToken` rechaza
 *   cualquier token con `typ`, así que no sirve como sesión; y las licencias exigen `typ: 'licencia'`.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export const EMISOR = 'SecureGate';
/** Fallos del segundo factor tolerados en la ventana antes de bloquear a la persona. */
export const MAX_INTENTOS = 5;
export const VENTANA_INTENTOS_MIN = 15;
export const BLOQUEO_MIN = 15;
export const DESAFIO_TTL = '5m';
export const CANTIDAD_CODIGOS = 10;

// ── Llaves ────────────────────────────────────────────────────────────────────────────────────

const materialBase = (): string => {
  const propia = process.env.TWOFA_KEY?.trim();
  if (propia) return propia;
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('Falta JWT_SECRET (o TWOFA_KEY) para proteger los secretos de la verificación en dos pasos');
  return jwtSecret;
};

/** Llave de 32 bytes por uso (cifrado de secretos, hash de códigos): una no sirve para la otra. */
const derivar = (uso: string): Buffer =>
  Buffer.from(crypto.hkdfSync('sha256', materialBase(), 'securegate-2fa-v1', uso, 32));

// ── Secreto TOTP en reposo ────────────────────────────────────────────────────────────────────

const b64 = (b: Buffer): string => b.toString('base64url');

/** `v1.<iv>.<etiqueta>.<cifrado>`. El usuario va como dato autenticado: un secreto copiado a otra fila no descifra. */
export const cifrarSecreto = (secreto: string, usuarioId: string): string => {
  const iv = crypto.randomBytes(12);
  const cifrador = crypto.createCipheriv('aes-256-gcm', derivar('secreto-v1'), iv);
  cifrador.setAAD(Buffer.from(usuarioId));
  const cifrado = Buffer.concat([cifrador.update(secreto, 'utf8'), cifrador.final()]);
  return ['v1', b64(iv), b64(cifrador.getAuthTag()), b64(cifrado)].join('.');
};

/** Lanza si el valor fue alterado, es de otro usuario o la llave cambió. */
export const descifrarSecreto = (guardado: string, usuarioId: string): string => {
  const [version, iv, etiqueta, cifrado] = guardado.split('.');
  if (version !== 'v1' || !iv || !etiqueta || !cifrado) throw new Error('Secreto de dos pasos con formato desconocido');
  const descifrador = crypto.createDecipheriv('aes-256-gcm', derivar('secreto-v1'), Buffer.from(iv, 'base64url'));
  descifrador.setAAD(Buffer.from(usuarioId));
  descifrador.setAuthTag(Buffer.from(etiqueta, 'base64url'));
  return Buffer.concat([descifrador.update(Buffer.from(cifrado, 'base64url')), descifrador.final()]).toString('utf8');
};

// ── TOTP (RFC 6238) ───────────────────────────────────────────────────────────────────────────

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIODO_S = 30;
const DIGITOS = 6;

export const base32Codificar = (bytes: Buffer): string => {
  let bits = 0, valor = 0, salida = '';
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) { salida += BASE32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) salida += BASE32[(valor << (5 - bits)) & 31];
  return salida;
};

/** Lanza si el texto trae símbolos fuera del alfabeto (acepta minúsculas, espacios y el relleno `=`). */
export const base32Decodificar = (texto: string): Buffer => {
  const limpio = texto.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0, valor = 0;
  const bytes: number[] = [];
  for (const c of limpio) {
    const i = BASE32.indexOf(c);
    if (i < 0) throw new Error('Secreto base32 inválido');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) { bytes.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
};

/** HOTP (RFC 4226): HMAC-SHA1 del contador y truncado dinámico a 6 dígitos. */
const hotp = (clave: Buffer, contador: number): string => {
  const mensaje = Buffer.alloc(8);
  mensaje.writeBigUInt64BE(BigInt(contador));
  const h = crypto.createHmac('sha1', clave).update(mensaje).digest();
  const o = h[h.length - 1] & 0x0f;
  const binario = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(binario % 10 ** DIGITOS).padStart(DIGITOS, '0');
};

/** Secreto nuevo: 20 bytes aleatorios (160 bits, lo que recomienda el RFC 4226) en base32, 32 caracteres. */
export const nuevoSecreto = (): string => base32Codificar(crypto.randomBytes(20));

/** Intervalo de 30 s al que pertenece un instante (milisegundos desde 1970). */
export const pasoDe = (ahoraMs = Date.now()): number => Math.floor(ahoraMs / 1000 / PERIODO_S);

/** El código que da la app de autenticación en el intervalo `paso`. Sólo lo usan las pruebas y `verificarTotp`. */
export const codigoTotp = (secreto: string, paso: number): string => hotp(base32Decodificar(secreto), paso);

/** URL `otpauth://` que las apps de autenticación leen del QR. */
export const urlOtpauth = (secreto: string, correo: string): string =>
  `otpauth://totp/${encodeURIComponent(EMISOR)}:${encodeURIComponent(correo)}` +
  `?secret=${secreto}&issuer=${encodeURIComponent(EMISOR)}&algorithm=SHA1&digits=${DIGITOS}&period=${PERIODO_S}`;

/** Quita espacios y guiones que la gente teclea al copiar un código: «123 456» → «123456». */
export const limpiarCodigo = (codigo: unknown): string =>
  typeof codigo === 'string' ? codigo.replace(/[\s-]/g, '').slice(0, 32).toUpperCase() : '';

export const esCodigoTotp = (codigo: string): boolean => /^\d{6}$/.test(codigo);

export interface ResultadoTotp { valido: boolean; paso?: number }

/**
 * ¿Es `codigo` el TOTP vigente (±1 intervalo de 30 s por desfase de reloj)? `despuesDePaso` es el último intervalo ya
 * aceptado: un código de ese intervalo o de uno anterior se rechaza aunque coincida, así un código visto por encima del
 * hombro no se puede reutilizar. Devuelve el intervalo que coincidió para que quien llama lo registre.
 */
export const verificarTotp = (
  secreto: string, codigo: string, despuesDePaso?: number | string | null, ahoraMs = Date.now(),
): ResultadoTotp => {
  if (!esCodigoTotp(codigo)) return { valido: false };
  try {
    const clave = base32Decodificar(secreto);
    const minimo = despuesDePaso === null || despuesDePaso === undefined ? -Infinity : Number(despuesDePaso);
    const recibido = Buffer.from(codigo);
    const actual = pasoDe(ahoraMs);
    let aceptado: number | undefined;
    // Se prueban los tres intervalos siempre y con comparación de tiempo constante: no se corta al primer acierto.
    for (const paso of [actual, actual - 1, actual + 1]) {
      const coincide = crypto.timingSafeEqual(Buffer.from(hotp(clave, paso)), recibido);
      if (coincide && paso > minimo && aceptado === undefined) aceptado = paso;
    }
    return aceptado === undefined ? { valido: false } : { valido: true, paso: aceptado };
  } catch {
    return { valido: false };
  }
};

// ── Códigos de recuperación ───────────────────────────────────────────────────────────────────

/** 32 símbolos sin 0/O/1/I, para que se lean bien en papel. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LARGO_CODIGO = 10;

/** 10 códigos `XXXXX-XXXXX`, sin repetidos. Se muestran UNA sola vez. */
export const generarCodigosRecuperacion = (cantidad = CANTIDAD_CODIGOS): string[] => {
  const codigos = new Set<string>();
  while (codigos.size < cantidad) {
    let c = '';
    for (let i = 0; i < LARGO_CODIGO; i++) c += ALFABETO[crypto.randomInt(ALFABETO.length)];
    codigos.add(`${c.slice(0, 5)}-${c.slice(5)}`);
  }
  return [...codigos];
};

/** Forma canónica (sin guion, mayúsculas) de un código de recuperación, o null si no tiene forma de uno. */
export const normalizarCodigoRecuperacion = (codigo: unknown): string | null => {
  const c = limpiarCodigo(codigo);
  return new RegExp(`^[${ALFABETO}]{${LARGO_CODIGO}}$`).test(c) ? c : null;
};

export const hashCodigoRecuperacion = (codigoNormalizado: string): string =>
  crypto.createHmac('sha256', derivar('recuperacion-v1')).update(codigoNormalizado).digest('hex');

// ── Desafío entre la contraseña y el segundo factor ───────────────────────────────────────────

export const firmarDesafio = (usuarioId: string): string =>
  jwt.sign({ typ: '2fa', id: usuarioId }, process.env.JWT_SECRET as string, { expiresIn: DESAFIO_TTL });

/** Devuelve el id de la persona del desafío, o null si es de otra clase, está alterado o venció. */
export const leerDesafio = (token: unknown): string | null => {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2000) return null;
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET as string, { algorithms: ['HS256'] }) as { typ?: string; id?: unknown };
    return p.typ === '2fa' && typeof p.id === 'string' ? p.id : null;
  } catch {
    return null;
  }
};
