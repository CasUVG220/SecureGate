/**
 * Últimos accesos registrados en este equipo, con su estado de
 * sincronización. Los rechazados muestran el motivo que devolvió el backend.
 */
import { useMemo, useState } from 'react';
import { Button, Card, EmptyState, Input, StatusText, type StatusKind } from '../ui';
import { horaLocal } from '../../lib/tiempo';
import { formatear, normalizar } from '../../lib/placa';
import type { AccesoPendiente } from '../../lib/tauri';

// Sincronizado es lo normal: se lee en tinta tranquila; sólo lo que se sale
// de la norma lleva marca (misma regla que las tablas de la web).
const KIND: Record<AccesoPendiente['estado'], StatusKind> = { sincronizado: 'on', pendiente: 'warn', rechazado: 'bad' };
const TEXTO: Record<AccesoPendiente['estado'], string> = { sincronizado: 'Sincronizado', pendiente: 'Pendiente', rechazado: 'Rechazado' };

const ICON_LIST = 'M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01';
const ICON_SEARCH = 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35';

/** Sin búsqueda se muestran los más recientes; al buscar se recorre todo lo que el equipo conserva. */
const VISIBLES_SIN_BUSQUEDA = 30;

interface Props {
  accesos: AccesoPendiente[];
  /** Sin conexión no se puede cerrar una salida: el servidor es quien la registra. */
  enLinea?: boolean;
  /** Si se pasa, cada acceso ya enviado ofrece «Dar salida» (sin cámara ni placa). */
  onSalida?: (acceso: AccesoPendiente) => void;
}

/**
 * Por qué no se puede dar salida a esta fila, o `null` si se puede. Se muestra en
 * pantalla junto al botón apagado.
 */
export function motivoSinSalida(a: AccesoPendiente, enLinea: boolean): string | null {
  if (a.estado === 'rechazado') return null; // nunca entró: no hay nada que cerrar (y no se ofrece el botón)
  if (a.estado === 'pendiente' || !a.registro_id) return 'Aún no se envía al servidor; podrás darle salida cuando se sincronice.';
  if (!enLinea) return 'Sin conexión: la salida se registra en el servidor.';
  return null;
}

export function RecientesList({ accesos, enLinea = true, onSalida }: Props) {
  const [busqueda, setBusqueda] = useState('');

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return accesos.slice(0, VISIBLES_SIN_BUSQUEDA);
    const qPlaca = normalizar(busqueda);
    return accesos.filter(a =>
      `${a.nombre_visitante} ${a.numero_dpi} ${a.residente_casa ?? ''}`.toLowerCase().includes(q)
      || (qPlaca.length >= 2 && normalizar(a.placa ?? '').includes(qPlaca)));
  }, [accesos, busqueda]);

  return (
    <Card
      title="Registrados en este equipo"
      actions={<span className="text-xs font-semibold text-gray-400">{filtrados.length}</span>}
      padded={false}
    >
      {accesos.length > 0 && (
        <div className="border-b border-gray-700 px-5 py-3">
          <Input
            icon={ICON_SEARCH}
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, DPI, placa o casa…"
            aria-label="Buscar entre los registrados en este equipo"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      )}
      {accesos.length === 0 ? (
        <EmptyState compact icon={ICON_LIST} title="Sin accesos todavía" description="Los que registres desde esta garita aparecerán aquí con su estado de envío." />
      ) : filtrados.length === 0 ? (
        <EmptyState compact icon={ICON_SEARCH} title="Sin coincidencias" description="Ningún acceso registrado en este equipo coincide con la búsqueda." />
      ) : (
        <ul className="divide-y divide-gray-700">
          {filtrados.map(a => {
            const motivo = onSalida ? motivoSinSalida(a, enLinea) : null;
            return (
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
              {onSalida && a.estado !== 'rechazado' && (
                <div className="col-span-2 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={motivo !== null}
                    onClick={() => onSalida(a)}
                    aria-label={`Dar salida a ${a.nombre_visitante}`}
                  >
                    Dar salida
                  </Button>
                  {motivo && <p role="status" className="min-w-0 flex-1 text-xs text-warning-400">{motivo}</p>}
                </div>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
