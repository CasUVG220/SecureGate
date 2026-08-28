/* Las constantes exportadas también son consumidas por tests y pantallas relacionadas. */
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react';
import {
  getReservas, getAreas, aprobarReserva, rechazarReserva,
  type Reserva, type AreaComun, type EstadoReserva,
} from '../services/api';
import { Spinner } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n/useTranslation';

export const ESTADO_BADGE: Record<EstadoReserva, string> = {
  pendiente_aprobacion: 'bg-amber-900/50 text-amber-400',
  confirmada:           'bg-green-900/40 text-green-400',
  cancelada:            'bg-gray-700 text-gray-300',
  rechazada:            'bg-red-900/60 text-red-400',
  completada:           'bg-blue-900/50 text-blue-400',
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

const fmtFecha = (f: string) => new Date(f).toLocaleDateString('es-GT', { timeZone: 'UTC' });
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

  const handleAprobar = async (r: Reserva) => {
    setActionId(r.id);
    try {
      await aprobarReserva(r.id);
      showToast(t('reservas.approved'));
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setActionId(null);
    }
  };

  const handleRechazar = async (r: Reserva) => {
    const motivo = window.prompt(t('reservas.rejectReason'));
    if (motivo === null) return;
    setActionId(r.id);
    try {
      await rechazarReserva(r.id, motivo || undefined);
      showToast(t('reservas.rejected'), 'warning');
      load();
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
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
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
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">{t('common.loading')}</td></tr>
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
                        <span className="block text-xs text-emerald-400">
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
                        <span className="block text-xs text-gray-500 mt-0.5 max-w-[180px] truncate">
                          {r.motivo_cancelacion}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.estado === 'pendiente_aprobacion' && (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleAprobar(r)}
                            disabled={actionId === r.id}
                            className="text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1 disabled:opacity-50"
                          >
                            {actionId === r.id && <Spinner size={12} />}
                            {t('reservas.approve')}
                          </button>
                          <button
                            onClick={() => handleRechazar(r)}
                            disabled={actionId === r.id}
                            className="text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                          >
                            {t('reservas.reject')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
