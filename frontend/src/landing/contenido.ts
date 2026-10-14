/**
 * Textos y datos del landing. Todo lo que se lee en la página sale de aquí (los precios, de planes.ts), para que
 * cambiar una frase no obligue a leer componentes. Guía: docs/landing.md.
 *
 * Reglas del texto (criterio de aceptación del landing):
 *   - Español de Guatemala, con VOS en todo el landing («pedí», «escribinos», «elegí»). Nada de tuteo mezclado.
 *     Los nombres de las cosas son los del glosario de la app (docs/glosario.md): «invitación con QR», «aviso de
 *     visita», «verificación en dos pasos», «entradas», «lista negra».
 *   - Solo lo que ya hace el sistema, dicho como lo diría quien lo construyó: protocolos, números y nombres reales.
 *     Sin superlativos, sin testimonios, sin cifras de clientes. Una frase que no dice algo verificable, se borra.
 *   - Lo que falta confirmar es `null` (o va en `pendiente`) y se pinta como «[POR CONFIRMAR: …]». Nunca se
 *     rellena con un dato inventado.
 */

/** Ruta de acceso de la app (RUTA_PORTAL.personal). Desde ahí la sesión decide el portal, como siempre. */
export const RUTA_INGRESAR = '/personal';

export const NAVEGACION = [
  { id: 'como-funciona', texto: 'Cómo funciona' },
  { id: 'que-hace', texto: 'Qué hace' },
  { id: 'precios', texto: 'Precios' },
  { id: 'preguntas', texto: 'Preguntas' },
] as const;

export const HERO = {
  titular: 'Quién entra, a qué hora y quién lo autorizó.',
  remate: 'Todo registrado.',
  bajada:
    'Control de acceso para residenciales en Guatemala: garita, portal del residente y administración. ' +
    'Si se cae el internet, la garita sigue registrando.',
  video: {
    poster: 'hero-poster.jpg',
    mp4: 'hero.mp4',
    webm: 'hero.webm',
    ancho: 1920,
    alto: 1080,
    // Describe lo que DEBE mostrar el video/póster. Si el archivo que pongás muestra otra cosa, cambiá este texto.
    alt: 'Garita de una residencial: la cámara lee la placa de un vehículo y la barrera se levanta.',
  },
} as const;
