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

/**
 * Las tres partes del sistema. Las imágenes son 4:5 (1200 × 1500); cada tarjeta las recorta distinto a propósito.
 * Los `alt` describen lo que DEBE mostrar cada foto: si la tuya muestra otra cosa, cambiá el texto.
 */
export const TARJETAS = [
  {
    clave: 'garita',
    titulo: 'Garita',
    soporte: 'App de escritorio · Windows',
    texto: 'Lee placa y DPI, valida invitaciones con QR y sigue registrando sin internet.',
    imagen: 'card-garita.jpg',
    alt: 'Agente en la caseta frente a la pantalla de SecureGate, con la placa de un vehículo leída por la cámara.',
  },
  {
    clave: 'portal',
    titulo: 'Portal del residente',
    soporte: 'Web, en el teléfono',
    texto: 'Cada residente invita con QR, avisa de sus visitas y consulta y paga sus cuotas.',
    imagen: 'card-portal.jpg',
    alt: 'Residente mostrando en su teléfono la invitación con QR de una visita.',
  },
  {
    clave: 'admin',
    titulo: 'Administración',
    soporte: 'Web',
    texto: 'Residentes, cuotas y mora, reglas de QR, lista negra y reportes de entradas.',
    imagen: 'card-admin.jpg',
    alt: 'Panel de administración de SecureGate con la lista de residentes y el estado de sus cuotas.',
  },
] as const;

/**
 * Cómo funciona. Cada paso deja un dato en el registro; `campo` dice cuál, y el registro de ejemplo de abajo los junta.
 * Los datos del ejemplo son ficticios y la página lo dice.
 */
export const COMO_FUNCIONA = {
  titulo: 'Cómo funciona',
  bajada: 'De la invitación al registro, en cuatro pasos. Cada paso deja su dato en la bitácora.',
  pasos: [
    {
      titulo: 'El residente invita',
      texto: 'Desde el portal crea una invitación con QR, con fechas de vigencia y número de usos.',
      campo: 'autorizó',
    },
    {
      titulo: 'La garita lee placa o DPI',
      texto: 'La cámara lee la placa y el DPI se lee en el propio equipo. Si la lectura tiene dudas, el agente la confirma antes de registrar.',
      campo: 'placa',
    },
    {
      titulo: 'Se autoriza o se rechaza',
      texto: 'Pasa con una invitación vigente, un aviso de visita o la decisión del agente. Una invitación vencida o agotada, o alguien en la lista negra, no pasa.',
      campo: 'resultado',
    },
    {
      titulo: 'Queda en la bitácora',
      texto: 'Hora, garita, placa o DPI, a qué casa va y quién autorizó. Sin internet se guarda cifrado en la garita y se sube al volver la conexión.',
      campo: 'hora',
    },
  ],
  /** Registro de ejemplo (ficticio). La placa usa el formato de la app (utils/placa.ts). */
  ejemplo: {
    rotulo: 'Ejemplo de registro · datos ficticios',
    hora: '18:42:07',
    garita: 'Garita 1 · entrada',
    destino: 'Casa 14',
    autorizo: 'Invitación con QR del residente',
    resultado: 'Autorizado',
  },
} as const;
