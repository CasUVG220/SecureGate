import { useEffect, useState } from 'react';
import {
  getEmpresas, createEmpresa, updateEmpresa, getDashboard,
  type Empresa, type EmpresaInput,
} from '../../services/api';
import { Spinner, TableSkeleton } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { useTranslation } from '../../i18n/useTranslation';

const EMPTY: EmpresaInput = { nombre: '', nit: '', logo_url: '' };

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

  return (
    <div className="p-6 text-gray-100 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">{t('owner.panelTitle')}</h1>
        <button
          onClick={() => { setShowModal(true); setFormError(null); setForm(EMPTY); }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
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
            <div key={i} className="bg-gray-800 rounded-2xl p-6 border-l-4 border-gray-700 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-2/3 mb-3" />
              <div className="h-10 bg-gray-700 rounded w-1/3" />
            </div>
          ))
        ) : (
          <>
            <div className="bg-gray-800 rounded-2xl p-6 shadow-xl border-l-4 border-blue-500">
              <p className="text-gray-400 text-sm font-medium">{t('owner.activeCompanies')}</p>
              <p className="text-4xl font-bold text-white mt-2">{totalEmpresasActivas}</p>
            </div>
            <div className="bg-gray-800 rounded-2xl p-6 shadow-xl border-l-4 border-green-500">
              <p className="text-gray-400 text-sm font-medium">{t('owner.activeBranches')}</p>
              <p className="text-4xl font-bold text-white mt-2">{totalSucursalesActivas}</p>
            </div>
            <div className="bg-gray-800 rounded-2xl p-6 shadow-xl border-l-4 border-teal-500">
              <p className="text-gray-400 text-sm font-medium">{t('owner.globalAccesses')}</p>
              <p className="text-4xl font-bold text-white mt-2">{accesosHoy}</p>
            </div>
          </>
        )}
      </div>

      {/* Tabla empresas */}
      <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
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
