/* Este módulo comparte mapas de etiquetas con las vistas de tickets. */
/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getTicketMensajes, addTicketMensaje, cerrarTicket,
  decodeTokenPayload,
  type Ticket, type TicketMensaje,
} from '../services/api';
import { Skeleton } from './Skeleton';
import { Button } from './ui';
import { useTranslation } from '../i18n/useTranslation';
import { usePolling } from '../hooks/usePolling';

export const TIPO_LABEL: Record<string, string> = {
  mantenimiento: 'tickets.tipoMantenimiento',
  queja:         'tickets.tipoQueja',
  seguridad:     'tickets.tipoSeguridad',
  otro:          'tickets.tipoOtro',
};

export const ESTADO_BADGE: Record<string, string> = {
  abierto:    'bg-blue-900/50 text-blue-400',
  en_proceso: 'bg-amber-900/50 text-amber-400',
  cerrado:    'bg-gray-700 text-gray-400',
};

export const ESTADO_LABEL: Record<string, string> = {
  abierto:    'tickets.estadoAbierto',
  en_proceso: 'tickets.estadoEnProceso',
  cerrado:    'tickets.estadoCerrado',
};

interface Props {
  ticketId: string;
  viewerRole: 'admin' | 'residente';
  onActivity?: () => void;   // notifica al padre para refrescar la lista/badges
}

export default function TicketChat({ ticketId, viewerRole, onActivity }: Props) {
  const { t } = useTranslation();
  const [ticket, setTicket]     = useState<Ticket | null>(null);
  const [mensajes, setMensajes] = useState<TicketMensaje[]>([]);
  const [loading, setLoading]   = useState(true);
  const [texto, setTexto]       = useState('');
  const [sending, setSending]   = useState(false);
  const [closing, setClosing]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const myId = (() => {
    const token = localStorage.getItem('token');
    return token ? (decodeTokenPayload(token)?.id as string) ?? '' : '';
  })();

  const load = () => {
    setLoading(true);
    getTicketMensajes(ticketId)
      .then(({ ticket, mensajes }) => { firma.current = firmaDe(ticket, mensajes); setTicket(ticket); setMensajes(mensajes); })
      .catch(() => setError(t('tickets.errorLoad')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* opening the chat marks it read server-side */ onActivity?.(); }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Sondeo ligero: mientras el chat está abierto se vuelve a pedir la conversación cada 10 s para que
   * el estado del encabezado (abierto → en proceso → cerrado) y los mensajes nuevos de la otra persona
   * aparezcan solos, sin recargar. Es silencioso: no vuelve a mostrar el esqueleto de carga ni pisa lo
   * que se está escribiendo.
   */
  const firma = useRef('');
  const firmaDe = (tk: Ticket, ms: TicketMensaje[]) => `${tk.estado}|${tk.titulo}|${ms.length}|${ms.at(-1)?.id ?? ''}`;

  const refrescar = useCallback(async () => {
    const { ticket: nuevo, mensajes: nuevos } = await getTicketMensajes(ticketId);
    const f = firmaDe(nuevo, nuevos);
    if (f === firma.current) return;      // nada cambió: no se repinta ni se molesta al padre
    firma.current = f;
    setTicket(nuevo);
    setMensajes(nuevos);
    onActivity?.();
  }, [ticketId, onActivity]);
  usePolling(refrescar, 10_000, !loading && !error);

  useEffect(() => { bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' }); }, [mensajes.length]);

  const cerrado = ticket?.estado === 'cerrado';
  const inputBloqueado = cerrado && viewerRole === 'residente';

  const handleSend = async () => {
    if (!texto.trim() || sending) return;
    setSending(true); setError(null);
    try {
      const nuevo = await addTicketMensaje(ticketId, texto.trim());
      setMensajes(prev => [...prev, nuevo]);
      setTexto('');
      onActivity?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSending(false);
    }
  };

  const handleClose = async () => {
    if (!window.confirm(t('tickets.confirmClose'))) return;
    setClosing(true);
    try {
      const updated = await cerrarTicket(ticketId);
      setTicket(updated);
      onActivity?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setClosing(false);
    }
  };

  const fmt = (d: string) =>
    new Date(d).toLocaleString('es-GT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-col h-full bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm truncate">{ticket?.titulo ?? '…'}</p>
          {ticket && (
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-400">{t(TIPO_LABEL[ticket.tipo] ?? 'tickets.tipoOtro')}</span>
              <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${ESTADO_BADGE[ticket.estado]}`}>
                {t(ESTADO_LABEL[ticket.estado])}
              </span>
            </div>
          )}
        </div>
        {viewerRole === 'admin' && ticket && !cerrado && (
          <button
            onClick={handleClose}
            disabled={closing}
            className="text-xs bg-gray-700 hover:bg-red-900/60 hover:text-red-300 text-gray-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 shrink-0"
          >
            {closing ? '…' : t('tickets.close')}
          </button>
        )}
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {loading ? (
          /* Burbujas alternadas: mantiene la silueta de la conversación al cargar. */
          <div className="space-y-3" role="status" aria-label={t('common.loading')}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={`flex ${i % 2 ? 'justify-end' : 'justify-start'}`}>
                <Skeleton
                  height="2.75rem"
                  width={`${52 + (i % 3) * 12}%`}
                  className="max-w-[80%] rounded-2xl"
                />
              </div>
            ))}
          </div>
        ) : mensajes.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">{t('tickets.noMessages')}</p>
        ) : (
          mensajes.map(m => {
            const mine = m.autor_id === myId;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                  mine ? 'bg-brand-500 text-brand-ink' : 'bg-gray-700 text-gray-100'
                }`}>
                  {!mine && (
                    <p className="text-[11px] font-semibold text-gray-300 mb-0.5">{m.autor_nombre}</p>
                  )}
                  <p className="text-sm whitespace-pre-line break-words">{m.mensaje}</p>
                  <p className={`text-[10px] mt-1 ${mine ? 'text-blue-200' : 'text-gray-400'}`}>{fmt(m.created_at)}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-700 p-3 shrink-0">
        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
        {inputBloqueado ? (
          <p className="text-xs text-gray-500 text-center py-2">{t('tickets.closedNotice')}</p>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              rows={1}
              placeholder={t('tickets.messagePlaceholder')}
              className="flex-1 bg-gray-700 border border-gray-600 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none max-h-28"
            />
            <Button onClick={handleSend} disabled={!texto.trim()} loading={sending}>
              {t('tickets.send')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
