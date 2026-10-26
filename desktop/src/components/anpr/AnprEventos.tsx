/**
 * Eventos del ANPR en tiempo real (Sprint 10): cada vehículo decidido, con su estado, su evidencia y, si espera al agente, qué
 * puede hacer con él:
 *
 * - **Autorizar**: vehículo autorizado en un carril en modo verificación (un toque) o con la lectura dudosa ya revisada.
 * - **Corregir**: escribir la placa bien leída y autorizar con ella. Rust vuelve a revisar TODAS las barandas con esa placa:
 *   con lista negra, licencia bloqueada o un vehículo no autorizado se rechaza y se dice por qué.
 * - **Registro manual**: no es un vehículo autorizado (visita, delivery): la placa pasa al formulario de siempre.
 * - **Descartar**: no era nada (falso positivo).
 *
 * Cada fila lleva la miniatura de la placa (con varios vehículos a la vez, es lo que permite al agente ver de un vistazo cuál
 * fue cuál), la placa, la confianza y el estado. La foto del vehículo se abre con «Ver evidencia» (o sola si espera al agente).
 *
 * La lista es una región `aria-live="polite"`: un evento nuevo se anuncia sin interrumpir.
 */
import { useState, type FormEvent } from 'react';
import { Button, Card, EmptyState, Input, StatusText, type StatusKind } from '../ui';
import { horaLocal } from '../../lib/tiempo';
import { esValida, normalizar } from '../../lib/placa';
import { ESTADO_EVENTO, numeroPista, pendiente, placaVisible, porcentaje, textoApertura, textoMotivo, type TonoAnpr } from '../../lib/anpr';
import { mensajeDe, type EventoAnpr, type ResolucionAnpr } from '../../lib/tauri';
import { EvidenciaAnpr } from './EvidenciaAnpr';

const KIND: Record<TonoAnpr, StatusKind> = { ok: 'on', warn: 'warn', bad: 'bad', info: 'off' };
const ICON = 'M3 7h18M3 12h18M3 17h12';

interface Props {
  eventos: EventoAnpr[];
  pendientes: number;
  nombreCarril: (id: string) => string;
  onResolver: (eventoId: string, resolucion: ResolucionAnpr, placa?: string | null) => Promise<unknown>;
  /** «Registro manual»: la placa (si hay) pasa al formulario de registro. */
  onRegistroManual: (placa: string | null) => void;
}

