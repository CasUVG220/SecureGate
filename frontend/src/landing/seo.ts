/**
 * Etiquetas de buscadores y de vista previa (WhatsApp, Facebook, LinkedIn) del landing. vite.config.ts las inyecta en
 * index.html al compilar: los rastreadores y las vistas previas no ejecutan JavaScript, así que tienen que estar en el
 * HTML estático. Los montos del JSON-LD salen de planes.ts, nunca escritos a mano.
 *
 * `sitio` = VITE_SITE_URL (p. ej. https://securegate.gt, sin barra final). Sin él, og:image queda relativa y se omiten
 * og:url y canonical: sirve en desarrollo, pero las vistas previas de redes necesitan la URL absoluta en producción.
 */
import { rangoMensualidad } from './planes';

export const SEO = {
  titulo: 'SecureGate · Control de acceso para residenciales',
  descripcion:
    'Control de acceso para residenciales en Guatemala: garita que funciona sin internet, invitaciones con QR, ' +
    'lectura de placa y DPI, y bitácora de auditoría.',
  imagen: '/landing/og.jpg',
  imagenAlt: 'SecureGate, control de acceso para residenciales',
} as const;

const escaparAtributo = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** JSON-LD SoftwareApplication. Sin aggregateRating ni review: no hay calificaciones reales que publicar. */
export function jsonLd(sitio: string): Record<string, unknown> {
  const { minima, maxima } = rangoMensualidad();
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'SecureGate',
    applicationCategory: 'SecurityApplication',
    operatingSystem: 'Windows (garita), web',
    inLanguage: 'es-GT',
    description: SEO.descripcion,
    ...(sitio ? { url: `${sitio}/`, image: `${sitio}${SEO.imagen}` } : {}),
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'GTQ',
      lowPrice: minima.toFixed(2),
      highPrice: maxima.toFixed(2),
      description: 'Mensualidad con IVA incluido, según paquete y número de hogares. El primer pago se cotiza aparte.',
    },
  };
}

/** Bloque de <head> que reemplaza a `<!--seo-landing-->` en index.html. */
export function etiquetasSeo(sitio: string): string {
  const base = sitio.replace(/\/+$/, '');
  const a = escaparAtributo;
  const imagen = `${base}${SEO.imagen}`;
  const json = JSON.stringify(jsonLd(base)).replace(/</g, '\\u003c');
  return [
    `<title>${a(SEO.titulo)}</title>`,
    `<meta name="description" content="${a(SEO.descripcion)}" />`,
    ...(base ? [`<link rel="canonical" href="${a(base)}/" />`, `<meta property="og:url" content="${a(base)}/" />`] : []),
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="es_GT" />`,
    `<meta property="og:site_name" content="SecureGate" />`,
    `<meta property="og:title" content="${a(SEO.titulo)}" />`,
    `<meta property="og:description" content="${a(SEO.descripcion)}" />`,
    `<meta property="og:image" content="${a(imagen)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${a(SEO.imagenAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<script type="application/ld+json">${json}</script>`,
  ].join('\n    ');
}
