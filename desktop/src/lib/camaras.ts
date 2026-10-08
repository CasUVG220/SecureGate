/**
 * Cámaras de la garita: qué cámara se usa para qué.
 *
 * Una garita real tiene más de una cámara y cada una apunta a otro sitio: la
 * del carril lee la PLACA, la del mostrador lee el DPI y la del cristal lee
 * el QR que el visitante trae en el teléfono. Antes la app abría una sola y
 * servía para todo, que sólo funciona si el agente mueve la cámara a mano.
 *
 * Aquí vive la parte sin React: qué propósitos existen, cómo se guarda la
 * asignación y cómo se resuelve contra los dispositivos que reporta el
 * sistema. Todo es puro para poder probarlo sin hardware.
 *
 * La asignación se guarda en el localStorage del WebView: es configuración
 * del EQUIPO (qué cámara USB está apuntando a dónde), no del agente que
 * tiene el turno, igual que el tema.
 */

export const PROPOSITOS = ['qr', 'placa', 'dpi', 'salida'] as const;
export type Proposito = (typeof PROPOSITOS)[number];

export const NOMBRE_PROPOSITO: Record<Proposito, string> = {
  qr: 'QR de invitación',
  placa: 'Placa de entrada',
  dpi: 'DPI del visitante',
  salida: 'Placa de salida',
};

/** Rótulo corto para las pestañas y los selectores de cada panel. */
export const ROTULO_PROPOSITO: Record<Proposito, string> = {
  qr: 'QR',
  placa: 'Placa',
  dpi: 'DPI',
  salida: 'Salida',
};

/** Cómo debe encuadrar cada propósito: marca la guía de la vista previa. */
export const GUIA_PROPOSITO: Record<Proposito, 'ancha' | 'documento' | 'cuadrada'> = {
  qr: 'cuadrada',
  placa: 'ancha',
  dpi: 'documento',
  salida: 'ancha',
};

export interface Camara {
  deviceId: string;
  /** Vacío hasta que el usuario concede permiso: el navegador oculta el nombre. */
  label: string;
}

/** deviceId por propósito; ausente = "la que decida el sistema". */
export type AsignacionCamaras = Partial<Record<Proposito, string>>;

export const STORAGE_KEY = 'sg_camaras';

export function leerAsignacion(storage: Pick<Storage, 'getItem'> = localStorage): AsignacionCamaras {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: AsignacionCamaras = {};
    for (const p of PROPOSITOS) {
      const v = (parsed as Record<string, unknown>)[p];
      if (typeof v === 'string' && v) out[p] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function guardarAsignacion(a: AsignacionCamaras, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(a));
  } catch {
    /* Sin storage la asignación vive sólo en memoria; la app sigue. */
  }
}

/**
 * Qué dispositivo abrir para un propósito.
 *
 * - Si hay uno asignado y sigue conectado, ese.
 * - Si el asignado desapareció (la desconectaron, o Windows renumeró los
 *   deviceId tras un reinicio) y hay una sola cámara, se usa esa en vez de
 *   dejar la garita a ciegas.
 * - Con varias cámaras y el asignado ausente no se adivina: `undefined` deja
 *   que el sistema elija la predeterminada, y la UI avisa.
 */
export function resolverDispositivo(
  proposito: Proposito,
  asignacion: AsignacionCamaras,
  camaras: Camara[],
): string | undefined {
  const elegido = asignacion[proposito];
  if (elegido && camaras.some(c => c.deviceId === elegido)) return elegido;
  if (camaras.length === 1) return camaras[0].deviceId;
  return undefined;
}

/** `true` si el propósito tiene una cámara asignada que ya no está conectada. */
export function asignacionHuerfana(
  proposito: Proposito,
  asignacion: AsignacionCamaras,
  camaras: Camara[],
): boolean {
  const elegido = asignacion[proposito];
  return !!elegido && camaras.length > 0 && !camaras.some(c => c.deviceId === elegido);
}

/** Nombre legible de una cámara; el navegador no siempre da `label`. */
export function etiquetaCamara(c: Camara, indice: number): string {
  return c.label?.trim() || `Cámara ${indice + 1}`;
}

/**
 * Reparto inicial cuando el equipo nunca se configuró.
 *
 * Con una sola cámara, las cuatro tareas van a ella (es el caso normal hoy y
 * mantiene el comportamiento anterior). Con dos o más se propone un reparto
 * distinto por propósito en el orden que reporta el sistema, para que el
 * agente vea de entrada que puede separarlas; sigue pudiendo cambiarlo.
 */
export function asignacionPorDefecto(camaras: Camara[]): AsignacionCamaras {
  if (camaras.length === 0) return {};
  const out: AsignacionCamaras = {};
  PROPOSITOS.forEach((p, i) => {
    out[p] = camaras[Math.min(i, camaras.length - 1)].deviceId;
  });
  return out;
}

