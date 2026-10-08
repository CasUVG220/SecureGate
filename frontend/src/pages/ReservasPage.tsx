import { useEffect, useRef, useState } from 'react';
import {
  getAreas, getDisponibilidad, crearReserva, getMisReservas,
  getPreviewCancelacion, cancelarReserva,
  type AreaComun, type Disponibilidad, type Reserva, type PreviewCancelacion,
  type EstadoReserva,
} from '../services/api';
import { CardSkeleton, SkeletonText, Spinner } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { ROW_ICON, RowActions } from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';
import { esImagenValida } from '../utils/imagen';

const ESTADO_CLASS: Record<EstadoReserva, string> = {
  pendiente_aprobacion: 'bg-yellow-900/40 text-yellow-400 border-yellow-700/40',
  confirmada:           'bg-green-900/40 text-green-400 border-green-700/40',
  cancelada:            'bg-gray-800 text-gray-400 border-gray-700',
  rechazada:            'bg-red-900/40 text-red-400 border-red-700/40',
  completada:           'bg-blue-900/40 text-blue-400 border-blue-700/40',
};

const ESTADO_LABEL_KEY: Record<EstadoReserva, string> = {
  pendiente_aprobacion: 'reservas.statusPending',
  confirmada:           'reservas.statusConfirmed',
  cancelada:            'reservas.statusCancelled',
  rechazada:            'reservas.statusRejected',
  completada:           'reservas.statusCompleted',
};

const hoy = () => new Date().toISOString().slice(0, 10);
const fmtFecha = (f: string) => new Date(f).toLocaleDateString('es-GT', { timeZone: 'UTC' });
const fmtHora = (h: string) => h.slice(0, 5);
const fmtHoraTs = (ts: string) =>
  new Date(ts).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit', hour12: false });

const horaAMin = (h: string) => {
  const [hh, mm] = h.split(':').map(Number);
  return Number.isFinite(hh) && Number.isFinite(mm) ? hh * 60 + mm : NaN;
};

