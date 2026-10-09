import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMisAnuncios, marcarAnuncioLeido, type AnuncioPrioridad, type MiAnuncio } from '../services/api';
import { Badge, Button, CardSkeleton, EmptyState, ErrorState, StatusText, useToast, type BadgeTone } from '../components/ui';
import { rellenar } from '../components/charts/format';
import { useTranslation } from '../i18n/useTranslation';
import { formatearDia, formatearFecha } from '../utils/fecha';
import { alCambiarAnuncios, avisarAnunciosCambiaron } from '../utils/eventos';

const ICON_ANUNCIO = 'M3 11l18-5v12L3 14v-3zM11.6 16.8a3 3 0 11-5.8-1.6';

const PRIORIDAD_TONE: Record<AnuncioPrioridad, BadgeTone> = { normal: 'neutral', importante: 'warning', urgente: 'danger' };
const PRIORIDAD_LABEL: Record<AnuncioPrioridad, string> = {
  normal: 'announce.prioNormal', importante: 'announce.prioImportante', urgente: 'announce.prioUrgente',
};

/**
 * Anuncios del residente: la página completa. La campana de la barra superior es un atajo para lo que falta por leer;
 * aquí están todos, con su texto entero, separando los comunicados de la comunidad de los avisos dirigidos a la persona.
 */
export default function MisAnunciosPage() {
  const { t } = useTranslation();
  const showToast = useToast();
  const [anuncios, setAnuncios] = useState<MiAnuncio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [soloSinLeer, setSoloSinLeer] = useState(false);
  const [marcando, setMarcando] = useState<string | null>(null);

  const cargar = useCallback(() => {
    getMisAnuncios()
      .then(rows => { setAnuncios(rows); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // Carga inicial; y se vuelve a pedir cuando la campana marca algo como leído.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => alCambiarAnuncios('pagina', cargar), [cargar]);

  const sinLeer = useMemo(() => anuncios.filter(a => a.leido_at === null), [anuncios]);
  const visibles = soloSinLeer ? sinLeer : anuncios;
  const personales = visibles.filter(a => a.es_personal);
  const comunidad = visibles.filter(a => !a.es_personal);

  const marcar = async (a: MiAnuncio) => {
    setMarcando(a.id);
    const ahora = new Date().toISOString();
    setAnuncios(prev => prev.map(x => (x.id === a.id ? { ...x, leido: true, leido_at: ahora } : x)));
    try {
      await marcarAnuncioLeido(a.id);
      avisarAnunciosCambiaron('pagina');
    } catch {
      setAnuncios(prev => prev.map(x => (x.id === a.id ? { ...x, leido: false, leido_at: null } : x)));
      showToast(t('misAnuncios.markError'), 'error');
    } finally {
      setMarcando(null);
    }
  };

  const marcarTodos = async () => {
    for (const a of sinLeer) await marcar(a);
  };

  const tarjeta = (a: MiAnuncio) => {
    const nuevo = a.leido_at === null;
    return (
      <article key={a.id} aria-label={a.titulo} className={`sg-card p-5 ${nuevo ? 'border-l-2 border-l-brand-500' : ''}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge tone={PRIORIDAD_TONE[a.prioridad]}>{t(PRIORIDAD_LABEL[a.prioridad])}</Badge>
          {nuevo && <StatusText kind="warn">{t('misAnuncios.new')}</StatusText>}
          <span className="ml-auto text-xs text-gray-400">{formatearFecha(a.created_at)}</span>
        </div>
        <h3 className={`mt-2 text-base ${nuevo ? 'font-bold text-gray-50' : 'font-semibold text-gray-100'}`}>{a.titulo}</h3>
        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-gray-300">{a.contenido}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-gray-400">
            {a.vigente_hasta ? rellenar(t('misAnuncios.validUntil'), { fecha: formatearDia(a.vigente_hasta) }) : ''}
          </span>
          {nuevo && (
            <Button size="sm" variant="secondary" loading={marcando === a.id} onClick={() => void marcar(a)}>
              {t('misAnuncios.markOne')}
            </Button>
          )}
        </div>
      </article>
    );
  };

  const seccion = (id: string, titulo: string, filas: MiAnuncio[]) => filas.length > 0 && (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-base font-semibold text-gray-50">{titulo}</h2>
      <div className="space-y-3">{filas.map(tarjeta)}</div>
    </section>
  );

  return (
    <div className="sg-page">
      <div className="sg-page-inner space-y-5">
        <header className="sg-panel-heading">
          <div>
            <h1 className="text-2xl font-bold text-gray-50">{t('misAnuncios.title')}</h1>
            <p className="mt-1 text-sm text-gray-400">{t('misAnuncios.subtitle')}</p>
          </div>
          {sinLeer.length > 0 && (
            <Button variant="secondary" onClick={() => void marcarTodos()}>{t('misAnuncios.markAll')}</Button>
          )}
        </header>

        {loading ? (
          <CardSkeleton count={3} />
        ) : error && anuncios.length === 0 ? (
          <div className="sg-card">
            <ErrorState
              title={t('misAnuncios.loadError')}
              action={<Button onClick={() => { setLoading(true); cargar(); }}>{t('dashboard.retry')}</Button>}
            />
          </div>
        ) : (
          <>
            <div role="group" aria-label={t('misAnuncios.title')} className="inline-flex gap-1 rounded-xl bg-gray-500/10 p-1">
              {[false, true].map(solo => (
                <button
                  key={String(solo)}
                  type="button"
                  aria-pressed={soloSinLeer === solo}
                  onClick={() => setSoloSinLeer(solo)}
                  className={`h-9 rounded-lg px-3 text-sm font-semibold transition-colors ${
                    soloSinLeer === solo ? 'bg-brand-500 text-brand-ink shadow-sm' : 'text-gray-300 hover:bg-gray-500/10 hover:text-gray-50'
                  }`}
                >
                  {solo ? rellenar(t('misAnuncios.filterUnread'), { n: sinLeer.length }) : t('misAnuncios.filterAll')}
                </button>
              ))}
            </div>

            {visibles.length === 0 ? (
              <div className="sg-card">
                <EmptyState
                  icon={ICON_ANUNCIO}
                  title={soloSinLeer ? t('misAnuncios.emptyUnread') : t('misAnuncios.empty')}
                  description={soloSinLeer ? undefined : t('misAnuncios.emptyHint')}
                />
              </div>
            ) : (
              <>
                {seccion('anuncios-para-ti', t('misAnuncios.sectionPersonal'), personales)}
                {seccion('anuncios-comunidad', t('misAnuncios.sectionCommunity'), comunidad)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