// ── Disposición de los paneles ─────────────────────────────────────────────

/**
 * Cuántas vistas previas ve el agente a la vez.
 *
 * No es sólo estética: cada panel visible mantiene una cámara ENCENDIDA. Una
 * garita con cuatro cámaras en el mismo hub USB puede quedarse sin ancho de
 * banda en el bus y alguna no abrirá (`NotReadableError`), así que 1 y 2
 * siguen siendo opciones legítimas y el agente elige según su equipo.
 */
export const LAYOUTS = [1, 2, 4] as const;
export type Layout = (typeof LAYOUTS)[number];

export const NOMBRE_LAYOUT: Record<Layout, string> = {
  1: 'Una cámara',
  2: 'Dos cámaras',
  4: 'Cuatro cámaras',
};

export const DETALLE_LAYOUT: Record<Layout, string> = {
  1: 'Una vista grande; se cambia de tarea con las pestañas. Es lo más ligero para el equipo.',
  2: 'Dos vistas lado a lado. Cada una elige su tarea.',
  4: 'Las cuatro tareas a la vez. Requiere cuatro cámaras y un equipo que aguante cuatro vídeos.',
};

export interface Disposicion {
  layout: Layout;
  /** Qué tarea ocupa cada panel; su longitud es `layout`. */
  paneles: Proposito[];
}

/**
 * ¿Está la garita en modo salida? Solo con UNA vista de cámara y la tarea «Salida»: el
 * panel de la derecha deja de hablar de entradas. Con varias vistas la pantalla sigue
 * siendo la de registro y la salida es una cámara más.
 */
export const esModoSalida = (d: Disposicion): boolean => d.layout === 1 && d.paneles[0] === 'salida';

export const LAYOUT_STORAGE_KEY = 'sg_camaras_layout';

/** Con un solo panel se arranca en QR, que es el camino rápido. */
export const PANELES_POR_DEFECTO: Record<Layout, Proposito[]> = {
  1: ['qr'],
  2: ['qr', 'placa'],
  4: ['qr', 'placa', 'dpi', 'salida'],
};

export const DISPOSICION_POR_DEFECTO: Disposicion = { layout: 1, paneles: PANELES_POR_DEFECTO[1] };

const esLayout = (v: unknown): v is Layout => LAYOUTS.includes(v as Layout);
const esProposito = (v: unknown): v is Proposito => PROPOSITOS.includes(v as Proposito);

/** Ajusta la lista de paneles al tamaño del layout, conservando lo elegido. */
export function ajustarPaneles(paneles: Proposito[], layout: Layout): Proposito[] {
  const base = PANELES_POR_DEFECTO[layout];
  return base.map((porDefecto, i) => paneles[i] ?? porDefecto);
}

export function leerDisposicion(storage: Pick<Storage, 'getItem'> = localStorage): Disposicion {
  try {
    const raw = storage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return DISPOSICION_POR_DEFECTO;
    const p = JSON.parse(raw) as { layout?: unknown; paneles?: unknown };
    const layout = esLayout(p.layout) ? p.layout : DISPOSICION_POR_DEFECTO.layout;
    const paneles = Array.isArray(p.paneles) ? p.paneles.filter(esProposito) : [];
    return { layout, paneles: ajustarPaneles(paneles, layout) };
  } catch {
    return DISPOSICION_POR_DEFECTO;
  }
}

export function guardarDisposicion(d: Disposicion, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(d));
  } catch {
    /* Sin storage la disposición vive sólo en memoria; la app sigue. */
  }
}

// ── QR ─────────────────────────────────────────────────────────────────────

/** Prefijo de los QR que emite SecureGate (ver frontend/src/pages/GaritaPage). */
export const QR_PREFIX = 'SGQR:';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Código de invitación escrito o pegado A MANO (cuando la cámara no sirve). Acepta lo
 * mismo que lee el escáner (`SGQR:<id>`) y también el id solo, con o sin guiones, con
 * espacios y en mayúsculas o minúsculas. Devuelve el UUID canónico o `null`.
 */
export function idDeCodigoManual(texto: string): string | null {
  const sinPrefijo = texto.trim().replace(/^sgqr:/i, '');
  const hex = sinPrefijo.replace(/[\s-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Extrae el id de invitación de un QR. Devuelve `null` si el código no es de
 * SecureGate: la garita está llena de códigos ajenos (etiquetas, promociones)
 * y el escáner no debe consultarlos al servidor.
 */
export function idDeQr(texto: string): string | null {
  const t = texto.trim();
  if (!t.startsWith(QR_PREFIX)) return null;
  const id = t.slice(QR_PREFIX.length).trim();
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}
