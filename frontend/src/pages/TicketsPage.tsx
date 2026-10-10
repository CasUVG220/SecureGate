import { useCallback, useEffect, useMemo, useState } from 'react';
import { getTickets, type Ticket, type TicketEstado, type TicketTipo } from '../services/api';
import { Badge, CardSkeleton, EmptyState, Select } from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';
import TicketChat, { TIPO_LABEL, ESTADO_LABEL } from '../components/TicketChat';
import type { BadgeTone } from '../components/ui';
import { usePolling } from '../hooks/usePolling';
import { formatearFechaHoraCorta } from '../utils/fecha';

const ICON_TICKETS = 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z';

const ESTADO_TONE: Record<TicketEstado, BadgeTone> = {
  abierto: 'warning', en_proceso: 'info', cerrado: 'success',
};

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

  // Refresco silencioso (sin esqueleto): el estado y los no leídos de cada solicitud se actualizan
  // solos cada 15 s mientras la pestaña está visible, y tras cada actividad del chat.
  const refrescar = useCallback(async () => { setTickets(await getTickets()); }, []);
  usePolling(refrescar, 15_000);

  const filtered = useMemo(() => tickets.filter(tk =>
    (!fEstado || tk.estado === fEstado) && (!fTipo || tk.tipo === fTipo)
  ), [tickets, fEstado, fTipo]);

  const fmt = (d: string | null) =>
    d ? formatearFechaHoraCorta(d) : '';

  return (
    <div className="sg-page text-gray-100 h-full flex flex-col">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-white">{t('tickets.title')}</h1>
        <p className="text-sm text-gray-400 mt-0.5">{t('tickets.adminSubtitle')}</p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-4">
        <Select
          wrapperClassName="w-full sm:w-48"
          value={fEstado}
          onChange={e => setFEstado(e.target.value as '' | TicketEstado)}
          aria-label={t('common.status')}
        >
          <option value="">{t('tickets.allStates')}</option>
          {ESTADOS.map(e => <option key={e} value={e}>{t(ESTADO_LABEL[e])}</option>)}
        </Select>
        <Select
          wrapperClassName="w-full sm:w-48"
          value={fTipo}
          onChange={e => setFTipo(e.target.value as '' | TicketTipo)}
          aria-label={t('common.type')}
        >
          <option value="">{t('tickets.allTypes')}</option>
          {TIPOS.map(tp => <option key={tp} value={tp}>{t(TIPO_LABEL[tp])}</option>)}
        </Select>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_1fr] gap-4 min-h-0">
        {/* Lista */}
        <div className="sg-card flex min-h-0 flex-col overflow-hidden">
          {loading ? (
            <div className="p-3"><CardSkeleton count={4} /></div>
          ) : filtered.length === 0 ? (
            <EmptyState
              compact
              icon={ICON_TICKETS}
              title={fEstado || fTipo ? t('tickets.empty') : t('empty.tickets')}
              description={fEstado || fTipo ? undefined : t('empty.ticketsHint')}
            />
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
                    <Badge tone={ESTADO_TONE[tk.estado]}>{t(ESTADO_LABEL[tk.estado])}</Badge>
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
            <TicketChat key={selectedId} ticketId={selectedId} viewerRole="admin" onActivity={() => { void refrescar().catch(() => {}); }} />
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
