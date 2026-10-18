/**
 * Foto de evidencia de un evento del ANPR (recorte de la placa o de la parte baja del vehículo). La imagen vive cifrada en la
 * base del equipo y se pide solo cuando se muestra; a los 7 días se purga y aquí se dice.
 */
import { useEffect, useState } from 'react';
import { cx } from '../ui';
import { api } from '../../lib/tauri';

interface Props {
  eventoId: string;
  tipo: 'placa' | 'vehiculo';
  /** Si el evento tiene esta evidencia (sin ella no se pide nada). */
  disponible: boolean;
  className?: string;
}

const ALT = { placa: 'Foto de la placa', vehiculo: 'Foto del vehículo (sin cabina)' } as const;

export function EvidenciaAnpr({ eventoId, tipo, disponible, className }: Props) {
  const [jpeg, setJpeg] = useState<string | null>(null);
  const [estado, setEstado] = useState<'cargando' | 'lista' | 'sin'>(disponible ? 'cargando' : 'sin');

  useEffect(() => {
    if (!disponible) return;
    let vivo = true;
    api.anpr.evidencia(eventoId, tipo)
      .then(b64 => { if (vivo) { setJpeg(b64); setEstado(b64 ? 'lista' : 'sin'); } })
      .catch(() => { if (vivo) setEstado('sin'); });
    return () => { vivo = false; };
  }, [eventoId, tipo, disponible]);

  const caja = cx('shrink-0 overflow-hidden rounded-md border border-gray-600 bg-dark-900', className);
  if (estado === 'lista' && jpeg) {
    return <img src={`data:image/jpeg;base64,${jpeg}`} alt={ALT[tipo]} className={cx(caja, 'object-contain')} />;
  }
  return (
    <span className={cx(caja, 'flex items-center justify-center px-1 text-center text-2xs text-gray-400')}>
      {estado === 'cargando' ? 'Cargando…' : 'Sin foto'}
    </span>
  );
}
