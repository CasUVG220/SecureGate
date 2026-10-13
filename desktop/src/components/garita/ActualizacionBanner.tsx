/**
 * Aviso de «hay una versión nueva» (T13). Aparece solo si el instalador trae la llave de firmas y la búsqueda encontró algo.
 * Actualizar reinicia la app, así que: botón explícito + confirmación, y se bloquea (con el motivo a la vista) mientras haya accesos
 * sin enviar o una captura en curso. Rust vuelve a comprobarlo al instalar.
 */
import { Alert } from '../shared/Alert';
import { Button, useConfirmacion } from '../ui';
import { useActualizaciones } from '../../hooks/useActualizaciones';
import { razonBloqueo } from '../../lib/actualizacion';

interface Props {
  /** Accesos que solo existen en la cola de este equipo. */
  pendientes: number;
  /** ¿Hay una captura (placa, DPI, QR, salida) a medias? */
  capturaEnCurso: boolean;
}

export function ActualizacionBanner({ pendientes, capturaEnCurso }: Props) {
  const { hallazgo, instalando, error, instalar } = useActualizaciones();
  const { confirmar, dialogo } = useConfirmacion();

  if (!hallazgo?.disponible) return null;

  const bloqueo = razonBloqueo(pendientes, capturaEnCurso);

  const actualizar = async () => {
    const ok = await confirmar({
      title: `¿Actualizar a la versión ${hallazgo.version}?`,
      message: 'La app se cerrará y volverá a abrir cuando termine (un par de minutos). No se pierde ningún dato guardado en este equipo.',
      confirmLabel: 'Actualizar ahora',
    });
    if (ok) await instalar(capturaEnCurso);
  };

  return (
    <>
      <Alert tone="info">
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span>
            Hay una versión nueva de SecureGate Garita: <strong>{hallazgo.version}</strong>.
            {bloqueo && <span className="mt-0.5 block text-xs font-normal text-gray-300">{bloqueo}</span>}
            {error && <span role="alert" className="mt-0.5 block text-xs font-semibold text-danger-400">{error}</span>}
          </span>
          <Button size="sm" onClick={actualizar} disabled={!!bloqueo} loading={instalando}>Actualizar ahora</Button>
        </span>
      </Alert>
      {dialogo}
    </>
  );
}
