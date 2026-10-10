import { useEffect, useState } from 'react';
import {
  getEmpresas, createEmpresa, updateEmpresa, deleteEmpresa, getDashboard,
  type DashboardData, type Empresa, type EmpresaInput,
} from '../../services/api';
import { TableSkeleton } from '../../components/Skeleton';
import { Button, ROW_ICON, RowActions, StatusText } from '../../components/ui';
import { AccesosPorHora, ResumenCifras, ResumenCifrasEsqueleto, comparar, fmtNumero, rellenar } from '../../components/charts';
import { useToast } from '../../components/Toast';
import { useTranslation } from '../../i18n/useTranslation';

const EMPTY: EmpresaInput = { nombre: '', nit: '', logo_url: '' };

interface Props {
  onSelectEmpresa: (id: string) => void;
}

export default function OwnerDashboard({ onSelectEmpresa }: Props) {
  const showToast = useToast();
  const { t, language } = useTranslation();

  const [empresas, setEmpresas]   = useState<Empresa[]>([]);
  const [dash, setDash]           = useState<DashboardData | null>(null);
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
        setDash(dash);
      })
      .catch(() => setError('No se pudo cargar el panel.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, []);

  const totalEmpresasActivas   = empresas.filter(e => e.activo).length;
  const n = (x: number) => fmtNumero(x, language);
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
        <div role="alert" className="rounded-xl border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-400">{error}</div>
      )}

      {loading && !dash ? (
        <ResumenCifrasEsqueleto filas={3} />
      ) : dash ? (
        <ResumenCifras
          ariaLabel={t('owner.summary')}
          principal={{
            etiqueta: t('owner.globalAccesses'),
            valor: n(dash.accesos_hoy),
            comparacion: comparar(dash.accesos_hoy, dash.accesos_ayer_misma_hora, {
              formato: n, bueno: null, lang: language,
              frente: t('dashboard.vsYesterday'),
              sinBase: t('dashboard.noYesterday'),
            }),
            grafico: (
              <AccesosPorHora
                porHora={dash.accesos_por_hora}
                lang={language}
                etiquetas={{ serie: t('owner.globalAccesses'), maximo: t('stats.chart.peak'), vacio: t('dashboard.noAccessesToday') }}
                ariaLabel={`${t('dashboard.byHour')}. ${t('stats.chart.keyboardHint')}`}
              />
            ),
          }}
          filas={[
            {
              id: 'empresas',
              etiqueta: t('owner.activeCompanies'),
              valor: n(totalEmpresasActivas),
              nota: rellenar(t('owner.ofRegistered'), { n: n(empresas.length) }),
              barra: empresas.length
                ? { tipo: 'proporcion', fraccion: totalEmpresasActivas / empresas.length, tono: 'series', etiqueta: t('owner.activeCompanies') }
                : undefined,
            },
            { id: 'comunidades', etiqueta: t('owner.activeBranches'), valor: n(totalSucursalesActivas), nota: t('owner.branchesHint') },
            { id: 'dentro', etiqueta: t('dashboard.insideNow'), valor: n(dash.dentro_ahora), nota: t('dashboard.insideNowHint') },
          ]}
        />
      ) : null}

      {/* Tabla empresas */}
      <div className="sg-table-wrap">
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
                  <tr key={emp.id} className="border-b border-gray-700 last:border-0 hover:bg-gray-500/[0.06]">
                    <td className="px-4 py-3 font-medium text-white">{emp.nombre}</td>
                    <td className="px-4 py-3 text-gray-400">{emp.nit ?? '—'}</td>
                    <td className="px-4 py-3 text-center">{emp.total_sucursales}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusText kind={emp.activo ? 'on' : 'off'}>
                        {emp.activo ? t('common.activeF') : t('common.inactiveF')}
                      </StatusText>
                    </td>
                    <td className="px-4 py-3">
                      <RowActions
                        align="start"
                        menuLabel={`${t('common.actions')}: ${emp.nombre}`}
                        actions={[
                          {
                            id: 'detalle',
                            label: t('owner.viewDetail'),
                            icon: ROW_ICON.view,
                            tone: 'primary',
                            onClick: () => onSelectEmpresa(emp.id),
                          },
                          {
                            id: 'toggle',
                            label: emp.activo ? t('common.deactivate') : t('common.activate'),
                            icon: emp.activo ? ROW_ICON.pause : ROW_ICON.play,
                            onClick: () => handleToggleActivo(emp),
                          },
                          {
                            id: 'eliminar',
                            label: t('common.delete'),
                            icon: ROW_ICON.trash,
                            tone: 'danger',
                            onClick: () => handleDeleteEmpresa(emp),
                          },
                        ]}
                      />
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
                <Button type="submit" loading={saving} className="flex-1">
                  {t('empresas.create')}
                </Button>
                <Button variant="ghost" onClick={() => setShowModal(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
