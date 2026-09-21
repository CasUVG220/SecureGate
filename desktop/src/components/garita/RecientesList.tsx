/**
 * Últimos accesos registrados en este equipo, con su estado de
 * sincronización. Los rechazados muestran el motivo que devolvió el backend.
 */
import { Card, EmptyState, StatusText, type StatusKind } from '../ui';
import { horaLocal } from '../../lib/tiempo';
import { formatear } from '../../lib/placa';
import type { AccesoPendiente } from '../../lib/tauri';

// Sincronizado es lo normal: se lee en tinta tranquila; sólo lo que se sale
// de la norma lleva marca (misma regla que las tablas de la web).
const KIND: Record<AccesoPendiente['estado'], StatusKind> = { sincronizado: 'on', pendiente: 'warn', rechazado: 'bad' };
const TEXTO: Record<AccesoPendiente['estado'], string> = { sincronizado: 'Sincronizado', pendiente: 'Pendiente', rechazado: 'Rechazado' };

const ICON_LIST = 'M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01';

export function RecientesList({ accesos }: { accesos: AccesoPendiente[] }) {
  return (
    <Card
      title="Registrados en este equipo"
      actions={<span className="text-xs font-semibold text-gray-400">{accesos.length}</span>}
      padded={false}
    >
      {accesos.length === 0 ? (
        <EmptyState compact icon={ICON_LIST} title="Sin accesos todavía" description="Los que registres desde esta garita aparecerán aquí con su estado de envío." />
      ) : (
        <ul className="divide-y divide-gray-700">
          {accesos.map(a => (
            <li key={a.id_cliente} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-5 py-3">
              <p className="truncate text-sm font-semibold text-gray-100">{a.nombre_visitante}</p>
              <p className="text-xs tabular-nums text-gray-400">{horaLocal(a.registrado_en)}</p>
              <p className="truncate text-xs text-gray-400">
                {a.residente_casa ?? '—'} · DPI {a.numero_dpi}{a.placa ? ` · ${formatear(a.placa)}` : ''}
                {a.capturado_manualmente && <span className="text-warning-400"> · manual</span>}
              </p>
              <StatusText kind={KIND[a.estado]} className="justify-self-end">
                {TEXTO[a.estado]}{a.estado === 'pendiente' && a.intentos > 0 ? ` (${a.intentos})` : ''}
              </StatusText>
              {a.estado === 'rechazado' && a.ultimo_error && (
                <p className="col-span-2 text-xs text-danger-400">{a.ultimo_error}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
