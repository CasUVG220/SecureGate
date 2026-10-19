/**
 * ANPR continuo (Sprint 10): lo que no es React. Textos en español de Guatemala, sin jerga, que dicen qué pasó y qué hacer;
 * geometría de la superposición y del área (ROI) del carril. Ver docs/anpr_continuo.md.
 */
import type {
  Carril, ConfigActuador, EstadoCarril, EstadoEventoAnpr, EventoAnpr, ModoCarril, PistaAnpr, SentidoCarril,
} from './tauri';
import { formatear } from './placa';

export const MODO_TEXTO: Record<ModoCarril, string> = {
  apagado: 'Apagado',
  verificacion: 'Verificación (el agente confirma)',
  automatico: 'Automático (el residente entra solo)',
};

export const SENTIDO_TEXTO: Record<SentidoCarril, string> = { entrada: 'Entrada', salida: 'Salida' };

/** Modo con que se activa un carril apagado (decisión del equipo; ver docs/anpr_continuo.md §2). */
export const MODO_AL_ACTIVAR: ModoCarril = 'automatico';

export type TonoAnpr = 'ok' | 'warn' | 'bad' | 'info';

export const ESTADO_EVENTO: Record<EstadoEventoAnpr, { texto: string; tono: TonoAnpr }> = {
  automatico: { texto: 'Entró automático', tono: 'ok' },
  verificacion_pendiente: { texto: 'Verificar', tono: 'warn' },
  alerta_lista_negra: { texto: 'Lista negra', tono: 'bad' },
  ilegible: { texto: 'Placa ilegible', tono: 'warn' },
  resuelto: { texto: 'Resuelto', tono: 'info' },
  descartado: { texto: 'Descartado', tono: 'info' },
};

/** Por qué un evento espera al agente (`MotivoVerificacion` de Rust). */
const MOTIVO: Record<string, string> = {
  ilegible: 'No se pudo leer la placa.',
  lectura_corregida: 'La lectura necesitó corregir caracteres: confirma la placa.',
  desconocida: 'La placa no es de un vehículo autorizado.',
  no_autorizado: 'El vehículo está dado de baja.',
  no_vigente: 'La autorización del vehículo no está vigente hoy.',
  residente_inactivo: 'El residente ya no está activo.',
  licencia_bloqueada: 'La licencia del equipo no permite abrir sola (empresa suspendida o sin contacto).',
  confirmar_residente: 'Vehículo autorizado: confirma para que entre.',
};

export function textoMotivo(e: Pick<EventoAnpr, 'estado' | 'motivo'>): string | null {
  if (e.estado === 'alerta_lista_negra') return e.motivo ? `En lista negra: ${e.motivo}. No se abre.` : 'En lista negra. No se abre.';
  if (!e.motivo) return null;
  return MOTIVO[e.motivo] ?? e.motivo;
}

/** ¿El evento espera algo del agente? (mismo criterio que `EventoAnpr::pendiente` en Rust). */
export const pendiente = (e: Pick<EventoAnpr, 'estado'>): boolean =>
  e.estado === 'verificacion_pendiente' || e.estado === 'ilegible' || e.estado === 'alerta_lista_negra';

/** Placa para mostrar: la confirmada, o la probable entre signos de duda; «Sin placa» si no hay nada. */
export function placaVisible(e: Pick<EventoAnpr, 'placa' | 'placa_probable'>): string {
  if (e.placa) return formatear(e.placa);
  if (e.placa_probable) return `¿${formatear(e.placa_probable)}?`;
  return 'Sin placa';
}

/** Resultado de la talanquera de un evento, o null si no se mandó abrir. */
export function textoApertura(apertura: string | null): { texto: string; tono: TonoAnpr } | null {
  if (!apertura) return null;
  if (apertura === 'abierta') return { texto: 'Talanquera abierta', tono: 'ok' };
  if (apertura === 'simulada') return { texto: 'Talanquera abierta (simulada)', tono: 'info' };
  const detalle = apertura.replace(/^fallo:\s*/, '');
  return { texto: `La talanquera no respondió${detalle ? `: ${detalle}` : ''}`, tono: 'bad' };
}

export function textoEstadoCarril(e: EstadoCarril | undefined, modo: ModoCarril, pausado: boolean): { texto: string; tono: TonoAnpr } {
  if (pausado) return { texto: 'Pausado', tono: 'warn' };
  if (modo === 'apagado') return { texto: 'Apagado', tono: 'info' };
  switch (e?.estado) {
    case 'activo': return { texto: `Vigilando · ${e.fps >= 1 ? Math.round(e.fps) : e.fps.toFixed(1)} fps`, tono: 'ok' };
    case 'sin_camara': return { texto: `Sin cámara: ${e.motivo}`, tono: 'bad' };
    case 'error': return { texto: `Error: ${e.motivo}`, tono: 'bad' };
    case 'iniciando': return { texto: 'Iniciando…', tono: 'warn' };
    case 'detenido':
    default: return { texto: 'Detenido', tono: 'warn' };
  }
}

