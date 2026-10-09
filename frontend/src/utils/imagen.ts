/**
 * Conversión de imágenes a data URI para guardarlas en la base de datos.
 *
 * El proyecto no tiene mecanismo de subida de archivos (ni multer ni S3), y el
 * precedente existente es guardar base64 en columnas TEXT (pagos.comprobante).
 * Se sigue ese camino para que la imagen del área sea persistente y visible
 * para todos, pero reescalando antes: sin el downscale, un listado de 10 áreas
 * con fotos de 5 MB devolvería ~50 MB en una sola respuesta.
 */

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_LADO = 1024;
export const CALIDAD_JPEG = 0.8;

export const TIPOS_ACEPTADOS = ['image/jpeg', 'image/png', 'image/webp'];

export class ImagenError extends Error {}

/**
 * Lee un File de imagen, lo reescala a `MAX_LADO` px de lado mayor y devuelve
 * un data URI JPEG (~100-200 KB) listo para guardar en `areas_comunes.imagen_url`.
 */
export async function archivoADataUri(file: File): Promise<string> {
  if (!TIPOS_ACEPTADOS.includes(file.type)) {
    throw new ImagenError('La imagen debe ser JPG, PNG o WebP.');
  }
  if (file.size > MAX_BYTES) {
    throw new ImagenError('La imagen no debe superar 5 MB.');
  }

  const dataUrl = await leerComoDataUrl(file);
  try {
    return await reescalar(dataUrl);
  } catch {
    // Si el canvas no está disponible (p. ej. en tests con jsdom), se guarda
    // el original: mejor una imagen grande que ninguna.
    return dataUrl;
  }
}

function leerComoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve(ev.target?.result as string);
    reader.onerror = () => reject(new ImagenError('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

function reescalar(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, MAX_LADO / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * escala));
      const h = Math.max(1, Math.round(img.height * escala));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new ImagenError('Canvas no disponible.'));

      // Fondo blanco: un PNG con transparencia sobre JPEG saldría negro.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      resolve(canvas.toDataURL('image/jpeg', CALIDAD_JPEG));
    };
    img.onerror = () => reject(new ImagenError('No se pudo procesar la imagen.'));
    img.src = dataUrl;
  });
}

/** ¿El valor guardado es una imagen mostrable (URL http/https o data URI)? */
export function esImagenValida(valor: string | null | undefined): boolean {
  if (!valor) return false;
  return /^(https?:\/\/|data:image\/)/i.test(valor.trim());
}

// ── Logo de la empresa ──────────────────────────────────────────────────────

/** Lado mayor del logo guardado: de sobra para una cabecera, y pesa unas decenas de KB. */
export const LOGO_LADO = 256;
/** Lo mismo que acepta el servidor (`LOGO_MAX_BYTES` del backend). */
export const LOGO_MAX_BYTES = 200 * 1024;

/** Bytes que ocupa una imagen dentro de un data URI en base64. */
export const bytesDeDataUri = (dataUri: string): number => {
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
  const relleno = base64.match(/=+$/)?.[0].length ?? 0;
  return Math.floor((base64.length * 3) / 4) - relleno;
};

/**
 * Convierte el archivo elegido en un logo listo para guardar: lo reescala a `LOGO_LADO` px y conserva la transparencia
 * (PNG) salvo que el original sea JPG. Falla con un mensaje claro si no es una imagen aceptada o si aun reducida
 * pesa más de lo que admite el servidor.
 */
export async function archivoALogo(file: File): Promise<string> {
  if (!TIPOS_ACEPTADOS.includes(file.type)) throw new ImagenError('El logo debe ser JPG, PNG o WebP.');
  if (file.size > MAX_BYTES) throw new ImagenError('El archivo no debe superar 5 MB.');
  const original = await leerComoDataUrl(file);
  let logo: string;
  try {
    logo = await reescalarLogo(original, file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png');
  } catch {
    logo = original;      // sin canvas (tests con jsdom) se manda tal cual; el servidor decide
  }
  if (bytesDeDataUri(logo) > LOGO_MAX_BYTES) {
    throw new ImagenError('El logo pesa demasiado, incluso reducido. Usa una imagen más sencilla (hasta 200 KB).');
  }
  return logo;
}

function reescalarLogo(dataUrl: string, salida: 'image/png' | 'image/jpeg'): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, LOGO_LADO / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * escala));
      const h = Math.max(1, Math.round(img.height * escala));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new ImagenError('Canvas no disponible.'));
      if (salida === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL(salida, salida === 'image/jpeg' ? CALIDAD_JPEG : undefined));
    };
    img.onerror = () => reject(new ImagenError('No se pudo procesar la imagen.'));
    img.src = dataUrl;
  });
}