export default function ReservasPage() {
  const { t } = useTranslation();
  const showToast = useToast();

  const [areas, setAreas] = useState<AreaComun[]>([]);
  const [areaId, setAreaId] = useState('');
  const [fecha, setFecha] = useState(hoy());
  const [horaInicio, setHoraInicio] = useState('');
  const [horaFin, setHoraFin] = useState('');

  const [disp, setDisp] = useState<Disponibilidad | null>(null);
  const [dispLoading, setDispLoading] = useState(false);
  const [reservando, setReservando] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [misReservas, setMisReservas] = useState<Reserva[]>([]);
  const [loadingMis, setLoadingMis] = useState(true);
  // Reserva recién creada, resaltada un momento en «Mis reservas».
  const [resaltadaId, setResaltadaId] = useState<string | null>(null);
  const temporizadorResalte = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (temporizadorResalte.current) clearTimeout(temporizadorResalte.current); }, []);

  const verReserva = (id: string) => {
    setResaltadaId(id);
    if (temporizadorResalte.current) clearTimeout(temporizadorResalte.current);
    temporizadorResalte.current = setTimeout(() => setResaltadaId(null), 6000);
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-reserva-id="${id}"]`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    });
  };

  const [cancelTarget, setCancelTarget] = useState<Reserva | null>(null);
  const [preview, setPreview] = useState<PreviewCancelacion | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [cancelando, setCancelando] = useState(false);

  const area = areas.find(a => a.id === areaId) ?? null;

  useEffect(() => {
    getAreas(true)
      .then(rows => {
        setAreas(rows);
        if (rows.length > 0) setAreaId(rows[0].id);
      })
      .catch(() => setFormError('No se pudo cargar las áreas comunes.'));
  }, []);

  const cargarMisReservas = () => {
    setLoadingMis(true);
    getMisReservas()
      .then(setMisReservas)
      .catch(() => {})
      .finally(() => setLoadingMis(false));
  };
  useEffect(() => { cargarMisReservas(); }, []);

  // Al cambiar de área o fecha se recarga la disponibilidad del día
  useEffect(() => {
    if (!areaId || !fecha) { setDisp(null); return; }
    let cancel = false;
    setDispLoading(true);
    getDisponibilidad(areaId, fecha)
      .then(d => { if (!cancel) setDisp(d); })
      .catch(() => { if (!cancel) setDisp(null); })
      .finally(() => { if (!cancel) setDispLoading(false); });
    return () => { cancel = true; };
  }, [areaId, fecha]);

  /** Costo calculado en vivo, con las mismas reglas que aplica el backend. */
  const costo = (): number | null => {
    if (!area) return null;
    if (area.tarifa_tipo === 'gratis') return 0;
    const tarifa = parseFloat(area.tarifa_monto);
    if (area.tarifa_tipo === 'unica') return tarifa;
    const min = horaAMin(horaFin) - horaAMin(horaInicio);
    if (!Number.isFinite(min) || min <= 0) return null;
    return Math.round(((tarifa * min) / 60) * 100) / 100;
  };
  const costoActual = costo();

  const handleReservar = async () => {
    if (!areaId || !fecha || !horaInicio || !horaFin) {
      setFormError('Elige área, fecha y horario.');
      return;
    }
    if (horaAMin(horaFin) <= horaAMin(horaInicio)) {
      setFormError('La hora de fin debe ser posterior a la de inicio.');
      return;
    }
    setReservando(true);
    setFormError(null);
    try {
      const r = await crearReserva({ area_id: areaId, fecha, hora_inicio: horaInicio, hora_fin: horaFin });
      // Confirmación que se queda hasta cerrarla y lleva a la reserva recién creada.
      showToast(
        r.estado === 'confirmada' ? t('reservas.confirmedMsg') : t('reservas.pendingMsg'),
        r.estado === 'confirmada' ? 'success' : 'warning',
        { accion: { label: t('reservas.viewMine'), onClick: () => verReserva(r.id) } },
      );
      setHoraInicio('');
      setHoraFin('');
      cargarMisReservas();
      getDisponibilidad(areaId, fecha).then(setDisp).catch(() => {});
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setReservando(false);
    }
  };

  /** Antes de cancelar se consulta al backend qué reembolso aplicaría. */
  const abrirCancelacion = async (r: Reserva) => {
    setCancelTarget(r);
    setMotivo('');
    setPreview(null);
    setPreviewLoading(true);
    try {
      setPreview(await getPreviewCancelacion(r.id));
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const confirmarCancelacion = async () => {
    if (!cancelTarget) return;
    setCancelando(true);
    try {
      await cancelarReserva(cancelTarget.id, motivo || undefined);
      showToast(t('reservas.cancelled'), 'warning');
      setCancelTarget(null);
      cargarMisReservas();
      if (areaId && fecha) getDisponibilidad(areaId, fecha).then(setDisp).catch(() => {});
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setCancelando(false);
    }
  };

  return (
    <main className="sg-page text-gray-100">
      <div className="sg-page-inner space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="sg-eyebrow">SecureGate · Residentes</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">{t('reservas.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">{t('reservas.subtitle')}</p>
        </div>
        <div className="sg-card-muted px-4 py-3 text-sm text-gray-300">
          <span className="text-gray-500">{t('reservas.myReservations')}</span>
          <span className="ml-2 font-bold text-emerald-300">{misReservas.length}</span>
        </div>
      </div>

      {/* ── Nueva reserva ── */}
      <section className="sg-card space-y-5 p-5 sm:p-7">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            {t('reservas.pickArea')}
          </label>
          <select
            aria-label={t('reservas.pickArea')}
            value={areaId}
            onChange={e => setAreaId(e.target.value)}
            className="sg-input appearance-none"
          >
            {areas.map(a => (
              <option key={a.id} value={a.id}>{a.nombre}</option>
            ))}
          </select>
        </div>

        {area && esImagenValida(area.imagen_url) && (
          <img
            src={area.imagen_url as string}
            alt={area.nombre}
            className="w-full h-36 object-cover rounded-xl border border-gray-700"
          />
        )}
        {area?.descripcion && <p className="text-sm text-gray-400">{area.descripcion}</p>}

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            {t('reservas.pickDate')}
          </label>
          <input
            type="date"
            aria-label={t('reservas.pickDate')}
            min={hoy()}
            value={fecha}
            onChange={e => setFecha(e.target.value)}
            className="sg-input"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              {t('reservas.startTime')}
            </label>
            <input
              type="time"
              aria-label={t('reservas.startTime')}
              value={horaInicio}
              onChange={e => setHoraInicio(e.target.value)}
              className="sg-input"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              {t('reservas.endTime')}
            </label>
            <input
              type="time"
              aria-label={t('reservas.endTime')}
              value={horaFin}
              onChange={e => setHoraFin(e.target.value)}
              className="sg-input"
            />
          </div>
        </div>

        {/* Disponibilidad del día, con el buffer ya aplicado */}
        <div className="sg-card-muted space-y-2 p-4">
          <p className="text-xs font-semibold text-gray-300">{t('reservas.occupied')}</p>
          {dispLoading ? (
            <SkeletonText lines={3} />
          ) : !disp || disp.ocupados.length === 0 ? (
            <p className="text-xs text-gray-500">{t('reservas.noOccupied')}</p>
          ) : (
            <ul className="space-y-1">
              {disp.ocupados.map(o => (
                <li key={o.id} className="text-xs text-gray-400 flex justify-between gap-2">
                  <span className="text-gray-300">
                    {fmtHora(o.hora_inicio)} – {fmtHora(o.hora_fin)}
                  </span>
                  {disp.buffer_minutos > 0 && (
                    <span className="text-amber-400">
                      {t('reservas.blocked')} {fmtHoraTs(o.bloqueo_desde)} – {fmtHoraTs(o.bloqueo_hasta)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {disp && disp.buffer_minutos > 0 && (
            <p className="text-xs text-amber-400/80 border-t border-gray-700 pt-2">
              {t('reservas.bufferNotice')} {disp.buffer_minutos} {t('reservas.bufferNoticeMin')}
              {disp.buffer_motivo ? ` ${disp.buffer_motivo}` : ''}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
          <span className="text-gray-400">{t('reservas.cost')}</span>
          <span className="font-bold text-emerald-400">
            {costoActual === null
              ? '—'
              : costoActual === 0
              ? t('reservas.free')
              : `Q${costoActual.toFixed(2)}`}
          </span>
        </div>

        {formError && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">
            {formError}
          </div>
        )}

        <button
          onClick={handleReservar}
          disabled={reservando}
          className="sg-btn sg-btn-primary w-full"
        >
          {reservando && <Spinner size={14} />}
          {reservando ? t('reservas.booking') : t('reservas.book')}
        </button>
      </section>

      {/* ── Mis reservas ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="sg-section-title">{t('reservas.myReservations')}</h2>
          <span className="text-xs text-gray-500">{misReservas.length} {misReservas.length === 1 ? 'reserva' : 'reservas'}</span>
        </div>
        {loadingMis ? (
          <CardSkeleton count={3} />
        ) : misReservas.length === 0 ? (
          <p className="text-sm text-gray-500">{t('reservas.noReservations')}</p>
        ) : (
          misReservas.map(r => (
            <div
              key={r.id}
              data-reserva-id={r.id}
              className={`sg-card flex flex-col justify-between gap-3 p-4 transition-shadow ${r.id === resaltadaId ? 'ring-2 ring-success-500/60' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-white">{r.area_nombre}</span>
                <span
                  className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${ESTADO_CLASS[r.estado]}`}
                >
                  {t(ESTADO_LABEL_KEY[r.estado])}
                </span>
              </div>
              <p className="text-sm text-gray-400">
                {fmtFecha(r.fecha)} · {fmtHora(r.hora_inicio)} – {fmtHora(r.hora_fin)}
              </p>
              <p className="text-sm text-gray-300">
                {Number(r.monto_cargo) > 0
                  ? `Q${parseFloat(r.monto_cargo).toFixed(2)}`
                  : t('reservas.free')}
                {r.reembolso_aplicado !== null && (
                  <span className="text-emerald-400">
                    {' '}· {t('reservas.refund')} {parseFloat(r.reembolso_aplicado)}%
                  </span>
                )}
              </p>
              {(r.estado === 'confirmada' || r.estado === 'pendiente_aprobacion') && r.es_futura && (
                <RowActions
                  align="start"
                  menuLabel={`${t('reservas.cancel')}: ${r.area_nombre}`}
                  actions={[
                    { id: 'cancelar', label: t('reservas.cancel'), icon: ROW_ICON.close, tone: 'danger', onClick: () => abrirCancelacion(r) },
                  ]}
                />
              )}
            </div>
          ))
        )}
      </section>

      {/* ── Modal de cancelación: avisa el reembolso ANTES de confirmar ── */}
      {cancelTarget && (
        <div className="sg-drawer-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <div className="sg-card w-full rounded-t-3xl p-5 sm:max-w-md sm:rounded-2xl sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">{t('reservas.cancelTitle')}</h2>
              <button
                onClick={() => setCancelTarget(null)}
                className="text-gray-400 hover:text-white text-xl leading-none"
              >
                ✕
              </button>
            </div>

            <p className="text-sm text-gray-400">
              {cancelTarget.area_nombre} · {fmtFecha(cancelTarget.fecha)}{' '}
              {fmtHora(cancelTarget.hora_inicio)}
            </p>

            {previewLoading ? (
              <SkeletonText lines={2} />
            ) : preview && !preview.permite_cancelacion ? (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">
                {t('reservas.cancelDisabled')}
              </div>
            ) : preview ? (
              <div
                className={`rounded-lg px-3 py-2 text-sm border ${
                  preview.reembolso_aplicado > 0
                    ? 'bg-emerald-900/30 border-emerald-700/50 text-emerald-300'
                    : 'bg-amber-900/30 border-amber-700/50 text-amber-300'
                }`}
              >
                {preview.reembolso_aplicado > 0
                  ? `${t('reservas.refundNotice')} ${preview.reembolso_aplicado}% ${t('reservas.refundNoticeEnd')}` +
                    (preview.monto_reembolso > 0 ? ` (Q${preview.monto_reembolso.toFixed(2)})` : '')
                  : t('reservas.noRefundNotice')}
              </div>
            ) : null}

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                {t('reservas.cancelReason')}
              </label>
              <input
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                className="sg-input"
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={confirmarCancelacion}
                disabled={cancelando || (preview ? !preview.cancelable : false)}
                className="sg-btn sg-btn-danger flex-1"
              >
                {cancelando && <Spinner size={14} />}
                {t('reservas.confirmCancel')}
              </button>
              <button
                onClick={() => setCancelTarget(null)}
                className="sg-btn sg-btn-secondary px-4"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </main>
  );
}
