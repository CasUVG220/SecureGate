/**
 * Salida de un vehículo: se lee la placa, se busca el acceso que sigue
 * abierto y se cierra.
 *
 * La búsqueda y el cierre van contra el servidor: la entrada pudo registrarla
 * otra garita o la web, y el espejo local sólo guarda lo que salió de ESTE
 * equipo. La placa llega del OCR local pero siempre se puede corregir —el
 * agente ve el carro, el OCR no— y también se puede escribir a mano sin
 * pasar por la cámara.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert } from '../shared/Alert';
import { Button, Input, Modal } from '../ui';
import { esValida, formatear, normalizar } from '../../lib/placa';
import { horaLocal } from '../../lib/tiempo';
import { api, mensajeDe, type AccesoActivo, type ResultadoApertura } from '../../lib/tauri';

interface Props {
  /** Placa que propuso el OCR; vacía si el agente abrió el diálogo a mano. */
  placaInicial: string;
  onCerrar: () => void;
  onRegistrada: (acceso: AccesoActivo, apertura: ResultadoApertura) => void;
}

export function SalidaDialog({ placaInicial, onCerrar, onRegistrada }: Props) {
  const [placa, setPlaca] = useState(placaInicial);
  const [buscando, setBuscando] = useState(false);
  const [acceso, setAcceso] = useState<AccesoActivo | null>(null);
  const [sinResultado, setSinResultado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const buscar = useCallback(async (valor: string) => {
    const p = normalizar(valor);
    if (!esValida(p)) return;
    setBuscando(true);
    setError(null);
    setSinResultado(false);
    setAcceso(null);
    try {
      const r = await api.garita.buscarSalida(p);
      if (r) setAcceso(r); else setSinResultado(true);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setBuscando(false);
    }
  }, []);

  // Con una placa reconocida se busca sola: el agente no debería tener que
  // pulsar dos veces con el carro esperando en el carril.
  useEffect(() => {
    if (esValida(placaInicial)) void buscar(placaInicial);
  }, [placaInicial, buscar]);

  const registrar = async () => {
    if (!acceso) return;
    setEnviando(true);
    setError(null);
    try {
      const { apertura } = await api.garita.registrarSalida(acceso.registro_id);
      onRegistrada(acceso, apertura);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  };

  const valida = esValida(placa);

  return (
    <Modal
      open
      onClose={onCerrar}
      title="Registrar salida"
      description="Se cierra el acceso que sigue abierto para esta placa."
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          {acceso
            ? <Button loading={enviando} onClick={() => void registrar()}>Registrar salida</Button>
            : <Button disabled={!valida || buscando} loading={buscando} onClick={() => void buscar(placa)}>Buscar</Button>}
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Placa"
          className="min-h-control-lg font-mono text-lg tracking-widest"
          autoFocus
          value={placa}
          onChange={e => { setPlaca(e.target.value.toUpperCase()); setAcceso(null); setSinResultado(false); }}
          onKeyDown={e => { if (e.key === 'Enter' && valida) { e.preventDefault(); void buscar(placa); } }}
          error={placa && !valida ? 'Formato esperado: prefijo + 3 dígitos + 3 letras (ej. P123ABC)' : null}
          hint={valida ? `Se buscará ${formatear(placa)}` : undefined}
          spellCheck={false}
        />

        {error && <Alert tone="bad">{error}</Alert>}

        {sinResultado && (
          <Alert tone="warn">
            No hay ningún acceso abierto con esa placa. Revisa el número, o puede que la entrada se
            registrara sin vehículo.
          </Alert>
        )}

        {acceso && (
          <div className="rounded-lg border border-gray-700 bg-gray-500/[0.06] px-4 py-3">
            <p className="text-2xs font-bold uppercase tracking-wider text-gray-400">Acceso abierto</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-gray-400">Visitante</dt>
              <dd className="font-medium text-gray-100">{acceso.visitante.nombre} · DPI {acceso.visitante.numero_dpi}</dd>
              <dt className="text-gray-400">Visitó</dt>
              <dd className="text-gray-200">{acceso.residente.numero_casa} · {acceso.residente.nombre}</dd>
              <dt className="text-gray-400">Entró</dt>
              <dd className="text-gray-200">{horaLocal(acceso.timestamp_entrada)}</dd>
              <dt className="text-gray-400">Placa</dt>
              <dd className="font-mono text-gray-200">{formatear(acceso.placa ?? placa)}</dd>
            </dl>
          </div>
        )}
      </div>
    </Modal>
  );
}
