/**
 * Confirmación del resultado del OCR de placa. Nunca se acepta a ciegas: el
 * agente ve el texto, la confianza y el tiempo, y puede editarlo. Si el
 * candidato requiere revisión (baja confianza, correcciones, prefijo raro)
 * el botón de aceptar exige que el texto editado sea una placa válida.
 */
import { useMemo, useState } from 'react';
import { Alert } from '../shared/Alert';
import { Button, Input, Modal } from '../ui';
import { esValida, formatear, mejorCandidato, normalizar } from '../../lib/placa';
import type { ResultadoOcr } from '../../lib/tauri';

interface Props {
  resultado: ResultadoOcr;
  onAceptar: (placa: string) => void;
  onCancelar: () => void;
}

export function PlacaOcrDialog({ resultado, onAceptar, onCancelar }: Props) {
  const candidato = useMemo(() => mejorCandidato(resultado.items, resultado.texto), [resultado]);
  const [texto, setTexto] = useState(candidato.placa);
  const valida = esValida(texto);
  const cambiado = normalizar(texto) !== candidato.placa;

  const tone = !candidato.valida ? 'bad' : candidato.requiereRevision ? 'warn' : 'ok';
  const mensaje = !candidato.valida
    ? 'No se reconoció una placa con formato guatemalteco. Escríbela a mano o vuelve a capturar.'
    : candidato.requiereRevision
      ? `Lectura dudosa (${candidato.correcciones > 0 ? `${candidato.correcciones} carácter(es) corregido(s)` : !candidato.prefijoConocido ? 'prefijo poco común' : `confianza ${Math.round(candidato.confianza * 100)} %`}). Confírmala antes de usarla.`
      : `Lectura confiable (${Math.round(candidato.confianza * 100)} %).`;

  return (
    <Modal
      open
      onClose={onCancelar}
      title="Placa reconocida"
      description="Revisa el texto antes de usarlo en el registro."
      footer={
        <>
          <Button variant="secondary" onClick={onCancelar}>Cancelar</Button>
          <Button disabled={!valida} onClick={() => onAceptar(normalizar(texto))}>
            {cambiado ? 'Usar placa corregida' : 'Usar esta placa'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone={tone}>{mensaje}</Alert>
        <Input
          label="Placa"
          className="min-h-control-lg font-mono text-lg tracking-widest"
          autoFocus
          value={texto}
          onChange={e => setTexto(e.target.value.toUpperCase())}
          error={texto && !valida ? 'Formato esperado: prefijo + 3 dígitos + 3 letras (ej. P123ABC)' : null}
          hint={valida ? `Se registrará como ${formatear(texto)}` : undefined}
          spellCheck={false}
        />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-gray-400">Texto crudo del OCR</dt>
          <dd className="font-mono text-gray-200">{resultado.texto || '—'}</dd>
          <dt className="text-gray-400">Inferencia</dt>
          <dd className="text-gray-200">{resultado.ms_inferencia} ms <span className="text-gray-400">(ida y vuelta {resultado.ms_roundtrip} ms)</span></dd>
        </dl>
      </div>
    </Modal>
  );
}
