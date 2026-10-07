/**
 * Cámaras de la garita: una, dos o cuatro vistas a la vez, según lo que el
 * agente elija y lo que aguante el equipo.
 *
 * Las cuatro tareas —QR de invitación, placa de entrada, DPI y placa de
 * salida— pueden usar cámaras distintas (ver `lib/camaras.ts`). Cada panel
 * abre la suya; con el layout de una sola vista se cambia de tarea con las
 * pestañas, y sólo esa cámara queda encendida.
 */
import { useCallback, useState } from 'react';
import { Card, cx } from '../ui';
import { CameraPane, Icono } from './CameraPane';
import { CamarasConfigDialog } from './CamarasConfigDialog';
import { useCamaras } from '../../hooks/useCamaras';
import { LAYOUTS, type Disposicion, type Layout, type Proposito } from '../../lib/camaras';

const ICON_GEAR = 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z';

interface Props {
  ocrDisponible: boolean;
  enLinea: boolean;
  disposicion: Disposicion;
  onLayout: (l: Layout) => void;
  onPanel: (indice: number, p: Proposito) => void;
  /** Captura de una tarea; la página decide qué hacer con la foto. */
  onCaptura: (p: Proposito, jpegBase64: string) => Promise<void>;
  onQr: (idInvitacion: string) => Promise<void>;
  qrPausado: boolean;
  /** Tarea cuya captura se está procesando, para bloquear sólo ese botón. */
  ocupado: Proposito | null;
  /** «Escribir placa» del panel de placa: enfoca el campo del formulario. */
  onEscribirPlaca?: () => void;
  /** «Escribir placa» del panel de salida: abre el diálogo de salida vacío. */
  onSalidaManual?: () => void;
}

/** Rejilla por layout: una columna, o dos (que con cuatro paneles da 2×2). */
const REJILLA: Record<Layout, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  4: 'grid-cols-1 sm:grid-cols-2',
};

export function CameraPanel({
  ocrDisponible, enLinea, disposicion, onLayout, onPanel, onCaptura, onQr, qrPausado, ocupado,
  onEscribirPlaca, onSalidaManual,
}: Props) {
  const { camaras, asignacion, asignar, refrescar } = useCamaras();
  const [config, setConfig] = useState(false);
  const { layout, paneles } = disposicion;

  // Antes de conceder el permiso, el sistema oculta los nombres de las
  // cámaras (y a veces la lista entera). En cuanto una se abre, se vuelve a
  // preguntar para poder mostrarlas por su nombre y repartirlas.
  const sinNombres = camaras.length === 0 || camaras.every(c => !c.label);
  const alAbrirCamara = useCallback(() => {
    if (sinNombres) void refrescar();
  }, [sinNombres, refrescar]);

  const abrirConfig = useCallback(() => setConfig(true), []);

  return (
    <Card
      title="Cámaras"
      actions={
        <div className="flex items-center gap-2">
          {/* Disposición: la elige el agente según las cámaras de su garita. */}
          <div role="group" aria-label="Vistas simultáneas" className="flex items-center gap-0.5 rounded-lg bg-gray-500/10 p-0.5">
            {LAYOUTS.map(l => (
              <button
                key={l}
                type="button"
                onClick={() => onLayout(l)}
                aria-pressed={layout === l}
                aria-label={`${l} ${l === 1 ? 'cámara' : 'cámaras'} a la vista`}
                title={`${l} ${l === 1 ? 'cámara' : 'cámaras'} a la vista`}
                className={cx(
                  'h-7 w-8 rounded-md text-xs font-bold tabular-nums transition-colors',
                  layout === l ? 'bg-brand-500 text-brand-ink' : 'text-gray-400 hover:text-gray-200',
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={abrirConfig}
            aria-label="Configurar cámaras"
            title="Configurar cámaras"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-500/12 hover:text-gray-100"
          >
            <Icono d={ICON_GEAR} size={16} />
          </button>
        </div>
      }
    >
      <div className={cx('grid gap-4', REJILLA[layout])}>
        {paneles.map((p, i) => (
          <CameraPane
            // La clave incluye la tarea: cambiarla reinicia el panel y su
            // cámara en vez de reusar el stream de la tarea anterior.
            key={`${i}-${p}`}
            proposito={p}
            camaras={camaras}
            asignacion={asignacion}
            ocrDisponible={ocrDisponible}
            enLinea={enLinea}
            compacto={layout > 1}
            ocupado={ocupado === p}
            onCaptura={onCaptura}
            onQr={onQr}
            qrPausado={qrPausado}
            onCambiarProposito={nuevo => onPanel(i, nuevo)}
            onConfigurar={abrirConfig}
            onCamaraLista={alAbrirCamara}
            onEscribirPlaca={onEscribirPlaca}
            onSalidaManual={onSalidaManual}
          />
        ))}
      </div>

      {layout > 1 && camaras.length > 0 && camaras.length < layout && (
        <p className="mt-4 rounded-lg border border-warning-500/30 bg-warning-500/10 px-3 py-2 text-xs font-medium text-warning-400">
          Hay {camaras.length} {camaras.length === 1 ? 'cámara conectada' : 'cámaras conectadas'} y {layout} vistas:
          varias mostrarán la misma imagen.{' '}
          <button type="button" className="underline underline-offset-4" onClick={abrirConfig}>Configurar</button>
        </p>
      )}

      {config && (
        <CamarasConfigDialog
          camaras={camaras}
          asignacion={asignacion}
          layout={layout}
          onLayout={onLayout}
          onAsignar={asignar}
          onCerrar={() => setConfig(false)}
          onRefrescar={() => void refrescar()}
        />
      )}
    </Card>
  );
}
