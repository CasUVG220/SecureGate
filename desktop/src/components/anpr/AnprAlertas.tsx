/**
 * Avisos del ANPR que no pueden pasar desapercibidos (Sprint 10):
 *
 * - **Lista negra**: banda roja con la placa, el carril y la razón, anunciada con `aria-live="assertive"` (el sonido lo da
 *   `useAnpr`). La barrera NO se abrió. Queda hasta que el agente pulsa «Enterado».
 * - **La barrera no respondió**: banda persistente; el acceso ya quedó registrado, el agente abre a mano.
 */
import { useState } from 'react';
import { Button } from '../ui';
import { Alert } from '../shared/Alert';
import { formatear } from '../../lib/placa';
import { mensajeDe, type EventoAnpr } from '../../lib/tauri';
import type { FallaActuador } from '../../hooks/useAnpr';
import { EvidenciaAnpr } from './EvidenciaAnpr';

interface Props {
  alertas: EventoAnpr[];
  fallas: FallaActuador[];
  nombreCarril: (id: string) => string;
  onEnterado: (eventoId: string) => Promise<unknown>;
  onVerFalla: (eventoId: string) => void;
}

export function AnprAlertas({ alertas, fallas, nombreCarril, onEnterado, onVerFalla }: Props) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enterado = async (id: string) => {
    setOcupado(id);
    setError(null);
    try {
      await onEnterado(id);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setOcupado(null);
    }
  };

  return (
    <>
      {/* La región existe siempre: un lector de pantalla solo anuncia lo que CAMBIA dentro de una región ya presente. */}
      <div aria-live="assertive" aria-atomic="false" className="space-y-2">
        {alertas.map(a => (
          <div
            key={a.id}
            role="alert"
            className="flex flex-wrap items-center gap-4 rounded-lg border-2 border-danger-500 bg-danger-500/15 px-4 py-3 text-danger-400 motion-safe:animate-pulse"
          >
            <EvidenciaAnpr eventoId={a.id} tipo="placa" disponible={a.evidencia_placa} className="h-14 w-28" />
            <div className="min-w-0 flex-1">
              <p className="text-base font-extrabold uppercase tracking-wide">
                Lista negra · {a.placa ? formatear(a.placa) : 'placa sin leer'}
              </p>
              <p className="text-sm font-semibold">
                {nombreCarril(a.carril_id)}: la barrera NO se abrió.{a.motivo ? ` ${a.motivo}.` : ''} Avisa al supervisor según el protocolo.
              </p>
            </div>
            <Button variant="danger" loading={ocupado === a.id} onClick={() => void enterado(a.id)} aria-label={`Enterado: lista negra ${a.placa ?? ''}`}>
              Enterado
            </Button>
          </div>
        ))}
        {error && <Alert tone="bad">{error}</Alert>}
      </div>
      {fallas.map(f => (
        <div key={f.evento_id} role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger-500/40 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">
          <span className="min-w-0 flex-1">
            La barrera de «{nombreCarril(f.carril)}» no respondió ({f.error}). El acceso quedó registrado: ábrela a mano.
          </span>
          <Button size="sm" variant="secondary" onClick={() => onVerFalla(f.evento_id)}>Entendido</Button>
        </div>
      ))}
    </>
  );
}
