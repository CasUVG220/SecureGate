import { useEffect, useMemo, useState } from 'react';
import { getTickets, type Ticket, type TicketEstado, type TicketTipo } from '../services/api';
import { Spinner } from '../components/Skeleton';
import { useTranslation } from '../i18n/useTranslation';
import TicketChat, { TIPO_LABEL, ESTADO_BADGE, ESTADO_LABEL } from '../components/TicketChat';

const TIPOS: TicketTipo[]     = ['mantenimiento', 'queja', 'seguridad', 'otro'];
const ESTADOS: TicketEstado[] = ['abierto', 'en_proceso', 'cerrado'];

export default function TicketsPage() {
  const { t } = useTranslation();
  const [tickets, setTickets]   = useState<Ticket[]>([]);
  const [loading, setLoading]   = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fEstado, setFEstado]   = useState<'' | TicketEstado>('');
  const [fTipo, setFTipo]       = useState<'' | TicketTipo>('');

  const load = () => {
    setLoading(true);
    getTickets()
      .then(setTickets)
      .catch(() => { /* silent */ })
      .finally(() => setLoading(false));
  };

  // Carga inicial del módulo; el estado se actualiza al resolver la petición.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => tickets.filter(tk =>
    (!fEstado || tk.estado === fEstado) && (!fTipo || tk.tipo === fTipo)
  ), [tickets, fEstado, fTipo]);

  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="sg-page text-gray-100 h-full flex flex-col">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-white">{t('tickets.title')}</h1>
        <p className="text-sm text-gray-400 mt-0.5">{t('tickets.adminSubtitle')}</p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select value={fEstado} onChange={e => setFEstado(e.target.value as '' | TicketEstado)}
          className="sg-input w-full sm:w-auto">
          <option value="">{t('tickets.allStates')}</option>
          {ESTADOS.map(e => <option key={e} value={e}>{t(ESTADO_LABEL[e])}</option>)}
        </select>
        <select value={fTipo} onChange={e => setFTipo(e.target.value as '' | TicketTipo)}
          className="sg-input w-full sm:w-auto">
          <option value="">{t('tickets.allTypes')}</option>
          {TIPOS.map(tp => <option key={tp} value={tp}>{t(TIPO_LABEL[tp])}</option>)}
        </select>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_1fr] gap-4 min-h-0">
        {/* Lista */}
        <div className="sg-card flex min-h-0 flex-col overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-10"><Spinner size={22} /></div>
          ) : filtered.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-10">{t('tickets.empty')}</p>
          ) : (
            <div className="overflow-y-auto divide-y divide-gray-700/60">
              {filtered.map(tk => (
                <button
                  key={tk.id}
                  onClick={() => setSelectedId(tk.id)}
                  className={`w-full text-left px-4 py-4 transition-colors ${
                    selectedId === tk.id ? 'bg-gray-700/50' : 'hover:bg-gray-700/30'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium text-sm truncate flex-1">{tk.titulo}</span>
                    {Number(tk.no_leidos) > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-[10px] font-bold">
                        {Number(tk.no_leidos)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${ESTADO_BADGE[tk.estado]}`}>
                      {t(ESTADO_LABEL[tk.estado])}
                    </span>
                    <span className="text-[11px] text-gray-400">{t(TIPO_LABEL[tk.tipo])}</span>
                    <span className="text-[11px] text-gray-500 ml-auto">{fmt(tk.ultimo_mensaje_at)}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 truncate">
                    {t('tickets.house')} {tk.numero_casa} · {tk.residente_nombre}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Chat — right column on desktop, stacks below the list on mobile */}
        <div className="min-h-0 h-[70vh] lg:h-auto">
          {selectedId ? (
            <TicketChat key={selectedId} ticketId={selectedId} viewerRole="admin" onActivity={load} />
          ) : (
            <div className="sg-card flex h-full items-center justify-center p-6 text-center text-sm text-gray-500">
              {t('tickets.selectPrompt')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
