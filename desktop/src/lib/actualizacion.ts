/**
 * Política de actualizaciones de la garita (T13). Espejo en pantalla de `src-tauri/src/actualizador.rs`: Rust es quien decide de verdad
 * (rechaza instalar con accesos sin enviar), esto solo evita ofrecer un botón que sabemos que será rechazado y explica por qué.
 */

/** Primera búsqueda a los 30 s de abrir la app (que no compita con el arranque del OCR y la sincronización) y luego cada 6 h. */
export const PRIMERA_BUSQUEDA_MS = 30_000;
export const INTERVALO_BUSQUEDA_MS = 6 * 60 * 60 * 1000;

/** Por qué NO se puede actualizar ahora, o `null` si se puede. La captura se evalúa primero (la persona la resuelve en segundos). */
export function razonBloqueo(pendientes: number, capturaEnCurso: boolean): string | null {
  if (capturaEnCurso) return 'Termina la captura en curso para poder actualizar.';
  if (pendientes > 0) {
    return `Hay ${pendientes} acceso${pendientes === 1 ? '' : 's'} sin enviar al servidor. Podrás actualizar cuando se sincronicen.`;
  }
  return null;
}
