import { useEffect, useRef, useState } from 'react';
import { rellenar } from '../components/charts/format';
import {
  getResidenteMe,
  getMisPreautorizaciones,
  createMisPreautorizacion,
  deleteMisPreautorizacion,
  getMisAccesos,
  getMisPagos,
  getEstadoTarjeta,
  type EstadoTarjeta,
  getMiResumenMes,
  type ResumenMes,
  crearTransferencia,
  getMisTickets,
  createTicket,
  getMisInvitaciones,
  revocarInvitacionQr,
  type ResidenteMe,
  type MiPreautorizacion,
  type MiVisita,
  type Pago,
  type Ticket,
  type TicketTipo,
  type InvitacionQr,
} from '../services/api';
import { CardSkeleton, Skeleton, StatSkeleton, Spinner } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n/useTranslation';
import TicketChat, { TIPO_LABEL, ESTADO_BADGE, ESTADO_LABEL } from '../components/TicketChat';
import QrInviteModal from '../components/QrInviteModal';
import PagoTarjetaModal from '../components/PagoTarjetaModal';
import { Badge, Button, EmptyState, ErrorState, ESTADO_PAGO_TONE, Input, ROW_ICON, RowActions, StatusText, useConfirmacion } from '../components/ui';
import AvisarVisitaModal, { type DatosVisita } from '../components/AvisarVisitaModal';
import { useIsHandheld } from '../hooks/useMediaQuery';
import { usePolling } from '../hooks/usePolling';
import { diaISO, formatearFecha, formatearFechaHoraCorta, formatearRangoDias, hoyEnZona } from '../utils/fecha';
import { formatearPlaca, normalizarPlaca } from '../utils/placa';
import PlacaInput from '../components/PlacaInput';

const ICON_VISITA = 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75';

const TICKET_TIPOS: TicketTipo[] = ['mantenimiento', 'queja', 'seguridad', 'otro'];

const today = hoyEnZona;

const EMPTY_FORM = { nombre_visitante: '', numero_dpi: '', placa: '' };
const EMPTY_TRF  = { monto: '', referencia: '', banco: '', fecha_transferencia: today() };

/** Pestañas del portal; la barra inferior de móvil navega directo a una de ellas. */
export type PortalTab = 'pagos' | 'invitados' | 'qr' | 'solicitudes';

interface ResidentePageProps {
  /** Pestaña pedida desde el shell (barra inferior en móvil). */
  requestedTab?: PortalTab;
  /** Cambia en cada pulsación para reabrir la misma pestaña aunque ya esté activa. */
  tabNonce?: number;
}

