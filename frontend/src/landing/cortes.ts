/**
 * Cortes diagonales (polígonos en %, para MediaSlot y los contornos SVG). Son la firma visual de la página: un mismo
 * gesto —la talanquera a medio subir— en el video del hero, las tarjetas y el borde de la sección oscura. En teléfono
 * se suavizan.
 */
export const CORTES = {
  hero: '13 0, 100 0, 100 100, 0 100',
  heroMovil: '0 0, 100 0, 100 94, 0 100',
  /** Tarjeta de la garita: esquina superior derecha achaflanada (≈ 45° sobre una caja 4:5). */
  chaflan: '0 0, 88 0, 100 9.6, 100 100, 0 100',
  /** Tarjeta de administración: borde inferior que sube hacia la derecha, como el del hero. */
  rampa: '0 0, 100 0, 100 86, 0 100',
} as const;

/** "13 0, 100 0" → "13,0 100,0" para <polygon points>. */
export const puntosSvg = (poligono: string) =>
  poligono.split(',').map(p => p.trim().split(/\s+/).join(',')).join(' ');