/** Confianza como porcentaje entero («97 %»), o «—». */
export const porcentaje = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)} %`;

// ── Superposición en vivo ────────────────────────────────────────────────────────────────────────

const COLOR_PISTA: Record<string, string> = {
  DETECTADO: 'rgb(var(--c-neutral-400))',
  SIGUIENDO: 'rgb(var(--c-brand-400))',
  LEYENDO: 'rgb(var(--c-warning-400))',
  CONFIRMADO: 'rgb(var(--c-success-400))',
  ILEGIBLE: 'rgb(var(--c-danger-400))',
};

export const colorPista = (estado: string): string => COLOR_PISTA[estado] ?? 'rgb(var(--c-neutral-400))';

const ESTADO_PISTA: Record<string, string> = {
  DETECTADO: 'Detectado', SIGUIENDO: 'Siguiendo', LEYENDO: 'Leyendo', CONFIRMADO: 'Confirmado', ILEGIBLE: 'Ilegible',
};

/** Rótulo de una caja: la placa si ya hay, si no el estado. */
export const rotuloPista = (p: PistaAnpr): string => (p.placa ? formatear(p.placa) : ESTADO_PISTA[p.estado] ?? p.estado);

/** Caja de una pista en porcentaje del cuadro (para posicionarla sobre la imagen sin importar su tamaño en pantalla). */
export function cajaRelativa(p: PistaAnpr, tamano: [number, number]): { left: number; top: number; width: number; height: number } {
  const [w, h] = tamano;
  const lim = (v: number) => Math.min(100, Math.max(0, v));
  return {
    left: lim((p.bbox.x / w) * 100),
    top: lim((p.bbox.y / h) * 100),
    width: lim((p.bbox.w / w) * 100),
    height: lim((p.bbox.h / h) * 100),
  };
}

/** Puntos del polígono para un `<svg viewBox="0 0 100 100">`. Vacío = todo el cuadro. */
export function puntosSvg(roi: [number, number][]): string {
  const pts = roi.length >= 3 ? roi : [[0, 0], [1, 0], [1, 1], [0, 1]];
  return pts.map(([x, y]) => `${(x * 100).toFixed(2)},${(y * 100).toFixed(2)}`).join(' ');
}

// ── Área del carril (ROI) ────────────────────────────────────────────────────────────────────────

export const MAX_PUNTOS_ROI = 32;

/** Punto normalizado (0–1, 4 decimales) de un clic sobre un elemento de `rect`. */
export function puntoDeClic(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): [number, number] {
  const r = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;
  return [r((clientX - rect.left) / rect.width), r((clientY - rect.top) / rect.height)];
}

/** Por qué no se puede guardar este área, o null. Mismas reglas que `carriles::validar` en Rust. */
export function problemaRoi(roi: [number, number][]): string | null {
  if (roi.length === 0) return null;
  if (roi.length < 3) return 'Marca al menos 3 puntos, o deja «todo el cuadro».';
  if (roi.length > MAX_PUNTOS_ROI) return `El área admite hasta ${MAX_PUNTOS_ROI} puntos.`;
  // Área del polígono (fórmula del cordón): una línea o puntos repetidos no encierran nada.
  let a = 0;
  for (let i = 0; i < roi.length; i++) {
    const [x1, y1] = roi[i];
    const [x2, y2] = roi[(i + 1) % roi.length];
    a += x1 * y2 - x2 * y1;
  }
  if (Math.abs(a) / 2 < 0.01) return 'El área marcada es demasiado chica: abarca el carril completo.';
  return null;
}

// ── Carril nuevo y actuador ──────────────────────────────────────────────────────────────────────

/** Identificador para un carril nuevo (letras, números y guion, como exige Rust). */
export function idNuevo(existentes: string[], ahora = Date.now()): string {
  let id = `carril-${ahora.toString(36)}`;
  for (let i = 2; existentes.includes(id); i++) id = `carril-${ahora.toString(36)}-${i}`;
  return id;
}

/** Un carril nuevo siempre nace APAGADO (sección 0 del sprint). */
export function carrilNuevo(existentes: Carril[], camaraId: string | null = null): Carril {
  return {
    id: idNuevo(existentes.map(c => c.id)),
    nombre: `Carril ${existentes.length + 1}`,
    camara_id: camaraId,
    sentido: 'entrada',
    modo: 'apagado',
    roi: [],
    umbrales: {},
    actuador: { tipo: 'simulado' },
  };
}

export const ACTUADOR_TEXTO: Record<ConfigActuador['tipo'], string> = {
  simulado: 'Simulada (no mueve nada: solo registra y avisa)',
  rele_http: 'Relé por red (HTTP) de este carril',
  talanquera: 'El relé de talanquera de este equipo (Configuración de hardware)',
};

export const RELE_DEFECTO: Extract<ConfigActuador, { tipo: 'rele_http' }> = {
  tipo: 'rele_http', url: '', metodo: 'get', timeout_ms: 2000, cuerpo: null,
};

/** Validación rápida en pantalla de la URL del relé (Rust valida de nuevo, con la lista de redes permitidas). */
export function problemaUrlRele(url: string): string | null {
  const t = url.trim();
  if (!t) return 'Escribe la dirección del relé.';
  let u: URL;
  try { u = new URL(t); } catch { return 'La dirección del relé no es válida.'; }
  if (u.protocol !== 'http:') return 'El relé se configura con http:// (en la red local de la garita).';
  if (u.username || u.password) return 'La dirección del relé no puede llevar usuario ni contraseña.';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !host.includes(':')) return 'Escribe la IP del relé (por ejemplo http://192.168.1.50/abrir), no un nombre.';
  return null;
}

/** Tono de sonido de la alerta de lista negra (Web Audio, sin archivos). Sin audio disponible no hace nada. */
export function sonarAlerta(): void {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    // Tres pitidos de 180 ms a 880/660 Hz: se distingue de cualquier sonido del sistema.
    [0, 0.25, 0.5].forEach((t, i) => {
      const osc = ctx.createOscillator();
      const gan = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = i % 2 ? 660 : 880;
      gan.gain.value = 0.15;
      osc.connect(gan).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.18);
    });
    window.setTimeout(() => void ctx.close().catch(() => {}), 1200);
  } catch {
    /* sin audio: la alerta visual basta */
  }
}
