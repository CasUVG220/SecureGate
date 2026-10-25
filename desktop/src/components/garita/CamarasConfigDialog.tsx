/**
 * Asignación de cámaras: qué dispositivo usa cada tarea de la garita.
 *
 * Es configuración del equipo, no del agente: se guarda en el propio equipo
 * y sobrevive a los cambios de turno.
 */
import { useState } from 'react';
import { Alert } from '../shared/Alert';
import { Button, ConfirmDialog, Modal, Select } from '../ui';
import { api, mensajeDe, type CamaraRed } from '../../lib/tauri';
import { CamaraRedDialog } from './CamaraRedDialog';
import { camaraDeRedPara, resumenTipo } from '../../lib/camarasRed';
import {
  DETALLE_LAYOUT, LAYOUTS, NOMBRE_LAYOUT, NOMBRE_PROPOSITO, PROPOSITOS,
  ROTULO_PROPOSITO, asignacionHuerfana, etiquetaCamara,
  type AsignacionCamaras, type Camara, type Layout, type Proposito,
} from '../../lib/camaras';

interface Props {
  camaras: Camara[];
  asignacion: AsignacionCamaras;
  layout: Layout;
  onLayout: (l: Layout) => void;
  /** `valor`: deviceId de una USB, `red:<id>` de una cámara IP/celular, o vacío (la predeterminada). */
  onAsignar: (p: Proposito, valor: string) => void | Promise<void>;
  /** Cámaras IP y celulares guardadas (sin credenciales). */
  camarasRed?: CamaraRed[];
  onRecargarRed?: () => void | Promise<void>;
  onCerrar: () => void;
  onRefrescar: () => void;
}

const AYUDA: Record<Proposito, string> = {
  qr: 'Apunta a donde el visitante muestra el teléfono. Se lee sola, sin pulsar nada.',
  placa: 'Apunta al carril de entrada, a la altura de la placa.',
  dpi: 'Apunta al mostrador, donde el visitante deja el documento.',
  salida: 'Apunta al carril de salida: lee la placa y cierra el acceso abierto.',
};

export function CamarasConfigDialog({ camaras, asignacion, layout, onLayout, onAsignar, camarasRed = [], onRecargarRed, onCerrar, onRefrescar }: Props) {
  const sinNombres = camaras.length > 0 && camaras.every(c => !c.label.trim());

  // Cámaras IP y celulares (T8): alta, edición y baja.
  const [editando, setEditando] = useState<CamaraRed | 'nueva' | null>(null);
  const [aQuitar, setAQuitar] = useState<CamaraRed | null>(null);
  const [errorRed, setErrorRed] = useState<string | null>(null);
  const hayCamaras = camaras.length > 0 || camarasRed.length > 0;
  const quitar = async () => {
    if (!aQuitar) return;
    try {
      await api.camaras.eliminar(aQuitar.id);
      await onRecargarRed?.();
    } catch (e) {
      setErrorRed(mensajeDe(e));
    } finally {
      setAQuitar(null);
    }
  };

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

        {!hayCamaras ? (
          <Alert tone="warn">
            No se detectó ninguna cámara. Conecta una webcam USB y pulsa «Buscar cámaras», o agrega una cámara IP o un celular
            abajo. Mientras tanto puedes registrar accesos con el formulario manual.
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
                  value={camaraDeRedPara(p, camarasRed) ? `red:${camaraDeRedPara(p, camarasRed)!.id}` : (asignacion[p] ?? '')}
                  onChange={e => void onAsignar(p, e.target.value)}
                  error={!camaraDeRedPara(p, camarasRed) && asignacionHuerfana(p, asignacion, camaras)
                    ? 'La cámara asignada ya no está conectada. Elige otra.'
                    : null}
                >
                  <option value="">— cámara predeterminada del sistema —</option>
                  {camaras.map((c, i) => (
                    <option key={c.deviceId} value={c.deviceId}>{etiquetaCamara(c, i)}</option>
                  ))}
                  {camarasRed.map(c => (
                    <option key={c.id} value={`red:${c.id}`}>{c.nombre} ({c.tipo === 'celular' ? 'celular' : 'cámara IP'})</option>
                  ))}
                </Select>
                <p className="mt-1.5 text-xs text-gray-400">{AYUDA[p]}</p>
              </div>
            ))}
          </>
        )}

        <hr className="border-gray-700" />
        <section aria-label="Cámaras IP y celulares">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-gray-300">Cámaras IP y celulares</h3>
            <Button variant="secondary" size="sm" onClick={() => setEditando('nueva')}>Agregar cámara IP o celular</Button>
          </div>
          {camarasRed.length === 0 ? (
            <p className="text-xs text-gray-400">Todavía no hay ninguna. Sirven para el carril o el mostrador cuando la webcam no alcanza.</p>
          ) : (
            <ul className="divide-y divide-gray-700 rounded-lg border border-gray-600">
              {camarasRed.map(c => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-gray-100">{c.nombre}</span>
                    <span className="block truncate text-xs text-gray-400">{resumenTipo(c, t => ROTULO_PROPOSITO[t as Proposito] ?? t)}</span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditando(c)} aria-label={`Editar ${c.nombre}`}>Editar</Button>
                    <Button variant="ghost" size="sm" onClick={() => setAQuitar(c)} aria-label={`Quitar ${c.nombre}`}>Quitar</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {errorRed && <p role="alert" className="mt-2 text-xs font-medium text-danger-400">{errorRed}</p>}
        </section>
      </div>

      {editando && (
        <CamaraRedDialog
          camara={editando === 'nueva' ? null : editando}
          onGuardada={() => void onRecargarRed?.()}
          onCerrar={() => setEditando(null)}
        />
      )}
      <ConfirmDialog
        open={!!aQuitar}
        title="Quitar cámara"
        message={aQuitar ? `Se quita «${aQuitar.nombre}» de este equipo y se borran su usuario y contraseña guardados. Las tareas que la usaban pasan a la cámara predeterminada.` : null}
        confirmLabel="Quitar cámara"
        tone="danger"
        onConfirm={() => void quitar()}
        onCancel={() => setAQuitar(null)}
      />
    </Modal>
  );
}
