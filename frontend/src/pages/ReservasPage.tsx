import { useEffect, useState } from 'react';
import {
  getAreas, getDisponibilidad, crearReserva, getMisReservas,
  getPreviewCancelacion, cancelarReserva,
  type AreaComun, type Disponibilidad, type Reserva, type PreviewCancelacion,
  type EstadoReserva,
} from '../services/api';
import { Spinner } from '../components/Skeleton';
import { useToast } from '../components/Toast';
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

const INPUT =
  'w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500';

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
      showToast(
        r.estado === 'confirmada' ? t('reservas.confirmedMsg') : t('reservas.pendingMsg'),
        r.estado === 'confirmada' ? 'success' : 'warning'
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
    <main className="px-4 sm:px-6 py-6 sm:py-8 space-y-6 max-w-md mx-auto text-gray-100">
      <div>
        <h1 className="text-xl font-bold text-white">{t('reservas.title')}</h1>
        <p className="text-sm text-gray-400 mt-0.5">{t('reservas.subtitle')}</p>
      </div>

      {/* ── Nueva reserva ── */}
      <section className="bg-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            {t('reservas.pickArea')}
          </label>
          <select
            aria-label={t('reservas.pickArea')}
            value={areaId}
            onChange={e => setAreaId(e.target.value)}
            className={`${INPUT} appearance-none`}
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
            className={INPUT}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              {t('reservas.startTime')}
            </label>
            <input
              type="time"
              aria-label={t('reservas.startTime')}
              value={horaInicio}
              onChange={e => setHoraInicio(e.target.value)}
              className={INPUT}
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
              className={INPUT}
            />
          </div>
        </div>

        {/* Disponibilidad del día, con el buffer ya aplicado */}
        <div className="bg-gray-900/60 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-300">{t('reservas.occupied')}</p>
          {dispLoading ? (
            <p className="text-xs text-gray-500">{t('common.loading')}</p>
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

        <div className="flex items-center justify-between text-sm">
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
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {reservando && <Spinner size={14} />}
          {reservando ? t('reservas.booking') : t('reservas.book')}
        </button>
      </section>

      {/* ── Mis reservas ── */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-white">{t('reservas.myReservations')}</h2>
        {loadingMis ? (
          <p className="text-sm text-gray-400">{t('common.loading')}</p>
        ) : misReservas.length === 0 ? (
          <p className="text-sm text-gray-500">{t('reservas.noReservations')}</p>
        ) : (
          misReservas.map(r => (
            <div key={r.id} className="bg-gray-800 rounded-xl p-4 shadow border border-gray-700 space-y-1">
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
                <button
                  onClick={() => abrirCancelacion(r)}
                  className="text-red-400 hover:text-red-300 transition-colors text-sm"
                >
                  {t('reservas.cancel')}
                </button>
              )}
            </div>
          ))
        )}
      </section>

      {/* ── Modal de cancelación: avisa el reembolso ANTES de confirmar ── */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md p-6 space-y-4">
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
              <p className="text-sm text-gray-400">{t('common.loading')}</p>
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
                className={INPUT}
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={confirmarCancelacion}
                disabled={cancelando || (preview ? !preview.cancelable : false)}
                className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold py-2 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {cancelando && <Spinner size={14} />}
                {t('reservas.confirmCancel')}
              </button>
              <button
                onClick={() => setCancelTarget(null)}
                className="bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium px-4 py-2 rounded-xl transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
