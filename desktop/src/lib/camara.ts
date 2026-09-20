/**
 * Traducción de los fallos de `getUserMedia` a algo que el agente pueda leer
 * en pantalla y actuar. Es una función pura para poder testearla sin cámara.
 *
 * Los nombres de error son los del estándar (DOMException.name):
 * https://developer.mozilla.org/docs/Web/API/MediaDevices/getUserMedia#exceptions
 */

export type EstadoCamara = 'iniciando' | 'activa' | 'sin_camara' | 'denegada' | 'ocupada' | 'error';

export interface FalloCamara {
  estado: Exclude<EstadoCamara, 'iniciando' | 'activa'>;
  /** Título corto para la vista previa. */
  titulo: string;
  /** Qué hacer al respecto. */
  detalle: string;
  /** Nombre técnico del error, para el log y el reporte a soporte. */
  codigo: string;
}

export type Plataforma = 'mac' | 'windows' | 'otra';

export function detectarPlataforma(ua: string = navigator.userAgent): Plataforma {
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  if (/Windows/i.test(ua)) return 'windows';
  return 'otra';
}

const RUTA_PERMISO: Record<Plataforma, string> = {
  mac: 'Configuración del Sistema › Privacidad y seguridad › Cámara',
  windows: 'Configuración › Privacidad y seguridad › Cámara',
  otra: 'la configuración de privacidad del sistema',
};

export function describirErrorCamara(err: unknown, plataforma: Plataforma = detectarPlataforma()): FalloCamara {
  const nombre = (err as { name?: string } | null)?.name ?? '';
  const mensaje = err instanceof Error ? err.message : String(err ?? '');
  const donde = RUTA_PERMISO[plataforma];

  switch (nombre) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        estado: 'denegada',
        codigo: nombre,
        titulo: 'Permiso de cámara denegado',
        detalle: `Actívalo para SecureGate Garita en ${donde} y pulsa "Reintentar".`,
      };
    case 'SecurityError':
      // Contexto no seguro (el WebView sirvió la app desde un origen que el
      // navegador no considera confiable). Es un error de empaquetado, no
      // del agente: se dice tal cual para que llegue a soporte.
      return {
        estado: 'denegada',
        codigo: nombre,
        titulo: 'El sistema bloqueó la cámara',
        detalle: 'El origen de la app no permite usar la cámara (SecurityError). Reporta esto a soporte; mientras tanto usa la captura manual.',
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        estado: 'sin_camara',
        codigo: nombre,
        titulo: 'No se detectó ninguna cámara',
        detalle: 'Conecta una webcam USB y pulsa "Reintentar". Puedes registrar el acceso con el formulario manual.',
      };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return {
        estado: 'ocupada',
        codigo: nombre,
        titulo: 'La cámara no responde',
        detalle: 'Puede estar en uso por otra aplicación (Zoom, Teams, otra ventana). Ciérrala y pulsa "Reintentar".',
      };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return {
        estado: 'sin_camara',
        codigo: nombre,
        titulo: 'La cámara no soporta la resolución pedida',
        detalle: 'Se reintentará con la configuración básica. Si persiste, usa la captura manual.',
      };
    case 'TypeError':
      return {
        estado: 'error',
        codigo: nombre,
        titulo: 'Este entorno no expone cámaras',
        detalle: 'getUserMedia no está disponible en este WebView. Usa la captura manual.',
      };
    default:
      return {
        estado: 'error',
        codigo: nombre || 'Desconocido',
        titulo: 'La cámara falló',
        detalle: mensaje ? `${mensaje}. Usa la captura manual.` : 'Usa la captura manual.',
      };
  }
}
