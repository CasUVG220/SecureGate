/**
 * Asignación de cámaras: qué dispositivo usa cada tarea de la garita.
 *
 * Es configuración del equipo, no del agente: se guarda en el propio equipo
 * y sobrevive a los cambios de turno.
 */
import { Alert } from '../shared/Alert';
import { Button, Modal, Select } from '../ui';
import {
  DETALLE_LAYOUT, LAYOUTS, NOMBRE_LAYOUT, NOMBRE_PROPOSITO, PROPOSITOS,
  asignacionHuerfana, etiquetaCamara,
  type AsignacionCamaras, type Camara, type Layout, type Proposito,
} from '../../lib/camaras';

interface Props {
  camaras: Camara[];
  asignacion: AsignacionCamaras;
  layout: Layout;
  onLayout: (l: Layout) => void;
  onAsignar: (p: Proposito, deviceId: string) => void;
  onCerrar: () => void;
  onRefrescar: () => void;
}

const AYUDA: Record<Proposito, string> = {
  qr: 'Apunta a donde el visitante muestra el teléfono. Se lee sola, sin pulsar nada.',
  placa: 'Apunta al carril de entrada, a la altura de la placa.',
  dpi: 'Apunta al mostrador, donde el visitante deja el documento.',
  salida: 'Apunta al carril de salida: lee la placa y cierra el acceso abierto.',
};

export function CamarasConfigDialog({ camaras, asignacion, layout, onLayout, onAsignar, onCerrar, onRefrescar }: Props) {
  const sinNombres = camaras.length > 0 && camaras.every(c => !c.label.trim());

  return (
    <Modal
      open
      onClose={onCerrar}
      title="Cámaras de esta garita"
      description="Elige cuántas vistas quieres y qué cámara usa cada tarea. Se guarda en este equipo."
      footer={
        <>
          <Button variant="secondary" onClick={onRefrescar}>Buscar cámaras</Button>
          <Button onClick={onCerrar}>Listo</Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* ── Cuántas vistas a la vez ── */}
        <fieldset>
          <legend className="mb-1.5 block text-xs font-semibold text-gray-300">Vistas simultáneas</legend>
          <div className="grid gap-2">
            {LAYOUTS.map(l => (
              <label
                key={l}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                  layout === l ? 'border-brand-500 bg-brand-500/10' : 'border-gray-600 hover:bg-gray-500/8'
                }`}
              >
                <input
                  type="radio"
                  name="layout-camaras"
                  className="mt-0.5 h-4 w-4 accent-brand-500"
                  checked={layout === l}
                  onChange={() => onLayout(l)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-gray-100">{NOMBRE_LAYOUT[l]}</span>
                  <span className="block text-xs text-gray-400">{DETALLE_LAYOUT[l]}</span>
                </span>
              </label>
            ))}
          </div>
          {layout > camaras.length && camaras.length > 0 && (
            <p className="mt-2 text-xs font-medium text-warning-400">
              Sólo hay {camaras.length} {camaras.length === 1 ? 'cámara conectada' : 'cámaras conectadas'}: las vistas
              de más repetirán imagen.
            </p>
          )}
        </fieldset>

        <hr className="border-gray-700" />

        {camaras.length === 0 ? (
          <Alert tone="warn">
            No se detectó ninguna cámara. Conecta una webcam USB y pulsa «Buscar cámaras». Mientras tanto
            puedes registrar accesos con el formulario manual.
          </Alert>
        ) : (
          <>
            {camaras.length === 1 && (
              <Alert tone="info">
                Este equipo tiene una sola cámara, así que las cuatro tareas la comparten. Al conectar más,
                podrás dedicar una a cada cosa.
              </Alert>
            )}
            {sinNombres && (
              <Alert tone="info">
                Windows todavía no da el nombre de las cámaras: aparecen numeradas. Abre una vista previa
                para identificarlas.
              </Alert>
            )}

            {PROPOSITOS.map(p => (
              <div key={p}>
                <Select
                  label={NOMBRE_PROPOSITO[p]}
                  value={asignacion[p] ?? ''}
                  onChange={e => onAsignar(p, e.target.value)}
                  error={asignacionHuerfana(p, asignacion, camaras)
                    ? 'La cámara asignada ya no está conectada. Elige otra.'
                    : null}
                >
                  <option value="">— cámara predeterminada del sistema —</option>
                  {camaras.map((c, i) => (
                    <option key={c.deviceId} value={c.deviceId}>{etiquetaCamara(c, i)}</option>
                  ))}
                </Select>
                <p className="mt-1.5 text-xs text-gray-400">{AYUDA[p]}</p>
              </div>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
