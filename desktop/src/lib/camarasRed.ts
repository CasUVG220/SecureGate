/**
 * Cámaras de red (IP y celular): lo que no es React. Textos en español de Guatemala, sin jerga, que dicen qué pasó y qué hacer.
 * El frontend nunca ve usuario ni contraseña de una cámara (viven en el llavero del sistema): ver `CamaraRed` en `lib/tauri.ts`.
 */
import type { CamaraRed, EstadoFuente, TipoCamara } from './tauri';
import type { Proposito } from './camaras';

export const NOMBRE_TIPO: Record<TipoCamara, string> = {
  ip: 'Cámara IP',
  celular: 'Celular como cámara',
  usb: 'Cámara USB',
};

/** La cámara de red a la que está asignada una tarea (una tarea usa una sola cámara), si hay. */
export function camaraDeRedPara(proposito: Proposito, camaras: CamaraRed[]): CamaraRed | undefined {
  return camaras.find(c => c.tipo !== 'usb' && c.tareas.includes(proposito));
}

/** Dirección de la vista previa en el puente local. `version` fuerza al `<img>` a pedirla de nuevo tras una reconexión. */
export function urlVista(info: { puerto: number; token: string }, id: string, version = 0): string {
  return `http://127.0.0.1:${info.puerto}/v/${encodeURIComponent(id)}?t=${info.token}&r=${version}`;
}

export type TonoEstado = 'ok' | 'warn' | 'bad';

export interface EstadoLegible {
  tono: TonoEstado;
  /** Frase corta para la etiqueta del panel. */
  corto: string;
  /** Título y detalle del aviso sobre la imagen cuando no está en vivo (`null` si todo va bien). */
  titulo: string | null;
  detalle: string | null;
  /** Un error permanente no se reintenta solo: hay que pulsar «Reintentar» o corregir la cámara. */
  reintentaSola: boolean;
}

export function estadoLegible(e: EstadoFuente | null): EstadoLegible {
  if (!e || e.estado === 'conectando') {
    return { tono: 'warn', corto: 'Conectando…', titulo: 'Conectando con la cámara…', detalle: 'Puede tardar unos segundos.', reintentaSola: true };
  }
  switch (e.estado) {
    case 'conectada':
      return { tono: 'ok', corto: 'En vivo', titulo: null, detalle: null, reintentaSola: true };
    case 'reconectando':
      return {
        tono: 'warn', corto: 'Reconectando…', reintentaSola: true,
        titulo: 'Se perdió la señal de la cámara',
        detalle: `${e.motivo} Reintentando en ${e.proximo_en_s} s.`,
      };
    case 'caida':
      return e.reintentando
        ? { tono: 'bad', corto: 'Sin señal', reintentaSola: true, titulo: 'La cámara no responde', detalle: `${e.motivo} Sigue intentando; mientras tanto usa otra cámara o la captura manual.` }
        : { tono: 'bad', corto: 'Sin señal', reintentaSola: false, titulo: 'No se pudo usar la cámara', detalle: e.motivo };
    case 'detenida':
    default:
      return { tono: 'warn', corto: 'Apagada', titulo: 'La cámara está apagada', detalle: 'Pulsa «Reintentar» para encenderla.', reintentaSola: false };
  }
}

/** Resumen de una cámara para la lista de configuración. */
export function resumenTipo(c: Pick<CamaraRed, 'tipo' | 'tareas'>, rotuloTarea: (t: string) => string): string {
  const tareas = c.tareas.length ? c.tareas.map(rotuloTarea).join(', ') : 'sin tarea asignada';
  return `${NOMBRE_TIPO[c.tipo]} · ${tareas}`;
}

/** Marcador de posición de la dirección según el tipo, para que la persona vea cómo se escribe. */
export const EJEMPLO_URL: Record<'ip' | 'celular', string> = {
  ip: 'rtsp://192.168.1.50:554/ruta-del-video',
  celular: 'http://192.168.1.60:8080/video',
};
