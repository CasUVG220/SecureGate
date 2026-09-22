/**
 * Texto para el agente a partir de un resultado de apertura. Puro, para
 * probarlo sin Tauri. `null` = no hay driver: no se dice nada porque la
 * apertura física es opcional y no debe hacer ruido en garitas sin relé.
 */
import type { ResultadoApertura, TalanqueraError } from './tauri';

export function textoApertura(r: ResultadoApertura): string | null {
  if (r.abierta) return `Talanquera abierta (${r.driver}).`;
  if (!r.error || r.error.tipo === 'sin_driver') return null;
  return `No se pudo abrir automáticamente — abre manual. ${detalleError(r.error)}`;
}

export function detalleError(e: TalanqueraError): string {
  const d = e.detalle ? ` (${e.detalle})` : '';
  switch (e.tipo) {
    case 'no_disponible': return `El relé no está conectado${d}.`;
    case 'timeout': return `El relé no respondió a tiempo${d}.`;
    case 'envio': return `Fallo al enviar el comando${d}.`;
    case 'config': return `Configuración inválida${d}.`;
    case 'no_soportado': return `No soportado en esta versión${d}.`;
    case 'sin_driver': return 'No hay hardware configurado.';
  }
}
