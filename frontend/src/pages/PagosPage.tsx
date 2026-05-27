import { useEffect, useState } from 'react';
import {
  getPagos, createPago, aprobarPago, rechazarPago, getResidentes,
  type Pago, type Residente,
} from '../services/api';
import { TableSkeleton, Spinner } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n/useTranslation';

const BADGE: Record<Pago['estado'], string> = {
  aprobado:  'bg-green-100 text-green-700',
  pendiente: 'bg-yellow-100 text-yellow-700',
  rechazado: 'bg-red-100 text-red-700',
};
const EMPTY_FORM = { residente_id: '', monto: '' };

export default function PagosPage() {
  const showToast = useToast();
  const { t } = useTranslation();
  const [pagos, setPagos]           = useState<Pago[]>([]);
  const [residentes, setResidentes] = useState<Residente[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [showModal, setShowModal]   = useState(false);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);
  const [actionId, setActionId]     = useState<string | null>(null);

  const LABEL: Record<Pago['estado'], string> = {
    aprobado: t('payments.approved'), pendiente: t('payments.pending'), rechazado: t('payments.rejected'),
  };
  const METODO_LABEL: Record<Pago['metodo'], string> = {
    efectivo: t('payments.cash'), transferencia: t('payments.transfer'),
  };

  const cargarPagos = () => {
    setLoading(true);
    getPagos()
      .then(setPagos)
      .catch(() => setError('No se pudo cargar la lista de pagos.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    cargarPagos();
    getResidentes().then(setResidentes).catch(() => {});
  }, []);

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.residente_id || !form.monto) { setFormError('Selecciona un residente e ingresa el monto.'); return; }
    const monto = parseFloat(form.monto);
    if (isNaN(monto) || monto <= 0) { setFormError('El monto debe ser mayor a 0.'); return; }
    setSaving(true); setFormError(null);
    try {
      await createPago({ residente_id: form.residente_id, monto });
      setShowModal(false);
      setForm(EMPTY_FORM);
      cargarPagos();
      showToast(t('payments.created'));
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error al registrar pago');
    } finally {
      setSaving(false);
    }
  };

  const handleAprobar = async (id: string) => {
    setActionId(id);
    try {
      await aprobarPago(id);
      cargarPagos();
      showToast(t('payments.paymentApproved'));
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error al aprobar pago', 'error');
    } finally {
      setActionId(null);
    }
  };

  const handleRechazar = async (id: string) => {
    setActionId(id);
    try {
      await rechazarPago(id);
      cargarPagos();
      showToast(t('payments.paymentRejected'), 'warning');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error al rechazar pago', 'error');
    } finally {
      setActionId(null);
    }
  };

  const q = search.toLowerCase();
  const filtered = pagos.filter(p =>
    (!filterEstado || p.estado === filterEstado) &&
    (`${p.numero_casa} ${p.residente_nombre}`).toLowerCase().includes(q)
  );

  return (
    <div className="p-6 text-gray-100 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-white">{t('payments.title')}</h1>
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por casa o residente…"
            className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm focus:outline-none focus:border-blue-500 w-52"
          />
          <select
            value={filterEstado}
            onChange={e => setFilterEstado(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 appearance-none"
          >
            <option value="">Todos</option>
            <option value="pendiente">{t('payments.pending')}</option>
            <option value="aprobado">{t('payments.approved')}</option>
            <option value="rechazado">{t('payments.rejected')}</option>
          </select>
          <button
            onClick={() => { setForm(EMPTY_FORM); setFormError(null); setShowModal(true); }}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {t('payments.registerCash')}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        {!loading && filtered.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-12">{t('payments.noPayments')}</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">{t('residents.house')}</th>
                <th className="px-4 py-3 font-medium">{t('payments.resident')}</th>
                <th className="px-4 py-3 font-medium">{t('common.amount')}</th>
                <th className="px-4 py-3 font-medium">{t('payments.method')}</th>
                <th className="px-4 py-3 font-medium">{t('common.status')}</th>
                <th className="px-4 py-3 font-medium">{t('common.date')}</th>
                <th className="px-4 py-3 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={6} cols={7} />
              ) : (
                filtered.map(p => (
                  <tr key={p.id} className="border-b border-gray-700 last:border-0">
                    <td className="px-4 py-3 font-medium">{p.numero_casa}</td>
                    <td className="px-4 py-3 text-gray-300">{p.residente_nombre}</td>
                    <td className="px-4 py-3 font-semibold">Q{parseFloat(p.monto).toFixed(2)}</td>
                    <td className="px-4 py-3 text-gray-300">{METODO_LABEL[p.metodo]}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${BADGE[p.estado]}`}>
                        {LABEL[p.estado]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(p.fecha_pago).toLocaleDateString('es-GT')}
                    </td>
                    <td className="px-4 py-3 flex gap-2">
                      {p.estado === 'pendiente' && (
                        <>
                          <button onClick={() => handleAprobar(p.id)} disabled={actionId === p.id}
                            className="text-xs text-green-400 hover:text-green-300 disabled:opacity-50 font-medium transition-colors flex items-center gap-1">
                            {actionId === p.id && <Spinner size={12} />}
                            {t('common.approve')}
                          </button>
                          <button onClick={() => handleRechazar(p.id)} disabled={actionId === p.id}
                            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 font-medium transition-colors">
                            {t('common.reject')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60">
          <div className="bg-gray-800 rounded-t-2xl sm:rounded-2xl p-6 sm:p-8 w-full sm:max-w-md shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-6">{t('payments.modalTitle')}</h2>
            {formError && (
              <div className="mb-4 bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{formError}</div>
            )}
            <form onSubmit={handleCrear} className="space-y-5">
              <div>
                <label className="block text-sm text-gray-300 mb-1">{t('payments.resident')} *</label>
                <select name="residente_id" value={form.residente_id} onChange={handleFormChange} required
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors">
                  <option value="">{t('payments.selectResident')}</option>
                  {residentes.map(r => (
                    <option key={r.id} value={r.id}>Casa {r.numero_casa} — {r.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">{t('payments.amountLabel')} *</label>
                <input type="number" name="monto" value={form.monto} onChange={handleFormChange}
                  required min="0.01" step="0.01" placeholder="0.00"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2">
                  {saving && <Spinner />}
                  {saving ? t('common.saving') : t('common.save')}
                </button>
                <button type="button" onClick={() => setShowModal(false)} disabled={saving}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors">
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
