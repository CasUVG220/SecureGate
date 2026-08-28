import { useEffect, useState } from 'react';
import {
  getEmpresas, createEmpresa, updateEmpresa, deleteEmpresa, getDashboard,
  type Empresa, type EmpresaInput,
} from '../../services/api';
import { Spinner, TableSkeleton } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { useTranslation } from '../../i18n/useTranslation';

const EMPTY: EmpresaInput = { nombre: '', nit: '', logo_url: '' };

function StatCard({ label, value, accent, iconPath }: { label: string; value: number; accent: string; iconPath: string }) {
  return (
    <div className="sg-card group relative overflow-hidden p-5 transition-all duration-300 hover:-translate-y-0.5">
      <div className={`absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl opacity-20 transition-all duration-500 group-hover:scale-150 ${accent.replace('text-', 'bg-')}`} />
      <div className="flex items-start justify-between mb-3 relative z-10">
        <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide">{label}</p>
        <div className={`p-2 rounded-lg bg-gray-700/50 ${accent}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d={iconPath} />
          </svg>
        </div>
      </div>
      <p className="text-3xl font-bold text-white relative z-10">{value}</p>
    </div>
  );
}

interface Props {
  onSelectEmpresa: (id: string) => void;
}

export default function OwnerDashboard({ onSelectEmpresa }: Props) {
  const showToast = useToast();
  const { t } = useTranslation();

  const [empresas, setEmpresas]   = useState<Empresa[]>([]);
  const [accesosHoy, setAccesosHoy] = useState(0);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm]           = useState<EmpresaInput>(EMPTY);
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const cargar = () => {
    setLoading(true);
    Promise.all([getEmpresas(), getDashboard()])
      .then(([emp, dash]) => {
        setEmpresas(emp);
        setAccesosHoy(dash.accesos_hoy);
      })
      .catch(() => setError('No se pudo cargar el panel.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, []);

  const totalEmpresasActivas   = empresas.filter(e => e.activo).length;
  const totalSucursalesActivas = empresas.reduce((s, e) => s + (e.activo ? e.total_sucursales : 0), 0);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre.trim()) {
      setFormError('El nombre es requerido');
      return;
    }
    setSaving(true); setFormError(null);
    try {
      await createEmpresa({ nombre: form.nombre, nit: form.nit || undefined, logo_url: form.logo_url || undefined });
      setShowModal(false);
      setForm(EMPTY);
      cargar();
      showToast(t('owner.companyCreated'));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al crear empresa');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActivo = async (emp: Empresa) => {
    try {
      await updateEmpresa(emp.id, { activo: !emp.activo });
      cargar();
      showToast(emp.activo ? t('owner.companyDeactivated') : t('owner.companyActivated'), emp.activo ? 'warning' : 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al actualizar empresa', 'error');
    }
  };

  const handleDeleteEmpresa = async (emp: Empresa) => {
    if (!window.confirm(`${t('owner.confirmDeleteEmpresa')} "${emp.nombre}"?`)) return;
    try {
      await deleteEmpresa(emp.id);
      cargar();
      showToast(t('owner.empresaDeleted'), 'warning');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al eliminar empresa', 'error');
    }
  };

  return (
    <div className="sg-page text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">{t('owner.panelTitle')}</h1>
        <button
          onClick={() => { setShowModal(true); setFormError(null); setForm(EMPTY); }}
          className="sg-btn sg-btn-primary flex items-center gap-2 text-sm"
        >
          <span className="text-lg leading-none">+</span> {t('owner.newCompany')}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="sg-card p-5 border border-gray-700/50 animate-pulse">
              <div className="h-3 bg-gray-700 rounded w-3/4 mb-3" />
              <div className="h-8 bg-gray-700 rounded w-1/2" />
            </div>
          ))
        ) : (
          <>
            <StatCard label={t('owner.activeCompanies')} value={totalEmpresasActivas}   accent="text-blue-400"  iconPath="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <StatCard label={t('owner.activeBranches')}  value={totalSucursalesActivas} accent="text-green-400" iconPath="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
            <StatCard label={t('owner.globalAccesses')}  value={accesosHoy}             accent="text-teal-400"  iconPath="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </>
        )}
      </div>

      {/* Tabla empresas */}
      <div className="sg-card overflow-hidden">
        <div className="border-b border-white/10 px-5 py-4 sm:px-6">
          <h2 className="text-base font-semibold text-white">{t('owner.companies')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">{t('empresas.title')}</th>
                <th className="px-4 py-3 font-medium">{t('owner.nit')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('owner.branches')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('common.status')}</th>
                <th className="px-4 py-3 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={4} cols={5} />
              ) : empresas.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                    {t('owner.noCompanies')}
                  </td>
                </tr>
              ) : (
                empresas.map(emp => (
                  <tr key={emp.id} className="border-b border-gray-700 last:border-0 hover:bg-gray-750">
                    <td className="px-4 py-3 font-medium text-white">{emp.nombre}</td>
                    <td className="px-4 py-3 text-gray-400">{emp.nit ?? '—'}</td>
                    <td className="px-4 py-3 text-center">{emp.total_sucursales}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${
                        emp.activo ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'
                      }`}>
                        {emp.activo ? t('common.activeF') : t('common.inactiveF')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onSelectEmpresa(emp.id)}
                          className="text-blue-400 hover:text-blue-300 text-xs font-medium transition-colors"
                        >
                          {t('owner.viewDetail')}
                        </button>
                        <span className="text-gray-600">·</span>
                        <button
                          onClick={() => handleToggleActivo(emp)}
                          className={`text-xs font-medium transition-colors ${
                            emp.activo
                              ? 'text-amber-400 hover:text-amber-300'
                              : 'text-green-400 hover:text-green-300'
                          }`}
                        >
                          {emp.activo ? t('common.deactivate') : t('common.activate')}
                        </button>
                        <span className="text-gray-600">·</span>
                        <button
                          onClick={() => handleDeleteEmpresa(emp)}
                          className="text-red-400 hover:text-red-300 text-xs font-medium transition-colors"
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal nueva empresa */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md p-6 space-y-5">
            <h2 className="text-lg font-bold text-white">{t('owner.createCompany')}</h2>

            {formError && (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">{formError}</div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              {([
                ['nombre',   `${t('common.name')} *`, 'text'],
                ['nit',      t('owner.nit'),          'text'],
                ['logo_url', t('owner.logoUrl'),      'url'],
              ] as [keyof EmpresaInput, string, string][]).map(([name, label, type]) => (
                <div key={name}>
                  <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
                  <input
                    name={name}
                    type={type}
                    value={form[name] ?? ''}
                    onChange={handleChange}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {saving && <Spinner size={14} />} {t('empresas.create')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                >
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
