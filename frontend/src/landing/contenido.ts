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

/**
 * Lo que hace hoy: SOLO lo implementado (verificado contra docs/: qr_sin_conexion, ocr_dpi_local, camaras_ip_diseno,
 * celular_como_camara, verificacion_dos_pasos, refresh_tokens, acciones_sensibles, pagos_saldo, saas_nucleo).
 * `tecnica` es el rótulo con el nombre de lo que usa. Las dos imágenes son 3:2 (1500 × 1000).
 */
export const QUE_HACE = {
  titulo: 'Lo que hace hoy',
  bajada: 'Solo lo que ya está implementado, con el nombre de lo que usa.',
  funciones: [
    {
      nombre: 'Garita que no depende del internet',
      detalle: 'App de escritorio para Windows con base local cifrada. Sin conexión sigue registrando; sincroniza al arrancar, cada 5 minutos y a mano.',
      tecnica: 'SQLCipher',
    },
    {
      nombre: 'Placa y DPI leídos en la garita',
      detalle: 'Reconocimiento de texto (OCR) en el propio equipo. Si la lectura local no alcanza, hay respaldo remoto, que se puede apagar por equipo para que la foto del DPI no salga de la garita.',
      tecnica: 'OCR local',
    },
    {
      nombre: 'Cámaras IP o un teléfono',
      detalle: 'Cámaras ONVIF/RTSP, o un teléfono que transmita video en la red local. Vista de 1, 2 o 4 cámaras.',
      tecnica: 'ONVIF · RTSP · MJPEG',
    },
    {
      nombre: 'Invitaciones con QR sin conexión',
      detalle: 'Cada garita guarda una copia de las invitaciones vigentes y, sin internet, valida fechas, usos y revocación. Al volver la red, cada uso se descuenta una sola vez.',
      tecnica: 'QR',
    },
    {
      nombre: 'Acceso de administradores',
      detalle: 'Verificación en dos pasos con app de autenticación, cierre de la sesión si se reutiliza un token de renovación y límite de intentos.',
      tecnica: 'TOTP',
    },
    {
      nombre: 'Bitácora de auditoría',
      detalle: 'Cada acción sensible queda con persona, fecha, IP y resultado, también los intentos rechazados. Filtros por acción, resultado, persona y fechas.',
      tecnica: 'Auditoría',
    },
    {
      nombre: 'Cobros y pagos',
      detalle: 'Cuotas y cargos por mora. Cada pago, en efectivo o por transferencia, descuenta del saldo de la casa. La pasarela de pago con tarjeta es intercambiable.',
      tecnica: 'Pagos',
    },
    {
      nombre: 'Planes y facturación',
      detalle: 'Planes, suscripciones y facturación mensual de la residencial, y exportación de todos sus datos en CSV.',
      tecnica: 'CSV',
    },
  ],
  imagenes: {
    camaras: {
      archivo: 'seccion-camaras.jpg',
      alt: 'Pantalla de la garita con la vista de cuatro cámaras: entrada, salida, placa y DPI.',
      pie: 'Vista de 4 cámaras en la garita.',
    },
    qr: {
      archivo: 'seccion-qr.jpg',
      alt: 'Agente de garita leyendo con la cámara la invitación con QR que una visita muestra en su teléfono.',
      pie: 'Invitación con QR leída en la garita.',
    },
  },
} as const;

/** Ficha técnica mínima del paquete Licencia. Hoy es un PDF provisional: reemplazalo en public/landing/. */
export const FICHA_TECNICA = '/landing/ficha-tecnica.pdf';

/**
 * Precios: los montos están en planes.ts. Aquí van los nombres y lo que incluye cada paquete (texto del brief de
 * precios). `null` = falta confirmar y se pinta «[POR CONFIRMAR]».
 */
export const PRECIOS = {
  titulo: 'Precios',
  bajada: 'Tres formas de tener SecureGate. Elegí cuántos hogares tiene tu residencial para ver los montos.',
  paquetes: {
    compra: { nombre: 'Compra', resumen: 'El equipo es de la residencial.' },
    alquiler: { nombre: 'Alquiler', resumen: 'El mismo equipo, propiedad de SecureGate.' },
    licencia: { nombre: 'Licencia', resumen: 'Solo el software; el equipo lo pone la residencial.' },
  },
  /** Equipo que va con Compra y con Alquiler. */
  equipo: [
    'Barrera vehicular de 3 m',
    '3 cámaras IP: placa, panorámica y DPI',
    'Lector UHF para tags',
    'Mini PC y monitor de 24"',
    'Switch PoE, UPS, gabinete y cableado',
  ],
  filas: {
    instalacion: {
      compra: 'Instalación, configuración del software y capacitación',
      alquiler: 'Instalación reducida',
      licencia: 'Instalación y configuración del software, y capacitación',
    },
    software: { compra: 'Incluido', alquiler: 'Incluido', licencia: 'Incluido' },
    mantenimiento: { compra: 'Incluido', alquiler: 'Incluido, con reposición', licencia: 'No incluido' },
    contrato: { compra: null, alquiler: '36 meses', licencia: null },
  },
  notaIva: 'Montos en quetzales, con IVA (12 %) incluido.',
  notaReferencial: 'Los precios del equipo son referenciales y se confirman en la cotización.',
  aMedida: 'Cotización a medida',
} as const;

