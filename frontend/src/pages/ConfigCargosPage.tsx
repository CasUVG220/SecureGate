import { useEffect, useState } from 'react';
import {
  getConfigCargos, createConfigCargo, updateConfigCargo, deleteConfigCargo,
  type ConfigCargo,
} from '../services/api';
import { TableSkeleton, Spinner } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n/useTranslation';

const EMPTY_FORM = { nombre: '', monto: '' };

export default function ConfigCargosPage() {
  const showToast = useToast();
  const { t } = useTranslation();
  const [configs, setConfigs]       = useState<ConfigCargo[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [showModal, setShowModal]   = useState(false);
  const [editTarget, setEditTarget] = useState<ConfigCargo | null>(null);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    getConfigCargos()
      .then(setConfigs)
      .catch(() => setError('No se pudo cargar la configuración de cargos.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditTarget(null); setForm(EMPTY_FORM); setFormError(null); setShowModal(true); };
  const openEdit   = (cfg: ConfigCargo) => { setEditTarget(cfg); setForm({ nombre: cfg.nombre, monto: cfg.monto }); setFormError(null); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditTarget(null); };

  const handleSave = async () => {
    if (!form.nombre.trim()) { setFormError('El nombre es requerido.'); return; }
    const monto = parseFloat(form.monto);
    if (!form.monto || isNaN(monto) || monto < 1) { setFormError('El monto debe ser mayor a 0.'); return; }
    setFormError(null); setSaving(true);
    try {
      if (editTarget) {
        const updated = await updateConfigCargo(editTarget.id, { nombre: form.nombre.trim(), monto });
        setConfigs(prev => prev.map(c => c.id === updated.id ? updated : c));
        showToast(t('config.updated'));
      } else {
        const created = await createConfigCargo({ nombre: form.nombre.trim(), monto });
        setConfigs(prev => [...prev, created]);
        showToast(t('config.created'));
      }
      closeModal();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (cfg: ConfigCargo) => {
    setTogglingId(cfg.id);
    try {
      const updated = await updateConfigCargo(cfg.id, { activo: !cfg.activo });
      setConfigs(prev => prev.map(c => c.id === updated.id ? updated : c));
      showToast(updated.activo ? t('config.activated') : t('config.deactivated'), updated.activo ? 'success' : 'warning');
    } catch {
      showToast(t('config.cannotChange'), 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (cfg: ConfigCargo) => {
    if (!window.confirm(`${t('config.confirmDeactivate')} "${cfg.nombre}"?`)) return;
    try {
      await deleteConfigCargo(cfg.id);
      setConfigs(prev => prev.map(c => c.id === cfg.id ? { ...c, activo: false } : c));
      showToast(t('config.deactivated'), 'warning');
    } catch {
      showToast('No se pudo eliminar la configuración.', 'error');
    }
  };

  return (
    <div className="p-6 text-gray-100 space-y-6">
      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold">
                {editTarget ? t('config.editTitle') : t('config.createTitle')}
              </h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
            </div>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('config.nameLabel')} *</label>
              <input type="text" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                placeholder={t('config.namePlaceholder')}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('config.amountLabel')} *</label>
              <input type="number" min="1" step="0.01" value={form.monto} onChange={e => setForm(p => ({ ...p, monto: e.target.value }))}
                placeholder={t('config.amountPlaceholder')}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors" />
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={handleSave} disabled={saving}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 rounded-xl transition-colors flex items-center justify-center gap-2">
                {saving && <Spinner />}
                {saving ? t('common.saving') : t('common.save')}
              </button>
              <button onClick={closeModal} className="bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium px-4 py-2 rounded-xl transition-colors">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">{t('config.title')}</h1>
          <p className="text-sm text-gray-400 mt-0.5">{t('config.subtitle')}</p>
        </div>
        <button onClick={openCreate}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors">
          {t('config.new')}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      <div className="bg-gray-800 rounded-2xl overflow-hidden shadow-xl max-w-3xl">
        {!loading && configs.length === 0 ? (
          <p className="text-gray-400 text-sm px-6 py-8 text-center">{t('config.noConfigs')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-5 py-3 font-medium">{t('common.name')}</th>
                <th className="px-5 py-3 font-medium">{t('common.amount')}</th>
                <th className="px-5 py-3 font-medium">{t('common.status')}</th>
                <th className="px-5 py-3 font-medium text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={4} cols={4} />
              ) : (
                configs.map((cfg, i) => (
                  <tr key={cfg.id} className={`border-b border-gray-700/50 last:border-0 ${i % 2 === 0 ? '' : 'bg-gray-700/20'}`}>
                    <td className="px-5 py-3 text-white font-medium">{cfg.nombre}</td>
                    <td className="px-5 py-3 text-gray-200">Q{parseFloat(cfg.monto).toFixed(2)}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.activo ? 'bg-green-100 text-green-700' : 'bg-gray-600 text-gray-300'}`}>
                        {cfg.activo ? t('common.active') : t('common.inactive')}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right space-x-3 whitespace-nowrap">
                      <button onClick={() => openEdit(cfg)} className="text-blue-400 hover:text-blue-300 transition-colors">{t('common.edit')}</button>
                      <button onClick={() => handleToggle(cfg)} disabled={togglingId === cfg.id}
                        className="text-yellow-400 hover:text-yellow-300 disabled:opacity-40 transition-colors flex-shrink-0 inline-flex items-center gap-1">
                        {togglingId === cfg.id && <Spinner size={12} />}
                        {cfg.activo ? t('common.deactivate') : t('common.activate')}
                      </button>
                      {cfg.activo && (
                        <button onClick={() => handleDelete(cfg)} className="text-red-400 hover:text-red-300 transition-colors">{t('common.delete')}</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
