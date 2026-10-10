import { useEffect, useState } from 'react';
import { getMisAnuncios, marcarAnuncioLeido, type MiAnuncio, type AnuncioPrioridad } from '../services/api';
import { Skeleton } from './Skeleton';
import { useTranslation } from '../i18n/useTranslation';
import { formatearFecha } from '../utils/fecha';

const PRIORIDAD_BADGE: Record<AnuncioPrioridad, string> = {
  normal:     'bg-gray-700 text-gray-300',
  importante: 'bg-amber-900/50 text-amber-400',
  urgente:    'bg-red-900/60 text-red-400',
};

const PRIORIDAD_LABEL: Record<AnuncioPrioridad, string> = {
  normal:     'announce.prioNormal',
  importante: 'announce.prioImportante',
  urgente:    'announce.prioUrgente',
};

export default function AnnouncementsBell() {
  const { t } = useTranslation();
  const [anuncios, setAnuncios] = useState<MiAnuncio[]>([]);
  const [open, setOpen]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    getMisAnuncios()
      .then(setAnuncios)
      .catch(() => { /* silent — bell just stays empty */ })
      .finally(() => setLoading(false));
  };

  // La carga inicial sincroniza el panel con la API; el setter ocurre dentro de la promesa.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const unreadCount = anuncios.filter(a => a.leido_at === null).length;

  const togglePanel = () => {
    const next = !open;
    setOpen(next);
    if (next) load(); // refresh on open
  };

  const markRead = async (a: MiAnuncio) => {
    // Optimistic — update badge without reload
    setAnuncios(prev => prev.map(x =>
      x.id === a.id ? { ...x, leido: true, leido_at: new Date().toISOString() } : x
    ));
    try {
      await marcarAnuncioLeido(a.id);
    } catch {
      // Revert on failure
      setAnuncios(prev => prev.map(x =>
        x.id === a.id ? { ...x, leido: false, leido_at: null } : x
      ));
    }
  };

  const handleOpenAnuncio = (a: MiAnuncio) => {
    const opening = expandedId !== a.id;
    setExpandedId(opening ? a.id : null);
    if (opening && a.leido_at === null) markRead(a);
  };

  const fmtDate = (d: string) =>
    formatearFecha(d);

  return (
    <div className="relative">
      {/* Bell */}
      <button
        onClick={togglePanel}
        aria-label={t('announcements.title')}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-gray-400 transition-colors hover:bg-white/10 hover:text-emerald-300"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-[10px] font-bold leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />

          <div className="sg-card fixed left-3 right-3 top-[4.75rem] z-40 overflow-hidden rounded-2xl sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[min(92vw,26rem)]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h3 className="text-white font-semibold text-sm">{t('announcements.title')}</h3>
              {unreadCount > 0 && (
                <span className="text-xs text-red-400 font-medium">
                  {unreadCount} {t('announcements.unread')}
                </span>
              )}
            </div>

            <div className="max-h-[calc(100vh-7rem)] overflow-y-auto sm:max-h-[70vh]">
              {loading && anuncios.length === 0 ? (
                <div className="space-y-4 px-4 py-4" role="status" aria-label={t('common.loading')}>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="space-y-2 border-b border-white/10 pb-4 last:border-0">
                      <Skeleton height="0.875rem" width="58%" />
                      <Skeleton height="0.75rem" width="88%" />
                      <Skeleton height="0.7rem" width="34%" />
                    </div>
                  ))}
                </div>
              ) : anuncios.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">{t('announcements.empty')}</p>
              ) : (
                anuncios.map(a => {
                  const unread   = a.leido_at === null;
                  const expanded = expandedId === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => handleOpenAnuncio(a)}
                      className={`w-full text-left border-b border-white/10 px-4 py-4 transition-colors last:border-0 hover:bg-white/5 ${
                        unread ? 'bg-gray-700/20 border-l-2 border-l-red-500' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${PRIORIDAD_BADGE[a.prioridad]}`}>
                          {t(PRIORIDAD_LABEL[a.prioridad])}
                        </span>
                        {unread && (
                          <span className="inline-block text-[10px] font-bold text-red-400">● {t('announcements.newTag')}</span>
                        )}
                        <span className="ml-auto text-[11px] text-gray-500">{fmtDate(a.created_at)}</span>
                      </div>
                      <p className={`text-sm ${unread ? 'text-white font-semibold' : 'text-gray-200 font-medium'}`}>
                        {a.titulo}
                      </p>
                      <p className={`text-xs text-gray-400 mt-0.5 whitespace-pre-line ${expanded ? '' : 'line-clamp-2'}`}>
                        {a.contenido}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