export function AnprEventos({ eventos, pendientes, nombreCarril, onResolver, onRegistroManual }: Props) {
  return (
    <Card
      title="Eventos del ANPR"
      actions={<span className="text-xs font-semibold text-gray-400">{pendientes ? `${pendientes} por atender` : 'Al día'}</span>}
      padded={false}
    >
      <div aria-live="polite" aria-relevant="additions" aria-label="Eventos del reconocimiento de placas">
        {eventos.length === 0 ? (
          <EmptyState compact icon={ICON} title="Sin eventos todavía" description="Cada vehículo que pase por un carril con ANPR aparecerá aquí." />
        ) : (
          <ul className="divide-y divide-gray-700">
            {eventos.map(e => (
              <li key={e.id}>
                <FilaEvento evento={e} carril={nombreCarril(e.carril_id)} onResolver={onResolver} onRegistroManual={onRegistroManual} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function FilaEvento({ evento: e, carril, onResolver, onRegistroManual }: {
  evento: EventoAnpr; carril: string;
  onResolver: Props['onResolver']; onRegistroManual: Props['onRegistroManual'];
}) {
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [placa, setPlaca] = useState(e.placa ?? e.placa_probable ?? '');
  const [ocupado, setOcupado] = useState<ResolucionAnpr | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verEvidencia, setVerEvidencia] = useState(false);

  const st = ESTADO_EVENTO[e.estado] ?? { texto: e.estado, tono: 'info' as TonoAnpr };
  const motivo = pendiente(e) ? textoMotivo(e) : null;
  const apertura = textoApertura(e.apertura);
  const espera = pendiente(e) && e.estado !== 'alerta_lista_negra';
  const mostrarFotos = espera || verEvidencia;

  const resolver = async (r: ResolucionAnpr, conPlaca?: string | null) => {
    setOcupado(r);
    setError(null);
    try {
      await onResolver(e.id, r, conPlaca);
      setCorrigiendo(false);
      return true;
    } catch (err) {
      setError(mensajeDe(err));
      return false;
    } finally {
      setOcupado(null);
    }
  };

  const corregir = async (ev: FormEvent) => {
    ev.preventDefault();
    const p = normalizar(placa);
    if (!esValida(p)) {
      setError('Esa placa no tiene el formato de una placa de Guatemala.');
      return;
    }
    await resolver('autorizar', p);
  };

  const registroManual = async () => {
    if (await resolver('registro_manual', e.placa ?? e.placa_probable)) onRegistroManual(e.placa ?? e.placa_probable);
  };

  return (
    <div className="space-y-2 px-5 py-3">
      <div className="flex items-start gap-3">
        {!mostrarFotos && <EvidenciaAnpr eventoId={e.id} tipo="placa" disponible={e.evidencia_placa} className="h-10 w-20" />}
        <div className="grid min-w-0 flex-1 grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
          <p className="truncate text-sm font-semibold text-gray-100">
            <span className="font-mono">{placaVisible(e)}</span>
            {e.residente_casa && <span className="font-normal text-gray-400"> · {e.residente_casa}{e.residente_nombre ? ` · ${e.residente_nombre}` : ''}</span>}
          </p>
          <p className="text-xs tabular-nums text-gray-400">{horaLocal(e.creado_en)}</p>
          <p className="truncate text-xs text-gray-400">
            {carril} · Pista {numeroPista(e.track_id)} · {e.sentido === 'salida' ? 'Salida' : 'Entrada'} · confianza {porcentaje(e.confianza)}
            {e.ms_desde_legible != null && ` · ${(e.ms_desde_legible / 1000).toFixed(1)} s`}
          </p>
          <StatusText kind={KIND[st.tono]} className="justify-self-end">{st.texto}</StatusText>
        </div>
      </div>

      {motivo && <p className={e.estado === 'alerta_lista_negra' ? 'text-xs font-semibold text-danger-400' : 'text-xs text-warning-400'}>{motivo}</p>}
      {apertura && <p className={apertura.tono === 'bad' ? 'text-xs font-semibold text-danger-400' : 'text-xs text-gray-400'}>{apertura.texto}</p>}
      {e.resolucion && <p className="text-xs text-gray-400">Resuelto: {RESOLUCION[e.resolucion] ?? e.resolucion}</p>}

      {mostrarFotos && (
        <div className="flex gap-2">
          <EvidenciaAnpr eventoId={e.id} tipo="placa" disponible={e.evidencia_placa} className="h-14 w-28" />
          <EvidenciaAnpr eventoId={e.id} tipo="vehiculo" disponible={e.evidencia_vehiculo} className="h-14 w-24" />
        </div>
      )}

      {corrigiendo ? (
        <form onSubmit={corregir} className="flex flex-wrap items-end gap-2">
          <Input
            label="Placa correcta"
            value={placa}
            onChange={ev => setPlaca(ev.target.value.toUpperCase())}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            wrapperClassName="w-40"
          />
          <Button type="submit" size="sm" loading={ocupado === 'autorizar'}>Autorizar con esta placa</Button>
          <Button size="sm" variant="ghost" onClick={() => { setCorrigiendo(false); setError(null); }}>Cancelar</Button>
        </form>
      ) : espera ? (
        <div className="flex flex-wrap gap-2">
          {e.estado === 'verificacion_pendiente' && e.vehiculo_id && (
            <Button size="sm" loading={ocupado === 'autorizar'} onClick={() => void resolver('autorizar', e.placa)} aria-label={`Autorizar ${placaVisible(e)}`}>
              Autorizar
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setCorrigiendo(true)} aria-label={`Corregir la placa ${placaVisible(e)}`}>Corregir</Button>
          <Button size="sm" variant="secondary" loading={ocupado === 'registro_manual'} onClick={() => void registroManual()}>Registro manual</Button>
          <Button size="sm" variant="ghost" loading={ocupado === 'descartar'} onClick={() => void resolver('descartar')}>Descartar</Button>
        </div>
      ) : !mostrarFotos && e.evidencia_vehiculo && (
        <button type="button" className="text-xs font-semibold text-gray-400 underline-offset-4 hover:underline" onClick={() => setVerEvidencia(true)}>
          Ver evidencia
        </button>
      )}

      {error && <p role="alert" className="text-xs font-medium text-danger-400">{error}</p>}
    </div>
  );
}

const RESOLUCION: Record<ResolucionAnpr, string> = {
  autorizar: 'autorizado por el agente',
  registro_manual: 'registrado a mano',
  descartar: 'descartado',
  enterado: 'alerta vista',
};
