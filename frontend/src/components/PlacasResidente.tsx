import { useEffect, useState } from 'react';
import {
  agregarPlacaResidente, getPlacasResidente, quitarPlacaResidente, type VehiculoResidente,
} from '../services/api';
import { Button, Input, Modal, useToast } from './ui';
import { rellenar } from './charts/format';
import { useTranslation } from '../i18n/useTranslation';
import { formatearDia } from '../utils/fecha';
import { esPlacaGuatemalteca, formatearPlaca, normalizarPlaca, PLACA_EJEMPLO, placaParaInput } from '../utils/placa';

interface Props {
  /** Residente cuya casa se administra; `null` = cerrado. */
  residente: { id: string; numero_casa: string; nombre: string } | null;
  onClose: () => void;
}

/**
 * Placas autorizadas de una casa (Sprint 10, seguimiento del ANPR). Escribe en la MISMA fuente que baja la garita
 * (`/api/anpr/vehiculos` → `vehiculos_residentes` → `GET /sync/garita`): lo que se agrega aquí abre la talanquera solo desde la
 * siguiente sincronización de la garita, y lo que se quita deja de abrir. Alta, baja y lista; el backend exige el formato
 * guatemalteco (el único que lee el reconocimiento) y rechaza una placa ya autorizada dentro de la misma empresa.
 */
export default function PlacasResidente({ residente, onClose }: Props) {
  const { t } = useTranslation();
  const showToast = useToast();
  const [placas, setPlacas] = useState<VehiculoResidente[]>([]);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState(false);
  const [placa, setPlaca] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  /** Placa que espera la confirmación de «Quitar» (un segundo toque, sin abrir otro diálogo encima de este). */
  const [porQuitar, setPorQuitar] = useState<string | null>(null);
  const [quitando, setQuitando] = useState(false);

  const residenteId = residente?.id;
  useEffect(() => {
    if (!residenteId) return;
    let vivo = true;
    // Abrir el diálogo de otra casa reinicia el formulario y vuelve a pedir su lista.
    setPlacas([]);
    setPlaca(''); setDescripcion(''); setError(null); setPorQuitar(null); setErrorCarga(false);
    setCargando(true);
    getPlacasResidente(residenteId)
      .then(lista => { if (vivo) setPlacas(lista); })
      .catch(() => { if (vivo) setErrorCarga(true); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [residenteId]);

  const agregar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!residente) return;
    const n = normalizarPlaca(placa);
    if (!n) { setError(t('plates.required')); return; }
    if (!esPlacaGuatemalteca(n)) { setError(rellenar(t('plates.format'), { ejemplo: PLACA_EJEMPLO })); return; }
    setGuardando(true); setError(null);
    try {
      const nueva = await agregarPlacaResidente({ residente_id: residente.id, placa: n, descripcion: descripcion.trim() || undefined });
      setPlacas(prev => [...prev, nueva].sort((a, b) => a.placa.localeCompare(b.placa)));
      setPlaca(''); setDescripcion('');
      showToast(rellenar(t('plates.added'), { placa: formatearPlaca(nueva.placa) }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('plates.addError'));
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async (v: VehiculoResidente) => {
    setQuitando(true); setError(null);
    try {
      await quitarPlacaResidente(v.id);
      setPlacas(prev => prev.filter(x => x.id !== v.id));
      setPorQuitar(null);
      showToast(rellenar(t('plates.removed'), { placa: formatearPlaca(v.placa) }), 'warning');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('plates.removeError'));
    } finally {
      setQuitando(false);
    }
  };

  return (
    <Modal
      open={residente !== null}
      onClose={onClose}
      title={residente ? rellenar(t('plates.title'), { casa: residente.numero_casa }) : t('plates.titleShort')}
      description={residente ? rellenar(t('plates.description'), { nombre: residente.nombre }) : undefined}
      size="md"
      dismissible={!guardando && !quitando}
    >
      <div className="space-y-4">
        {errorCarga && (
          <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-sm text-danger-400">{t('plates.loadError')}</p>
        )}

        {cargando ? (
          <p className="text-sm text-gray-400" role="status">{t('plates.loading')}</p>
        ) : placas.length === 0 && !errorCarga ? (
          <p className="rounded-lg border border-dashed border-gray-600 px-3 py-4 text-center text-sm text-gray-400">{t('plates.empty')}</p>
        ) : (
          <ul className="divide-y divide-gray-700 rounded-lg border border-gray-700" aria-label={t('plates.listLabel')}>
            {placas.map(v => {
              const texto = formatearPlaca(v.placa);
              return (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <span className="block font-mono text-sm font-semibold text-gray-50">{texto}</span>
                    <span className="block text-xs text-gray-400">
                      {v.descripcion ? `${v.descripcion} · ` : ''}
                      {rellenar(t('plates.since'), { dia: formatearDia(v.vigente_desde) })}
                      {v.vigente_hasta ? ` · ${rellenar(t('plates.until'), { dia: formatearDia(v.vigente_hasta) })}` : ''}
                    </span>
                  </div>
                  {porQuitar === v.id ? (
                    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={rellenar(t('plates.confirmRemove'), { placa: texto })}>
                      <span className="text-xs text-gray-300">{rellenar(t('plates.confirmRemove'), { placa: texto })}</span>
                      <Button size="sm" variant="danger" loading={quitando} onClick={() => quitar(v)}>{t('plates.confirmYes')}</Button>
                      <Button size="sm" variant="ghost" disabled={quitando} onClick={() => setPorQuitar(null)}>{t('common.cancel')}</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setPorQuitar(v.id)} aria-label={rellenar(t('plates.removeLabel'), { placa: texto })}>
                      {t('plates.remove')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={agregar} className="space-y-3 border-t border-gray-700 pt-4" noValidate>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label={t('plates.plate')}
              value={placa}
              onChange={e => { setPlaca(placaParaInput(e.target.value)); setError(null); }}
              placeholder={PLACA_EJEMPLO}
              autoComplete="off"
              spellCheck={false}
              required
            />
            <Input
              label={t('plates.descriptionLabel')}
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              placeholder={t('plates.descriptionPlaceholder')}
              maxLength={100}
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-sm text-danger-400">{error}</p>
          )}
          <p className="text-xs text-gray-400">{t('plates.syncHint')}</p>
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="ghost" onClick={onClose} disabled={guardando || quitando}>{t('common.close')}</Button>
            <Button type="submit" loading={guardando}>{t('plates.add')}</Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
