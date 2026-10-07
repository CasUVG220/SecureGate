import { DosPasosError } from '../services/api';
import { rellenar } from '../components/charts/format';

type Traducir = (clave: string, respaldo?: string) => string;

/**
 * Texto de un error de la verificación en dos pasos, en el idioma elegido. El backend manda un `codigo` estable
 * (`CODIGO_INCORRECTO`, `BLOQUEADO`…); un código desconocido cae al mensaje del servidor y, sin mensaje, a uno genérico.
 */
export function mensajeDosPasos(err: unknown, t: Traducir): string {
  if (err instanceof DosPasosError) {
    switch (err.codigo) {
      case 'CODIGO_INCORRECTO': return t('twofa.err.code');
      case 'PASSWORD_INCORRECTA': return t('twofa.err.password');
      case 'DESAFIO_INVALIDO': return t('twofa.err.expired');
      case 'BLOQUEADO':
        return rellenar(t('twofa.err.locked'), { min: Math.max(1, Math.ceil((err.espera_s ?? 900) / 60)) });
      default: return err.message || t('twofa.err.generic');
    }
  }
  return err instanceof Error && err.message ? err.message : t('twofa.err.generic');
}

/** Contenido del archivo con los códigos de recuperación, para guardarlos o imprimirlos. */
export function textoCodigosRecuperacion(codigos: string[], correo: string, t: Traducir): string {
  return [
    rellenar(t('twofa.recovery.fileTitle'), { correo }),
    t('twofa.recovery.fileNote'),
    '',
    ...codigos,
    '',
  ].join('\n');
}
