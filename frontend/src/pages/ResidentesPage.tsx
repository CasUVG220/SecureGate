import { useEffect, useState } from 'react';
import {
  getResidentes, createResidente, updateResidente, deleteResidente,
  type Residente, type ResidenteInput, type ResidenteUpdate,
} from '../services/api';
import { TableSkeleton, Spinner } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n/useTranslation';

type FormMode = 'none' | 'create' | 'edit';

const EMPTY_CREATE: ResidenteInput = { nombre: '', email: '', password: '', numero_casa: '', telefono: '' };
const EMPTY_UPDATE: ResidenteUpdate = { numero_casa: '', estado_pago: '', telefono: '', saldo_pendiente: 0 };

const BADGE: Record<string, string> = {
  al_dia:   'bg-green-100 text-green-700',
  mora:     'bg-red-100 text-red-700',
  pendiente:'bg-yellow-100 text-yellow-700',
};

export default function ResidentesPage() {
  const showToast = useToast();
  const { t } = useTranslation();

  const BADGE_LABEL: Record<string, string> = {
    al_dia: t('residents.current'), mora: t('residents.inDebt'), pendiente: t('residents.pending'),
  };

  const [residentes, setResidentes] = useState<Residente[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [formMode, setFormMode]     = useState<FormMode>('none');
  const [editTarget, setEditTarget] = useState<Residente | null>(null);
  const [createForm, setCreateForm] = useState<ResidenteInput>(EMPTY_CREATE);
  const [updateForm, setUpdateForm] = useState<ResidenteUpdate>(EMPTY_UPDATE);
  const [saving, setSaving]         = useState(false);

  const cargar = () => {
    setLoading(true);
    getResidentes()
      .then(setResidentes)
      .catch(() => setError('No se pudo cargar la lista de residentes.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, []);

  const handleCreateChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setCreateForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleUpdateChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setUpdateForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const openEdit = (r: Residente) => {
    setEditTarget(r);
    setUpdateForm({ numero_casa: r.numero_casa, estado_pago: r.estado_pago, telefono: r.telefono || '', saldo_pendiente: parseFloat(r.saldo_pendiente) });
    setFormMode('edit');
    setError(null);
  };

  const cancelForm = () => {
    setFormMode('none'); setEditTarget(null);
    setCreateForm(EMPTY_CREATE); setUpdateForm(EMPTY_UPDATE);
    setError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError(null);
    try {
      await createResidente(createForm);
      cancelForm(); cargar();
      showToast(t('residents.created'));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al crear residente');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setSaving(true); setError(null);
    try {
      await updateResidente(editTarget.id, updateForm);
      cancelForm(); cargar();
      showToast(t('residents.updated'));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al actualizar residente');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: Residente) => {
    if (!window.confirm(`${t('residents.confirmDelete')} ${r.numero_casa}?`)) return;
    setError(null);
    try {
      await deleteResidente(r.id);
      cargar();
      showToast(t('residents.deleted'), 'warning');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error al eliminar residente', 'error');
    }
  };

  const q = search.toLowerCase();
  const filtered = residentes.filter(r =>
    (!filterEstado || r.estado_pago === filterEstado) &&
    (`${r.numero_casa} ${r.nombre} ${r.email}`).toLowerCase().includes(q)
  );

  return (
    <div className="p-4 sm:p-8 text-gray-100 space-y-6 max-w-7xl mx-auto">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3 flex items-center gap-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      {/* Create resident form */}
      {formMode === 'create' && (
        <form onSubmit={handleCreate} className="bg-dark-800/60 backdrop-blur-md rounded-3xl p-8 border border-white/5 shadow-2xl space-y-6">
          <h2 className="font-bold text-white text-xl tracking-tight">{t('residents.createTitle')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {([
              ['nombre',     t('residents.fullName'), 'text',     true],
              ['email',      t('common.email'),       'email',    true],
              ['password',   t('common.password'),    'password', true],
              ['numero_casa', t('residents.house'),   'text',     true],
              ['telefono',   t('common.phone'),       'text',     false],
            ] as [keyof ResidenteInput, string, string, boolean][]).map(([name, label, type, req]) => (
              <div key={name}>
                <label className="block text-sm font-medium text-gray-300 mb-2">{label}{req && <span className="text-brand-400 ml-1">*</span>}</label>
                <input name={name} type={type} value={createForm[name] ?? ''} onChange={handleCreateChange} required={req}
                  className="w-full bg-dark-700/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all text-sm" />
              </div>
            ))}
          </div>
          <div className="flex gap-3 pt-4">
            <button type="submit" disabled={saving}
              className="bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 disabled:opacity-50 text-white font-semibold px-8 py-2.5 rounded-xl transition-all shadow-glow hover:shadow-glow-lg flex items-center gap-2">
              {saving && <Spinner />}
              {saving ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" onClick={cancelForm} className="text-gray-400 hover:text-white px-6 py-2.5 rounded-xl hover:bg-white/5 transition-all font-medium">{t('common.cancel')}</button>
          </div>
        </form>
      )}

      {/* Edit form */}
      {formMode === 'edit' && editTarget && (
        <form onSubmit={handleUpdate} className="bg-dark-800/60 backdrop-blur-md rounded-3xl p-8 border border-white/5 shadow-2xl space-y-6">
          <h2 className="font-bold text-white text-xl tracking-tight">{t('residents.editTitle')} — Casa {editTarget.numero_casa}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">{t('residents.house')} <span className="text-brand-400 ml-1">*</span></label>
              <input name="numero_casa" value={updateForm.numero_casa ?? ''} onChange={handleUpdateChange} required
                className="w-full bg-dark-700/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">{t('residents.paymentStatus')}</label>
              <select name="estado_pago" value={updateForm.estado_pago ?? ''} onChange={handleUpdateChange}
                className="w-full bg-dark-700/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all text-sm appearance-none">
                <option value="al_dia" className="bg-dark-800 text-white">{t('residents.current')}</option>
                <option value="mora" className="bg-dark-800 text-white">{t('residents.inDebt')}</option>
                <option value="pendiente" className="bg-dark-800 text-white">{t('residents.pending')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">{t('common.phone')}</label>
              <input name="telefono" value={updateForm.telefono ?? ''} onChange={handleUpdateChange}
                className="w-full bg-dark-700/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">{t('residents.pendingBalance')}</label>
              <input name="saldo_pendiente" type="number" min="0" step="0.01" value={updateForm.saldo_pendiente ?? 0} onChange={handleUpdateChange}
                className="w-full bg-dark-700/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all text-sm" />
            </div>
          </div>
          <div className="flex gap-3 pt-4">
            <button type="submit" disabled={saving}
              className="bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 disabled:opacity-50 text-white font-semibold px-8 py-2.5 rounded-xl transition-all shadow-glow hover:shadow-glow-lg flex items-center gap-2">
              {saving && <Spinner />}
              {saving ? t('common.saving') : t('common.saveChanges')}
            </button>
            <button type="button" onClick={cancelForm} className="text-gray-400 hover:text-white px-6 py-2.5 rounded-xl hover:bg-white/5 transition-all font-medium">{t('common.cancel')}</button>
          </div>
        </form>
      )}

      {/* Action bar */}
      {formMode === 'none' && (
        <div className="bg-dark-800/40 backdrop-blur-md rounded-3xl p-6 border border-white/5 shadow-lg space-y-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
              {t('residents.title')}
              {!loading && <span className="px-3 py-1 bg-white/5 rounded-full text-sm font-medium text-brand-400 border border-brand-500/20">{filtered.length}</span>}
            </h1>
            <button onClick={() => { setFormMode('create'); setError(null); }}
              className="bg-brand-600 hover:bg-brand-500 text-white font-semibold px-6 py-2.5 rounded-xl transition-all shadow-glow hover:shadow-glow-lg text-sm flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              {t('residents.new')}
            </button>
          </div>
          <div className="flex gap-3">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por casa, nombre o email…"
              className="flex-1 bg-dark-700/50 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 transition-all text-sm"
            />
            <select
              value={filterEstado}
              onChange={e => setFilterEstado(e.target.value)}
              className="bg-dark-700/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-brand-500 transition-all text-sm appearance-none"
            >
              <option value="">Todos</option>
              <option value="al_dia">{t('residents.current')}</option>
              <option value="mora">{t('residents.inDebt')}</option>
              <option value="pendiente">{t('residents.pending')}</option>
            </select>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-dark-800/40 backdrop-blur-md rounded-3xl overflow-hidden shadow-xl border border-white/5">
        {!loading && filtered.length === 0 ? (
          <div className="py-20 text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/5 mb-6 shadow-inner">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <p className="text-gray-400 text-base">{t('residents.noResidents')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-gray-400 text-left bg-white/[0.02]">
                  <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs whitespace-nowrap">{t('residents.house')}</th>
                  <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs whitespace-nowrap">{t('common.name')}</th>
                  <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs whitespace-nowrap">{t('common.email')}</th>
                  <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs whitespace-nowrap">{t('residents.paymentStatus')}</th>
                  <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs whitespace-nowrap">{t('residents.balance')}</th>
                  <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs whitespace-nowrap">{t('common.phone')}</th>
                  <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs whitespace-nowrap text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <TableSkeleton rows={6} cols={7} />
                ) : (
                  filtered.map((r) => (
                    <tr key={r.id} className="hover:bg-white/[0.02] transition-colors group">
                      <td className="px-6 py-4 font-bold text-white whitespace-nowrap">{r.numero_casa}</td>
                      <td className="px-6 py-4 text-gray-200 font-medium whitespace-nowrap">{r.nombre}</td>
                      <td className="px-6 py-4 text-gray-400 whitespace-nowrap">{r.email}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${r.estado_pago === 'al_dia' ? 'bg-green-500/10 text-green-400 border-green-500/20' : r.estado_pago === 'mora' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'}`}>
                          {r.estado_pago === 'al_dia' && <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>}
                          {r.estado_pago === 'mora' && <div className="w-1.5 h-1.5 rounded-full bg-red-400"></div>}
                          {r.estado_pago === 'pendiente' && <div className="w-1.5 h-1.5 rounded-full bg-yellow-400"></div>}
                          {BADGE_LABEL[r.estado_pago] ?? r.estado_pago}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-medium text-gray-300 whitespace-nowrap">{parseFloat(r.saldo_pendiente).toFixed(2)}</td>
                      <td className="px-6 py-4 text-gray-400 whitespace-nowrap">{r.telefono || '—'}</td>
                      <td className="px-6 py-4 flex gap-2 justify-end whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(r)} className="p-2 text-brand-400 hover:text-brand-300 hover:bg-brand-500/10 rounded-lg transition-all" title={t('common.edit')}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button onClick={() => handleDelete(r)} className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all" title={t('common.delete')}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
