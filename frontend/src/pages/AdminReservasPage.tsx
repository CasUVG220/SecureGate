/* Las constantes exportadas también son consumidas por tests y pantallas relacionadas. */
/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getReservas, getAreas, aprobarReserva, rechazarReserva,
  type Reserva, type AreaComun, type EstadoReserva,
} from '../services/api';
import { TableSkeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { Button, Modal, ROW_ICON, RowActions, Textarea } from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';
import { usePolling } from '../hooks/usePolling';
import { formatearDia } from '../utils/fecha';

export const ESTADO_BADGE: Record<EstadoReserva, string> = {
  pendiente_aprobacion: 'bg-warning-900/50 text-warning-400',
  confirmada:           'bg-success-900/40 text-success-400',
  cancelada:            'bg-gray-700 text-gray-300',
  rechazada:            'bg-danger-900/60 text-danger-400',
  completada:           'bg-brand-900/50 text-brand-400',
};

export const ESTADO_LABEL_KEY: Record<EstadoReserva, string> = {
  pendiente_aprobacion: 'reservas.statusPending',
  confirmada:           'reservas.statusConfirmed',
  cancelada:            'reservas.statusCancelled',
  rechazada:            'reservas.statusRejected',
  completada:           'reservas.statusCompleted',
};

const ESTADOS: EstadoReserva[] = [
  'pendiente_aprobacion', 'confirmada', 'cancelada', 'rechazada', 'completada',
];

const fmtFecha = (f: string) => formatearDia(f);
const fmtHora = (h: string) => h.slice(0, 5);

const FILTRO = 'sg-input appearance-none';

export default function AdminReservasPage() {
  const { t } = useTranslation();
  const showToast = useToast();

  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [areas, setAreas] = useState<AreaComun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [filtros, setFiltros] = useState({ area_id: '', estado: '', fecha_desde: '', fecha_hasta: '' });

  const load = () => {
    setLoading(true);
    getReservas(filtros)
      .then(setReservas)
      .catch(() => setError('No se pudo cargar las reservas.'))
      .finally(() => setLoading(false));
  };

  // La consulta debe repetirse cuando cambian los filtros; load usa el snapshot actual.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [filtros]);
  useEffect(() => { getAreas().then(setAreas).catch(() => {}); }, []);

  // Aviso de reservas por aprobar: se consulta aparte de la lista (que puede estar filtrada) y
  // se refresca solo cada minuto; si llega una nueva se avisa con un toast que lleva a ella.
  const [pendientes, setPendientes] = useState(0);
  const pendientesPrevios = useRef<number | null>(null);
  const cargarPendientes = useCallback(async () => {
    const rows = await getReservas({ estado: 'pendiente_aprobacion' });
    setPendientes(rows.length);
    if (pendientesPrevios.current !== null && rows.length > pendientesPrevios.current) {
      showToast(t('reservas.newPendingToast'), 'info', {
        accion: { label: t('reservas.reviewNow'), onClick: () => setFiltros(p => ({ ...p, estado: 'pendiente_aprobacion' })) },
      });
    }
    pendientesPrevios.current = rows.length;
  }, [showToast, t]);
  useEffect(() => { void cargarPendientes().catch(() => {}); }, [cargarPendientes]);
  usePolling(cargarPendientes, 60_000);

  const handleAprobar = async (r: Reserva) => {
    setActionId(r.id);
    try {
      await aprobarReserva(r.id);
      showToast(t('reservas.approved'));
      load();
      void cargarPendientes().catch(() => {});
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setActionId(null);
    }
  };

  /** Rechazar pide el motivo (opcional) en un diálogo de la app; el rechazo se hace al confirmar. */
  const [rechazando, setRechazando] = useState<Reserva | null>(null);
  const [motivo, setMotivo] = useState('');
  const handleRechazar = (r: Reserva) => { setMotivo(''); setRechazando(r); };

  const confirmarRechazo = async () => {
    const r = rechazando;
    if (!r) return;
    setActionId(r.id);
    try {
      await rechazarReserva(r.id, motivo.trim() || undefined);
      setRechazando(null);
      showToast(t('reservas.rejected'), 'warning');
      load();
      void cargarPendientes().catch(() => {});
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="sg-page-inner space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white">{t('reservas.allReservations')}</h2>
      </div>

      {pendientes > 0 && filtros.estado !== 'pendiente_aprobacion' && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning-500/40 bg-warning-500/10 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-warning-400">{t('reservas.pendingBanner')}: {pendientes}</p>
            <p className="text-xs text-gray-300">{t('reservas.pendingBannerHint')}</p>
          </div>
          <button
            type="button"
            onClick={() => setFiltros(p => ({ ...p, estado: 'pendiente_aprobacion' }))}
            className="sg-btn sg-btn-secondary text-sm"
          >
            {t('reservas.showPendingOnly')}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <select
          aria-label={t('reservas.filterArea')}
          value={filtros.area_id}
          onChange={e => setFiltros(p => ({ ...p, area_id: e.target.value }))}
          className={`${FILTRO} w-52`}
        >
          <option value="">{t('reservas.filterArea')}: {t('reservas.all')}</option>
          {areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>

        <select
          aria-label={t('reservas.filterStatus')}
          value={filtros.estado}
          onChange={e => setFiltros(p => ({ ...p, estado: e.target.value }))}
          className={`${FILTRO} w-52`}
        >
          <option value="">{t('reservas.filterStatus')}: {t('reservas.all')}</option>
          {ESTADOS.map(es => <option key={es} value={es}>{t(ESTADO_LABEL_KEY[es])}</option>)}
        </select>

        <input
          type="date"
          aria-label={t('reservas.filterFrom')}
          value={filtros.fecha_desde}
          onChange={e => setFiltros(p => ({ ...p, fecha_desde: e.target.value }))}
          className={FILTRO}
        />
        <input
          type="date"
          aria-label={t('reservas.filterTo')}
          value={filtros.fecha_hasta}
          onChange={e => setFiltros(p => ({ ...p, fecha_hasta: e.target.value }))}
          className={FILTRO}
        />
      </div>

      {error && (
        <div className="bg-danger-900/40 border border-danger-700 rounded-lg px-4 py-3 text-danger-300 text-sm">
          {error}
        </div>
      )}

      <div className="sg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">{t('reservas.filterArea')}</th>
                <th className="px-4 py-3 font-medium">{t('reservas.resident')}</th>
                <th className="px-4 py-3 font-medium">{t('reservas.pickDate')}</th>
                <th className="px-4 py-3 font-medium">{t('reservas.schedule')}</th>
                <th className="px-4 py-3 font-medium">{t('reservas.charge')}</th>
                <th className="px-4 py-3 font-medium">{t('reservas.filterStatus')}</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={5} cols={7} />
              ) : reservas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                    {t('reservas.reservationsEmpty')}
                  </td>
                </tr>
              ) : (
                reservas.map(r => (
                  <tr key={r.id} className="border-b border-gray-700 last:border-0">
                    <td className="px-4 py-3 text-gray-200">{r.area_nombre}</td>
                    <td className="px-4 py-3 text-gray-300">
                      {r.residente_nombre}
                      <span className="block text-xs text-gray-500">
                        {t('reservas.house')} {r.numero_casa}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{fmtFecha(r.fecha)}</td>
                    <td className="px-4 py-3 text-gray-300">
                      {fmtHora(r.hora_inicio)} – {fmtHora(r.hora_fin)}
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      {Number(r.monto_cargo) > 0
                        ? `Q${parseFloat(r.monto_cargo).toFixed(2)}`
                        : t('reservas.free')}
                      {r.reembolso_aplicado !== null && (
                        <span className="block text-xs text-success-400">
                          {t('reservas.refund')}: {parseFloat(r.reembolso_aplicado)}%
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${ESTADO_BADGE[r.estado]}`}
                      >
                        {t(ESTADO_LABEL_KEY[r.estado])}
                      </span>
                      {r.motivo_cancelacion && (
                        <span className="block text-xs text-gray-400 mt-0.5 max-w-[180px] truncate" title={r.motivo_cancelacion}>
                          {r.motivo_cancelacion}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.estado === 'pendiente_aprobacion' && (
                        <RowActions
                          align="start"
                          inline={2}
                          actions={[
                            {
                              id: 'aprobar',
                              label: t('reservas.approve'),
                              icon: ROW_ICON.check,
                              tone: 'primary',
                              loading: actionId === r.id,
                              onClick: () => handleAprobar(r),
                            },
                            {
                              id: 'rechazar',
                              label: t('reservas.reject'),
                              icon: ROW_ICON.close,
                              tone: 'danger',
                              disabled: actionId === r.id,
                              onClick: () => handleRechazar(r),
                            },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <Modal
        open={!!rechazando}
        onClose={() => setRechazando(null)}
        dismissible={!actionId}
        size="sm"
        title={t('reservas.rejectTitle')}
        description={rechazando ? `${rechazando.area_nombre} · ${rechazando.numero_casa}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRechazando(null)} disabled={!!actionId}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={() => void confirmarRechazo()} loading={!!actionId}>{t('reservas.rejectConfirm')}</Button>
          </>
        }
      >
        <Textarea
          label={t('reservas.rejectReason')}
          hint={t('reservas.rejectHint')}
          rows={3}
          maxLength={300}
          autoFocus
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
        />
      </Modal>
    </div>
  );
}