/**
 * Preguntas frecuentes. `respuesta`: lo que se sabe y se puede afirmar; `pendiente`: lo que falta confirmar (se pinta
 * «[POR CONFIRMAR: …]»); `enlace`: opcional. Una pregunta sin respuesta conocida lleva solo `pendiente`.
 */
export const PREGUNTAS: ReadonlyArray<{
  pregunta: string;
  respuesta?: string;
  pendiente?: string;
  enlace?: { href: string; texto: string };
}> = [
  {
    pregunta: '¿Qué pasa si se cae el internet?',
    respuesta:
      'La garita sigue registrando en su base local cifrada (SQLCipher) y valida las invitaciones con QR con la copia que guarda de las vigentes. ' +
      'Cuando vuelve la conexión sube lo pendiente, y cada uso de un QR se descuenta una sola vez. El portal del residente y el panel de administración sí necesitan internet.',
  },
  {
    pregunta: '¿Quién es dueño de los datos?',
    respuesta: 'La residencial. Desde el panel, el administrador descarga todos los datos de la residencial en archivos CSV cuando quiera.',
    pendiente: 'dónde se alojan los datos y cuánto tiempo se conservan al terminar el contrato',
  },
  {
    pregunta: '¿Qué equipo se necesita?',
    respuesta:
      'Con Compra o Alquiler el equipo va incluido: barrera vehicular de 3 m, tres cámaras IP (placa, panorámica y DPI), lector UHF para tags, ' +
      'mini PC con monitor de 24", switch PoE, UPS, gabinete y cableado. Con Licencia lo pone la residencial y tiene que cumplir la ficha técnica mínima; ' +
      'las cámaras deben funcionar con ONVIF o RTSP, y un teléfono también puede servir de cámara.',
    enlace: { href: FICHA_TECNICA, texto: 'Ficha técnica mínima (PDF)' },
  },
  {
    pregunta: '¿Cuánto tarda la instalación?',
    pendiente: 'días de instalación por caseta, desde la firma del contrato',
  },
  {
    pregunta: '¿Qué incluye el mantenimiento?',
    respuesta:
      'En Compra, la mensualidad cubre el software, el soporte, las actualizaciones y el mantenimiento del equipo. En Alquiler cubre además la reposición del equipo. ' +
      'En Licencia hay soporte y actualizaciones del software, sin mantenimiento de hardware.',
    pendiente: 'frecuencia de las visitas de mantenimiento y tiempo de respuesta ante una falla',
  },
  {
    pregunta: '¿Cuál es el contrato mínimo del alquiler?',
    respuesta: '36 meses. Durante el contrato el equipo es de SecureGate y la renta cubre su mantenimiento y reposición.',
  },
  {
    pregunta: '¿Qué cuenta como un hogar para el cobro?',
    pendiente: 'qué cuenta como hogar (por ejemplo, lotes sin construir o casas desocupadas)',
  },
  {
    pregunta: '¿Cómo se pide factura?',
    pendiente: 'cómo se pide la factura y con qué datos',
  },
];

/**
 * Contacto. `whatsapp` y `correo` en `null` = faltan: la página los muestra como [POR CONFIRMAR] y el botón de
 * WhatsApp queda deshabilitado. El WhatsApp va en formato internacional, solo dígitos (p. ej. 502 y los 8 del número).
 */
export const CONTACTO = {
  titulo: 'Pedí una demo',
  bajada:
    'Te escribimos para coordinar una demostración con la administración o la junta directiva. ' +
    'Con el número de hogares preparamos la cotización.',
  whatsapp: null as string | null,
  correo: null as string | null,
  /** Opciones del select, alineadas con los tramos de la tabla de precios (planes.ts). */
  hogares: [
    { valor: '50', texto: 'Hasta 50 hogares' },
    { valor: '100', texto: 'De 51 a 100 hogares' },
    { valor: '200', texto: 'De 101 a 200 hogares' },
    { valor: '500', texto: 'De 201 a 500 hogares' },
    { valor: '1000', texto: 'De 501 a 1,000 hogares' },
    { valor: '1000+', texto: 'Más de 1,000 hogares' },
  ],
  mensajes: {
    exito: 'Recibimos tu solicitud. Te vamos a escribir para coordinar la demo.',
    invalido: 'Revisá los campos marcados.',
    limite: 'Recibimos varias solicitudes desde tu conexión. Intentá de nuevo en una hora o escribinos por WhatsApp.',
    error: 'No pudimos enviar tu solicitud. Revisá tu conexión e intentá de nuevo, o escribinos por WhatsApp.',
  },
} as const;

/** Pie de página. `razonSocial` en `null` = falta y se pinta [POR CONFIRMAR]. */
export const PIE = {
  lema: 'Control de acceso para residenciales en Guatemala.',
  razonSocial: null as string | null,
  /** Entradas de la app (las mismas rutas que RUTA_PORTAL en src/routing/portales.ts). */
  app: [
    { href: '/personal', texto: 'Ingresar (administración)' },
    { href: '/residente', texto: 'Portal del residente' },
  ],
} as const;
