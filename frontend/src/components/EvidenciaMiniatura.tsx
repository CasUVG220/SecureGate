import { useEffect, useState } from 'react';
import { getEvidenciaAnpr } from '../services/api';
import { useTranslation } from '../i18n/useTranslation';
import { rellenar } from './charts/format';
import { formatearPlaca } from '../utils/placa';

interface Props {
  idCliente: string;
  tipo?: 'placa' | 'vehiculo';
  placa: string | null;
}

/**
 * Miniatura de la evidencia de una entrada por placas (Sprint 10). La imagen se pide con la sesión (la misma autorización que el
 * registro: el backend solo la entrega a quien ve esa sucursal) y se muestra desde un `blob:` local que se libera al desmontar.
 */
export default function EvidenciaMiniatura({ idCliente, tipo = 'placa', placa }: Props) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [estado, setEstado] = useState<'cargando' | 'lista' | 'sin'>('cargando');

  useEffect(() => {
    let vivo = true;
    let creada: string | null = null;
    getEvidenciaAnpr(idCliente, tipo)
      .then(blob => {
        if (!vivo) return;
        if (!blob) { setEstado('sin'); return; }
        creada = URL.createObjectURL(blob);
        setUrl(creada);
        setEstado('lista');
      })
      .catch(() => { if (vivo) setEstado('sin'); });
    return () => {
      vivo = false;
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [idCliente, tipo]);

  const caja = 'flex h-10 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-gray-600 bg-gray-800';
  if (estado === 'lista' && url) {
    return <img src={url} alt={rellenar(t('entradas.evidenceAlt'), { placa: formatearPlaca(placa) || '—' })} className={`${caja} object-contain`} />;
  }
  return (
    <span className={`${caja} px-1 text-center text-2xs text-gray-400`}>
      {estado === 'cargando' ? t('entradas.loadingEvidence') : t('entradas.noEvidence')}
    </span>
  );
}