export default function ResidentePage({ requestedTab, tabNonce = 0 }: ResidentePageProps = {}) {
  const showToast = useToast();
  const { t } = useTranslation();
  const { confirmar, dialogo } = useConfirmacion();
  // En teléfono y tablet la barra inferior del shell ya ofrece estas mismas
  // secciones, así que la barra de pestañas sobra: duplicaba la navegación y
  // se comía una franja de una pantalla que va justa de alto.
  const enMano = useIsHandheld();

  const BADGE_LABEL: Record<string, string> = {
    al_dia: t('residents.current'), mora: t('residents.inDebt'), pendiente: t('residents.pending'),
  };
  const PAGO_METODO_LABEL: Record<string, string> = {
    efectivo: t('payments.cash'), transferencia: t('payments.transfer'),
    tarjeta: t('card.payWithCard'), reserva: t('payments.reservation'),
  };
  const PAGO_ESTADO_LABEL: Record<string, string> = {
    pendiente: t('payments.pending'), aprobado: t('payments.approved'), rechazado: t('payments.rejected'),
  };

  const [data, setData]         = useState<ResidenteMe | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const [tab, setTab]           = useState<PortalTab>(requestedTab ?? 'pagos');

  // Solicitudes (tickets) tab state
  const [tickets, setTickets]           = useState<Ticket[]>([]);
  const [ticketsLoaded, setTicketsLoaded] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null);
  const [showTicketForm, setShowTicketForm] = useState(false);
  const [ticketForm, setTicketForm]     = useState<{ tipo: TicketTipo; titulo: string; mensaje: string }>(
    { tipo: 'mantenimiento', titulo: '', mensaje: '' }
  );
  const [ticketSaving, setTicketSaving] = useState(false);
  const [ticketError, setTicketError]   = useState<string | null>(null);

  // Pagos tab state
  const [misPagos, setMisPagos]           = useState<Pago[]>([]);
  const [pagosLoading, setPagosLoading]   = useState(false);
  const [pagosLoaded, setPagosLoaded]     = useState(false);
  const [resumenMes, setResumenMes]       = useState<ResumenMes | null>(null);
  const [showTrf, setShowTrf]             = useState(false);
  const [trfForm, setTrfForm]             = useState(EMPTY_TRF);
  const [imgBase64, setImgBase64]         = useState<string | null>(null);
  const [imgPreview, setImgPreview]       = useState<string | null>(null);
  const [enviando, setEnviando]           = useState(false);
  const [trfError, setTrfError]           = useState<string | null>(null);
  const [showTarjeta, setShowTarjeta]     = useState(false);
  // Qué pasarela hay: los avisos de «pago simulado» solo se ven si el servidor dice que lo es.
  const [estadoTarjeta, setEstadoTarjeta] = useState<EstadoTarjeta>({ disponible: true, simulada: false });

  // Invitados tab state
  const [preauths, setPreauths] = useState<MiPreautorizacion[]>([]);
  const [visitas, setVisitas]   = useState<MiVisita[]>([]);
  const [invLoading, setInvLoading] = useState(false);
  const [invLoaded, setInvLoaded]   = useState(false);

  const [showForm, setShowForm]       = useState(false);
  const [form, setForm]               = useState(EMPTY_FORM);
  const formRef                       = useRef<HTMLDivElement>(null);
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** «Avisar de una visita»: vacío o con los datos de un visitante guardado. */
  const [avisoDlg, setAvisoDlg] = useState<{ abierto: boolean; inicial: DatosVisita | null }>({ abierto: false, inicial: null });

  // Invitaciones QR tab state
  const [qrInvites, setQrInvites]   = useState<InvitacionQr[]>([]);
  const [qrLoading, setQrLoading]   = useState(false);
  const [qrLoaded, setQrLoaded]     = useState(false);
  const [showQrCreate, setShowQrCreate] = useState(false);
  const [viewingQr, setViewingQr]       = useState<InvitacionQr | null>(null);
  const [revokingQrId, setRevokingQrId] = useState<string | null>(null);

  const loadPagos = () => {
    if (pagosLoaded) return;
    setPagosLoading(true);
    getMisPagos()
      .then(p => { setMisPagos(p); setPagosLoaded(true); })
      .catch(() => showToast('No se pudo cargar el historial de pagos.', 'error'))
      .finally(() => setPagosLoading(false));
    // Desglose del mes: de dónde sale el saldo (cuota, reservas, etc.)
    getMiResumenMes().then(setResumenMes).catch(() => {});
  };

  const loadInvitados = () => {
    if (invLoaded) return;
    setInvLoading(true);
    Promise.all([getMisPreautorizaciones(), getMisAccesos()])
      .then(([p, v]) => { setPreauths(p); setVisitas(v); setInvLoaded(true); })
      .catch(() => setError('No se pudo cargar la sección de invitados.'))
      .finally(() => setInvLoading(false));
  };

  useEffect(() => {
    getResidenteMe()
      .then(setData)
      .catch(() => setError('No se pudo cargar tu información.'))
      .finally(() => setLoading(false));
    getEstadoTarjeta().then(setEstadoTarjeta);
    loadPagos();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTickets = (force = false) => {
    if (ticketsLoaded && !force) return;
    getMisTickets()
      .then(rows => { setTickets(rows); setTicketsLoaded(true); })
      .catch(() => showToast('No se pudo cargar tus solicitudes.', 'error'));
  };

  const closeTicketChat = () => { setSelectedTicket(null); loadTickets(true); };

  // El estado de cada solicitud (abierta → en proceso → cerrada) y los mensajes sin leer se
  // actualizan solos cada 15 s mientras se mira la pestaña de solicitudes, sin recargar.
  usePolling(async () => { setTickets(await getMisTickets()); }, 15_000, tab === 'solicitudes' && ticketsLoaded);

  useEffect(() => {
    if (!selectedTicket) return;
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') closeTicketChat(); };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [selectedTicket]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadQrInvites = () => {
    if (qrLoaded) return;
    setQrLoading(true);
    getMisInvitaciones()
      .then(rows => { setQrInvites(rows); setQrLoaded(true); })
      .catch(() => showToast(t('qr.title') + ': ' + t('common.error'), 'error'))
      .finally(() => setQrLoading(false));
  };

  const handleTabChange = (tab2: PortalTab) => {
    setTab(tab2);
    if (tab2 === 'pagos') loadPagos();
    if (tab2 === 'invitados') loadInvitados();
    if (tab2 === 'qr') loadQrInvites();
    if (tab2 === 'solicitudes') loadTickets();
  };

  // La barra inferior de móvil pide una pestaña concreta; `tabNonce` cambia en
  // cada pulsación para que volver a "Pagos" recargue aunque ya estuviera activa.
  useEffect(() => {
    if (!requestedTab) return;
    handleTabChange(requestedTab);
  }, [requestedTab, tabNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRevokeQr = async (inv: InvitacionQr) => {
    const ok = await confirmar({
      title: t('confirm.revokeQr.title'),
      message: t('confirm.revokeQr.message'),
      confirmLabel: t('qr.revoke'),
      tone: 'danger',
    });
    if (!ok) return;
    setRevokingQrId(inv.id);
    try {
      await revocarInvitacionQr(inv.id);
      setQrInvites(prev => prev.filter(i => i.id !== inv.id));
      showToast(t('qr.revoked'), 'warning');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setRevokingQrId(null);
    }
  };

  const qrEstado = (inv: InvitacionQr): 'active' | 'expired' | 'exhausted' => {
    const hoy = today();
    if (inv.fecha_fin && inv.fecha_fin < hoy) return 'expired';
    if (inv.usos_maximos != null && inv.usos_actuales >= inv.usos_maximos) return 'exhausted';
    return 'active';
  };

  const QR_ESTADO_BADGE: Record<string, string> = {
    active:    'bg-green-900/40 text-green-400',
    expired:   'bg-gray-700 text-gray-300',
    exhausted: 'bg-amber-900/50 text-amber-400',
  };
  const QR_ESTADO_LABEL: Record<string, string> = {
    active:    t('qr.statusActive'),
    expired:   t('qr.statusExpired'),
    exhausted: t('qr.statusExhausted'),
  };

  const ticketsUnread = tickets.reduce((s, tk) => s + Number(tk.no_leidos || 0), 0);

  const handleCreateTicket = async () => {
    if (!ticketForm.titulo.trim())  { setTicketError(t('tickets.titleRequired')); return; }
    if (!ticketForm.mensaje.trim()) { setTicketError(t('tickets.messageRequired')); return; }
    setTicketError(null); setTicketSaving(true);
    try {
      const nuevo = await createTicket({
        tipo:    ticketForm.tipo,
        titulo:  ticketForm.titulo.trim(),
        mensaje: ticketForm.mensaje.trim(),
      });
      setShowTicketForm(false);
      setTicketForm({ tipo: 'mantenimiento', titulo: '', mensaje: '' });
      loadTickets(true);
      setSelectedTicket(nuevo.id);
      showToast(t('tickets.created'), 'success');
    } catch (err) {
      setTicketError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setTicketSaving(false);
    }
  };

  const handleTrfChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setTrfForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleImgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setTrfError('La imagen no debe superar 5 MB.'); return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      setImgPreview(dataUrl);
      setImgBase64(dataUrl.replace(/^data:[^;]+;base64,/, ''));
    };
    reader.readAsDataURL(file);
  };

  const resetTrfForm = () => {
    setShowTrf(false);
    setTrfForm(EMPTY_TRF);
    setImgBase64(null);
    setImgPreview(null);
    setTrfError(null);
  };

  const handleEnviarTransferencia = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrfError(null);
    if (!trfForm.monto || !trfForm.referencia || !trfForm.banco || !trfForm.fecha_transferencia) {
      setTrfError('Todos los campos son requeridos.'); return;
    }
    if (Number(trfForm.monto) <= 0) { setTrfError('El monto debe ser mayor a 0.'); return; }
    setEnviando(true);
    try {
      const nuevo = await crearTransferencia({
        monto: Number(trfForm.monto),
        referencia: trfForm.referencia,
        banco: trfForm.banco,
        fecha_transferencia: trfForm.fecha_transferencia,
        comprobante: imgBase64 || undefined,
      });
      setMisPagos(prev => [nuevo, ...prev]);
      resetTrfForm();
      showToast(t('portal.receiptSent'), 'success');
    } catch (err: unknown) {
      setTrfError(err instanceof Error ? err.message : 'Error al enviar');
    } finally {
      setEnviando(false);
    }
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!form.numero_dpi.trim() && !form.placa.trim()) {
      setFormError('Se requiere al menos DPI o placa del visitante.');
      return;
    }
    setSaving(true);
    try {
      const created = await createMisPreautorizacion({
        nombre_visitante: form.nombre_visitante,
        numero_dpi:       form.numero_dpi || undefined,
        placa:            normalizarPlaca(form.placa) || undefined,
        fecha_inicio:     today(),
      });
      setPreauths(prev => [created, ...prev]);
      setShowForm(false);
      setForm(EMPTY_FORM);
      showToast(t('aviso.saved.save'), 'success');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  /** Avisar de la visita de alguien ya guardado: abre el mismo formulario, con sus datos puestos. */
  const avisarDe = (p: MiPreautorizacion) => setAvisoDlg({
    abierto: true,
    inicial: { nombre_visitante: p.nombre_visitante, numero_dpi: p.numero_dpi, placa: p.placa },
  });

  const handleDelete = async (id: string, nombre: string, guardado: boolean) => {
    const clave = guardado ? 'deleteSavedVisitor' : 'deleteNotice';
    const ok = await confirmar({
      title: rellenar(t(`confirm.${clave}.title`), { nombre }),
      message: t(`confirm.${clave}.message`),
      confirmLabel: guardado ? t('common.delete') : t('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;
    setDeletingId(id);
    try {
      await deleteMisPreautorizacion(id);
      setPreauths(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo eliminar', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  // Una fila sin fecha_fin es un visitante guardado (no autoriza nada); con fecha_fin es una visita avisada.
  const hoyDia = today();
  const estadoAviso = (p: MiPreautorizacion): 'hoy' | 'proxima' => ((diaISO(p.fecha_inicio) ?? '') > hoyDia ? 'proxima' : 'hoy');
  const guardados = preauths.filter(p => p.fecha_fin === null);
  const avisos = preauths
    .filter(p => p.fecha_fin !== null && (diaISO(p.fecha_fin) ?? '') >= hoyDia)
    .sort((a, b) => (diaISO(a.fecha_inicio) ?? '').localeCompare(diaISO(b.fecha_inicio) ?? ''));

  if (loading) {
    return (
      <div className="sg-page-inner space-y-6 py-6">
        <div className="space-y-2">
          <Skeleton height="1.5rem" width="42%" />
          <Skeleton height="0.875rem" width="64%" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatSkeleton count={4} />
        </div>
        <CardSkeleton count={3} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <ErrorState
        title={t('error.title')}
        description={t('error.desc')}
        detail={error}
        action={<Button onClick={() => window.location.reload()}>{t('error.retry')}</Button>}
      />
    );
  }

  const saldo = parseFloat(data!.saldo_pendiente);

  return (
    <main className="sg-page text-gray-100">
      <div className="sg-page-inner space-y-6">
        {/* Summary card */}
      <div className="sg-card overflow-hidden p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-gray-400 text-sm">{t('portal.house')}</p>
            <p className="text-3xl font-bold text-white mt-1">{data!.numero_casa}</p>
          </div>
          <Badge tone={ESTADO_PAGO_TONE[data!.estado_pago] ?? 'neutral'} dot className="mt-1 self-start">
            {BADGE_LABEL[data!.estado_pago] ?? data!.estado_pago}
          </Badge>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 border-t border-white/10 pt-5 sm:grid-cols-2">
          <div>
            <p className="text-gray-400 text-xs">{t('portal.pendingBalance')}</p>
            <p className={`text-xl font-semibold mt-0.5 ${saldo > 0 ? 'text-red-400' : 'text-green-400'}`}>
              Q{saldo.toFixed(2)}
            </p>
            {saldo > 0 && (
              <p className="text-gray-500 text-xs mt-0.5">Incluye cargos por mora aplicados automáticamente</p>
            )}
          </div>
          {data!.telefono && (
            <div>
              <p className="text-gray-400 text-xs">{t('common.phone')}</p>
              <p className="text-white text-sm mt-0.5">{data!.telefono}</p>
            </div>
          )}
        </div>
      </div>

      {/* Barra de pestañas: sólo en escritorio (ver `enMano`). */}
      {!enMano && (
      <div className="sg-tabbar" role="tablist" aria-label="Secciones del portal">
        {(['pagos', 'invitados', 'qr', 'solicitudes'] as const).map(tabKey => (
          <button
            key={tabKey}
            onClick={() => handleTabChange(tabKey)}
            role="tab"
            aria-selected={tab === tabKey}
            className={`sg-tab relative flex-1 ${tab === tabKey ? 'sg-tab-active' : ''}`}
          >
            {tabKey === 'pagos'
              ? t('portal.payments')
              : tabKey === 'invitados'
              ? t('portal.visitors')
              : tabKey === 'qr'
              ? t('qr.tabTitle')
              : t('tickets.myTickets')}
            {tabKey === 'solicitudes' && ticketsUnread > 0 && (
              <span className="absolute top-1.5 right-2 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-[10px] font-bold leading-none">
                {ticketsUnread > 9 ? '9+' : ticketsUnread}
              </span>
            )}
          </button>
        ))}
      </div>
      )}

      {/* ── Tab: Pagos ── */}
      {tab === 'pagos' && (
        <div className="space-y-4 lg:grid lg:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1.25fr)] lg:gap-4 lg:space-y-0">
          {/* Resumen de la factura del mes: desglosa el saldo por concepto */}
          <div className="sg-card space-y-3 p-5 sm:p-6">
            <h2 className="text-base font-semibold text-white">{t('reservas.monthSummary')}</h2>
            {!resumenMes || resumenMes.items.length === 0 ? (
              <p className="text-sm text-gray-500">{t('reservas.monthSummaryEmpty')}</p>
            ) : (
              <>
                <ul className="space-y-2">
                  {resumenMes.items.map(item => (
                    <li key={item.id} className="flex justify-between gap-3 text-sm">
                      <span className="text-gray-300">
                        {item.concepto || t('reservas.maintenanceFee')}
                      </span>
                      <span className="text-gray-200 font-medium whitespace-nowrap">
                        Q{parseFloat(item.monto).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-between gap-3 text-sm border-t border-gray-700 pt-2">
                  <span className="font-semibold text-gray-300">{t('reservas.monthTotal')}</span>
                  <span className="font-bold text-emerald-400">
                    Q{resumenMes.total_pendiente.toFixed(2)}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Realizar Pago card */}
          <div className="sg-card space-y-4 p-5 sm:p-6">
            <div>
              <h2 className="text-base font-semibold text-white">{t('portal.makePayment')}</h2>
              <p className="text-sm text-gray-400 mt-0.5">
                {t('portal.pendingBalance')}:{' '}
                <span className={`font-semibold ${parseFloat(data!.saldo_pendiente) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  Q{parseFloat(data!.saldo_pendiente).toFixed(2)}
                </span>
              </p>
            </div>

            {!showTrf ? (
              <div className="space-y-3">
                {estadoTarjeta.disponible ? (
                  <button
                    onClick={() => setShowTarjeta(true)}
                      className="sg-btn sg-btn-primary flex w-full items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                    {t('portal.payCard')}
                  </button>
                ) : (
                  <p role="status" className="rounded-lg border border-gray-600 bg-gray-500/10 px-3 py-2.5 text-xs text-gray-300">
                    {t('portal.cardUnavailable')}
                  </p>
                )}
                <button
                  onClick={() => setShowTrf(true)}
                    className="sg-btn sg-btn-secondary flex w-full items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  {t('portal.uploadReceipt')}
                </button>
              </div>
            ) : (
              <form onSubmit={handleEnviarTransferencia} className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">{t('portal.receiptTitle')}</h3>
                  <button type="button" onClick={resetTrfForm}
                    className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
                </div>
                {trfError && (
                  <p className="text-sm text-red-400 bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2">{trfError}</p>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">{t('portal.amountLabel')} *</label>
                    <input type="number" name="monto" step="0.01" min="0.01" value={trfForm.monto}
                      onChange={handleTrfChange} placeholder="850.00"
                      className="sg-input" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">{t('portal.bankLabel')} *</label>
                    <input type="text" name="banco" value={trfForm.banco}
                      onChange={handleTrfChange} placeholder="Banco Industrial"
                      className="sg-input" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">{t('portal.reference')} *</label>
                    <input type="text" name="referencia" value={trfForm.referencia}
                      onChange={handleTrfChange} placeholder="TRF-789456123"
                      className="sg-input" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">{t('portal.transferDate')} *</label>
                    <input type="date" name="fecha_transferencia" value={trfForm.fecha_transferencia}
                      onChange={handleTrfChange}
                      className="sg-input" />
                  </div>
                </div>

                {/* Image upload */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('portal.receiptImage')}</label>
                  <label className="flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-xl border border-dashed border-gray-500 bg-gray-700 px-3 py-2.5 transition-colors hover:border-emerald-400">
                    <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm text-gray-400 truncate">
                      {imgPreview ? t('portal.imageSelected') : t('portal.selectImage')}
                    </span>
                    <input type="file" accept="image/*" onChange={handleImgChange} className="hidden" />
                  </label>
                  {imgPreview && (
                    <div className="mt-2 relative">
                      <img src={imgPreview} alt="Vista previa" className="w-full max-h-40 object-contain rounded-lg border border-gray-600 bg-gray-900" />
                      <button type="button" onClick={() => { setImgBase64(null); setImgPreview(null); }}
                        className="absolute top-1 right-1 bg-gray-900/80 hover:bg-red-900/80 text-gray-300 hover:text-red-300 rounded-full w-6 h-6 flex items-center justify-center text-xs transition-colors">
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 pt-1">
                  <button type="submit" disabled={enviando}
                    className="sg-btn sg-btn-primary flex flex-1 items-center justify-center gap-2 text-sm">
                    {enviando && <Spinner size={14} />}
                    {enviando ? t('portal.sending') : t('portal.sendReceipt')}
                  </button>
                  <button type="button" onClick={resetTrfForm}
                    className="sg-btn sg-btn-secondary px-4 text-sm">
                    {t('common.cancel')}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Historial de Pagos */}
          <div className="lg:col-span-2">
            <h2 className="mb-3 text-base font-semibold text-white">{t('portal.payHistory')}</h2>
            {pagosLoading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner size={24} />
              </div>
            ) : misPagos.filter(p => p.estado !== 'rechazado').length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">{t('portal.noPayments')}</p>
            ) : (
              <div className="space-y-3">
                {misPagos.filter(p => p.estado !== 'rechazado').map(p => (
                  <div key={p.id} className="sg-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
                    <div className="w-10 h-10 bg-emerald-900/40 rounded-full flex items-center justify-center border border-emerald-700/40 shrink-0">
                      <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-white font-semibold text-sm">Q{parseFloat(p.monto).toFixed(2)}</p>
                        <Badge tone={ESTADO_PAGO_TONE[p.estado] ?? 'neutral'} dot>
                          {PAGO_ESTADO_LABEL[p.estado] ?? p.estado}
                        </Badge>
                      </div>
                      <p className="text-gray-400 text-xs mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <span>
                          {formatearFecha(p.fecha_pago)} | {PAGO_METODO_LABEL[p.metodo] ?? p.metodo}
                          {p.tarjeta_ultimos4 && ` ···· ${p.tarjeta_ultimos4}`}
                        </span>
                        {p.es_simulado && estadoTarjeta.simulada && <Badge tone="warning">{t('card.simulated')}</Badge>}
                      </p>
                      {p.referencia && (
                        <p className="text-gray-500 text-xs mt-0.5 font-mono">{p.referencia}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Un comprobante rechazado no es un pago: no va en el historial, pero el motivo
                sigue a la mano para poder corregirlo y volver a enviarlo. */}
            {misPagos.some(p => p.estado === 'rechazado') && (
              <details className="mt-4 rounded-xl border border-gray-700 bg-gray-500/[0.04] px-4 py-3">
                <summary className="cursor-pointer text-sm font-semibold text-gray-200">
                  {t('portal.rejectedReceipts')} ({misPagos.filter(p => p.estado === 'rechazado').length})
                </summary>
                <p className="mt-2 text-xs text-gray-400">{t('portal.rejectedReceiptsHint')}</p>
                <ul className="mt-2 space-y-2">
                  {misPagos.filter(p => p.estado === 'rechazado').map(p => (
                    <li key={p.id} className="text-sm text-gray-300">
                      <span className="font-semibold">Q{parseFloat(p.monto).toFixed(2)}</span>
                      {' · '}{formatearFecha(p.fecha_pago)}
                      {p.referencia && <span className="font-mono text-xs text-gray-400"> · {p.referencia}</span>}
                      {p.comentario_rechazo && (
                        <span className="block text-xs italic text-danger-400">{t('portal.rejectedReason')}: "{p.comentario_rechazo}"</span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Invitados ── */}
      {tab === 'invitados' && (
        <div className="space-y-8">
          {invLoading ? (
            <CardSkeleton count={4} />
          ) : (
            <>
              {/* Visitas avisadas: lo que la garita está esperando */}
              <section aria-labelledby="visitas-avisadas">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 id="visitas-avisadas" className="text-base font-semibold text-white">{t('aviso.mine.title')}</h2>
                  <Button onClick={() => setAvisoDlg({ abierto: true, inicial: null })}>{t('aviso.title')}</Button>
                </div>
                {avisos.length === 0 ? (
                  <EmptyState compact icon={ICON_VISITA} title={t('aviso.mine.empty')} description={t('aviso.mine.emptyHint')} />
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {avisos.map(p => (
                      <div key={p.id} className="sg-card p-4">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-white">{p.nombre_visitante}</p>
                          <StatusText kind={estadoAviso(p) === 'hoy' ? 'on' : 'warn'}>
                            {t(estadoAviso(p) === 'hoy' ? 'aviso.state.current' : 'aviso.state.upcoming')}
                          </StatusText>
                        </div>
                        <div className="mt-2 space-y-0.5 text-xs text-gray-400">
                          <p className="text-gray-300">{formatearRangoDias(p.fecha_inicio, p.fecha_fin)}</p>
                          {p.numero_dpi && <p>{t('portal.dpi')}: {p.numero_dpi}</p>}
                          {p.placa      && <p>{t('portal.plate')}: {formatearPlaca(p.placa)}</p>}
                        </div>
                        <div className="mt-3">
                          <RowActions
                            align="start"
                            menuLabel={`${t('common.actions')}: ${p.nombre_visitante}`}
                            actions={[
                              {
                                id: 'eliminar',
                                label: t('common.delete'),
                                icon: ROW_ICON.trash,
                                tone: 'danger',
                                loading: deletingId === p.id,
                                onClick: () => handleDelete(p.id, p.nombre_visitante, false),
                              },
                            ]}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <div className="space-y-8 lg:grid lg:grid-cols-2 lg:gap-8 lg:space-y-0">
                {/* Visitantes guardados: la libreta; guardar a alguien NO deja entrar a nadie */}
                <section aria-labelledby="visitantes-guardados">
                  <div className="mb-1 flex items-center justify-between">
                    <h2 id="visitantes-guardados" className="text-base font-semibold text-white">{t('aviso.saved.title')}</h2>
                    {!showForm && (
                      <Button variant="secondary" onClick={() => setShowForm(true)}>{t('aviso.saved.save')}</Button>
                    )}
                  </div>
                  <p className="mb-4 text-xs text-gray-400">{t('aviso.saved.hint')}</p>

                  {/* Inline create form */}
                  {showForm && (
                    <div ref={formRef}>
                      <form onSubmit={handleSave} className="sg-card mb-4 space-y-4 p-5 sm:p-6">
                        <h3 className="text-sm font-semibold text-white">{t('aviso.saved.form')}</h3>
                        <p className="text-xs text-gray-400">{t('aviso.saved.formHint')}</p>

                        {formError && (
                          <div role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-sm text-danger-400">
                            {formError}
                          </div>
                        )}

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <Input
                            wrapperClassName="sm:col-span-2"
                            name="nombre_visitante"
                            label={t('portal.visitorName')}
                            value={form.nombre_visitante}
                            onChange={handleFormChange}
                            required
                            placeholder="Juan Pérez"
                          />
                          <Input
                            name="numero_dpi"
                            label={`${t('portal.dpi')} (${t('aviso.saved.orPlate')})`}
                            value={form.numero_dpi}
                            onChange={handleFormChange}
                            placeholder="1234567890101"
                            inputMode="numeric"
                          />
                          <div className="min-w-0">
                            <label htmlFor="guardado-placa" className="mb-1.5 block text-xs font-semibold text-gray-300">
                              {t('portal.plate')} ({t('aviso.saved.orDpi')})
                            </label>
                            <PlacaInput
                              id="guardado-placa"
                              name="placa"
                              value={form.placa}
                              onChange={placa => setForm(prev => ({ ...prev, placa }))}
                            />
                          </div>
                        </div>

                        <div className="flex gap-3 pt-1">
                          <Button type="submit" loading={saving} className="px-5">
                            {saving ? t('common.saving') : t('common.save')}
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => { setShowForm(false); setFormError(null); setForm(EMPTY_FORM); }}
                            className="px-5"
                          >
                            {t('common.cancel')}
                          </Button>
                        </div>
                      </form>
                    </div>
                  )}

                  {guardados.length === 0 ? (
                    !showForm && <p className="py-8 text-center text-sm text-gray-400">{t('aviso.saved.empty')}</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {guardados.map(p => (
                        <div key={p.id} className="sg-card p-4">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold text-white">{p.nombre_visitante}</p>
                            <span className="shrink-0 rounded-full bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-300">
                              {t('aviso.saved.badge')}
                            </span>
                          </div>
                          <div className="mt-2 space-y-0.5 text-xs text-gray-400">
                            {p.numero_dpi && <p>{t('portal.dpi')}: {p.numero_dpi}</p>}
                            {p.placa      && <p>{t('portal.plate')}: {formatearPlaca(p.placa)}</p>}
                          </div>
                          <div className="mt-3">
                            <RowActions
                              align="start"
                              inline={2}
                              menuLabel={`${t('common.actions')}: ${p.nombre_visitante}`}
                              actions={[
                                {
                                  id: 'avisar',
                                  label: t('aviso.saved.notify'),
                                  icon: ROW_ICON.clock,
                                  tone: 'primary',
                                  onClick: () => avisarDe(p),
                                },
                                {
                                  id: 'eliminar',
                                  label: t('common.delete'),
                                  icon: ROW_ICON.trash,
                                  tone: 'danger',
                                  loading: deletingId === p.id,
                                  onClick: () => handleDelete(p.id, p.nombre_visitante, true),
                                },
                              ]}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Historial */}
                <section>
                  <h2 className="mb-4 text-base font-semibold text-white">{t('portal.visitHistory')}</h2>
                  {visitas.length === 0 ? (
                    <p className="py-8 text-center text-sm text-gray-400">{t('portal.noVisits')}</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {visitas.map(v => (
                        <div key={v.id} className="sg-card p-4">
                          <p className="text-sm font-semibold text-white">{v.nombre_visitante}</p>
                          <div className="mt-2 space-y-0.5 text-xs text-gray-400">
                            <p>{t('portal.dpi')}: {v.numero_dpi}</p>
                            {v.placa && <p>{t('portal.plate')}: {formatearPlaca(v.placa)}</p>}
                            <p className="mt-1 text-gray-300">
                              {t('portal.entry')}: {formatearFechaHoraCorta(v.timestamp_entrada)}
                            </p>
                            {v.timestamp_salida ? (
                              <p>{t('portal.exit')}: {formatearFechaHoraCorta(v.timestamp_salida)}</p>
                            ) : (
                              <span className="mt-1 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                                {t('portal.active')}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}

          <AvisarVisitaModal
            open={avisoDlg.abierto}
            onClose={() => setAvisoDlg(d => ({ ...d, abierto: false }))}
            inicial={avisoDlg.inicial}
            onCreada={creada => setPreauths(prev => [creada as MiPreautorizacion, ...prev])}
          />
        </div>
      )}

      {/* ── Tab: Invitaciones QR ── */}
      {tab === 'qr' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">{t('qr.title')}</h2>
              <p className="text-sm text-gray-400 mt-0.5">{t('qr.subtitle')}</p>
            </div>
            <button
              onClick={() => setShowQrCreate(true)}
              className="bg-emerald-700 hover:bg-emerald-600 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors"
            >
              {t('qr.newInvite')}
            </button>
          </div>

          {qrLoading ? (
            <CardSkeleton count={3} />
          ) : qrInvites.length === 0 ? (
            <div className="sg-card px-4 py-10 text-center text-gray-500">
              {t('qr.noInvites')}
            </div>
          ) : (
            <div className="space-y-3">
              {qrInvites.map(inv => {
                const estado = qrEstado(inv);
                return (
                  <div key={inv.id} className="sg-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white truncate">
                          {inv.etiqueta || (inv.tipo === 'individual' ? inv.nombre_visitante : t('qr.typeGroup'))}
                        </span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${QR_ESTADO_BADGE[estado]}`}>
                          {QR_ESTADO_LABEL[estado]}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        {inv.tipo === 'individual' ? t('qr.typeIndividual') : t('qr.typeGroup')}
                        {inv.usos_maximos != null && ` · ${inv.usos_actuales}/${inv.usos_maximos} ${t('qr.usesLabel')}`}
                      </p>
                    </div>
                    <div className="flex-shrink-0">
                      <RowActions
                        inline={2}
                        menuLabel={`${t('common.actions')}: ${inv.nombre_visitante}`}
                        actions={[
                          { id: 'ver', label: t('qr.viewQr'), icon: ROW_ICON.view, tone: 'primary', onClick: () => setViewingQr(inv) },
                          {
                            id: 'revocar',
                            label: t('qr.revoke'),
                            icon: ROW_ICON.close,
                            tone: 'danger',
                            loading: revokingQrId === inv.id,
                            onClick: () => handleRevokeQr(inv),
                          },
                        ]}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showQrCreate && (
        <QrInviteModal
          onClose={() => setShowQrCreate(false)}
          onCreated={inv => {
            setQrInvites(prev => [inv, ...prev]);
            showToast(t('qr.created'));
          }}
        />
      )}
      {viewingQr && (
        <QrInviteModal invitacion={viewingQr} onClose={() => setViewingQr(null)} />
      )}

      {/* ── Tab: Solicitudes (tickets) ── */}
      {tab === 'solicitudes' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">{t('tickets.myTickets')}</h2>
            {!showTicketForm && (
              <button
                onClick={() => { setShowTicketForm(true); setTicketError(null); }}
                className="text-sm bg-emerald-700 hover:bg-emerald-600 text-white font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {t('tickets.new')}
              </button>
            )}
          </div>

          {/* Nuevo ticket */}
          {showTicketForm && (
            <div className="sg-card space-y-4 p-5 sm:p-6">
              <h3 className="text-sm font-semibold text-white">{t('tickets.newTitle')}</h3>
              {ticketError && (
                <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">{ticketError}</div>
              )}
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('tickets.typeLabel')}</label>
                <select
                  value={ticketForm.tipo}
                  onChange={e => setTicketForm(p => ({ ...p, tipo: e.target.value as TicketTipo }))}
                  className="sg-input"
                >
                  {TICKET_TIPOS.map(tp => <option key={tp} value={tp}>{t(TIPO_LABEL[tp])}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('tickets.titleLabel')}</label>
                <input
                  type="text"
                  value={ticketForm.titulo}
                  onChange={e => setTicketForm(p => ({ ...p, titulo: e.target.value }))}
                  placeholder={t('tickets.titlePlaceholder')}
                  className="sg-input"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('tickets.messageLabel')}</label>
                <textarea
                  value={ticketForm.mensaje}
                  onChange={e => setTicketForm(p => ({ ...p, mensaje: e.target.value }))}
                  rows={3}
                  placeholder={t('tickets.messagePlaceholder')}
                  className="sg-input resize-none"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleCreateTicket}
                  disabled={ticketSaving}
                  className="flex-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold py-2 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {ticketSaving && <Spinner size={14} />}
                  {ticketSaving ? t('common.saving') : t('tickets.send')}
                </button>
                <button
                  onClick={() => { setShowTicketForm(false); setTicketError(null); }}
                  className="bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium px-4 py-2 rounded-xl transition-colors"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}

          {/* Lista de tickets */}
          {!ticketsLoaded ? (
            <div className="flex items-center justify-center py-8"><Spinner size={22} /></div>
          ) : tickets.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">{t('tickets.emptyResident')}</p>
          ) : (
            <div className="space-y-2">
              {tickets.map(tk => (
                <button
                  key={tk.id}
                  onClick={() => setSelectedTicket(tk.id)}
                  className="sg-card w-full text-left p-4 transition hover:border-emerald-500/40 hover:bg-gray-700/60"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium text-sm flex-1 truncate">{tk.titulo}</span>
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
                  </div>
                  {tk.ultimo_mensaje && (
                    <p className="text-xs text-gray-500 mt-1 truncate">{tk.ultimo_mensaje}</p>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Chat overlay */}
          {selectedTicket && (
            <div
              className="sg-drawer-backdrop fixed inset-0 z-50 flex flex-col p-3 sm:p-6"
              onClick={closeTicketChat}
            >
              <button
                onClick={closeTicketChat}
                className="self-end text-gray-300 hover:text-white mb-2 text-sm relative z-10"
              >
                ✕ {t('common.cancel')}
              </button>
              <div
                className="flex-1 min-h-0 max-w-lg w-full mx-auto relative z-10"
                onClick={e => e.stopPropagation()}
              >
                <TicketChat key={selectedTicket} ticketId={selectedTicket} viewerRole="residente" onActivity={() => loadTickets(true)} />
              </div>
            </div>
          )}
        </div>
      )}
      </div>

      {/* Pasarela de tarjeta simulada; ver PagoTarjetaModal. */}
      <PagoTarjetaModal
        open={showTarjeta}
        onClose={() => setShowTarjeta(false)}
        saldo={saldo}
        simulada={estadoTarjeta.simulada}
        onResultado={pago => {
          // Solo llegan pagos APROBADOS (un rechazo no se guarda): entran al historial y
          // el saldo queda al día.
          setMisPagos(prev => [pago, ...prev]);
          showToast(t('card.approved').replace('{monto}', parseFloat(pago.monto).toFixed(2)));
          setData(prev => prev ? { ...prev, saldo_pendiente: '0.00', estado_pago: 'al_dia' } : prev);
          getMiResumenMes().then(setResumenMes).catch(() => {});
        }}
      />
      {dialogo}
    </main>
  );
}
