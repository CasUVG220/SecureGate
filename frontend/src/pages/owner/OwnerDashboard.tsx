import { useEffect, useState } from 'react';
import {
  getEmpresas, updateEmpresa, deleteEmpresa, getDashboard,
  type DashboardData, type Empresa,
} from '../../services/api';
import { TableSkeleton } from '../../components/Skeleton';
import { Button, EmptyState, ROW_ICON, RowActions, StatusText, useConfirmacion } from '../../components/ui';
import EmpresaModal from '../../components/EmpresaModal';
import InvitarAdminModal from '../../components/InvitarAdminModal';
import { AccesosPorHora, ResumenCifras, ResumenCifrasEsqueleto, comparar, fmtNumero, rellenar } from '../../components/charts';
import { useToast } from '../../components/Toast';
import { useTranslation } from '../../i18n/useTranslation';
import { plural } from '../../i18n/plural';

const ICON_EMPRESA = 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01';

interface Props {
  onSelectEmpresa: (id: string) => void;
}

export default function OwnerDashboard({ onSelectEmpresa }: Props) {
  const showToast = useToast();
  const { t, language } = useTranslation();
  const { confirmar, dialogo } = useConfirmacion();

  const [empresas, setEmpresas]   = useState<Empresa[]>([]);
  const [dash, setDash]           = useState<DashboardData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  /** Alta de empresa: el mismo diálogo que usa la lista de empresas. */
  const [crearAbierto, setCrearAbierto] = useState(false);
  const [invitarDlg, setInvitarDlg]     = useState<{ abierto: boolean; empresa: Empresa | null }>({ abierto: false, empresa: null });

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
    const ok = await confirmar({
      title: rellenar(t('confirm.deleteCompany.title'), { nombre: emp.nombre }),
      message: t('confirm.deleteCompany.message'),
      confirmLabel: t('confirm.deleteCompany.action'),
      tone: 'danger',
    });
    if (!ok) return;
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
        {(loading || empresas.length > 0) && <Button onClick={() => setCrearAbierto(true)}>{t('owner.newCompany')}</Button>}
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
              nota: plural(t, 'owner.ofRegistered', n(empresas.length), {}, empresas.length),
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
                  <td colSpan={5}>
                    <EmptyState
                      icon={ICON_EMPRESA}
                      title={t('owner.welcome.title')}
                      description={t('owner.welcome.body')}
                      action={<Button onClick={() => setCrearAbierto(true)}>{t('owner.welcome.cta')}</Button>}
                    />
                  </td>
                </tr>
              ) : (
                empresas.map(emp => (
                  <tr key={emp.id} className="border-b border-gray-700 last:border-0 hover:bg-gray-500/[0.06]">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{emp.nombre}</p>
                      {emp.activo && emp.tiene_admin === false && (
                        <p className="mt-1">
                          <StatusText kind="warn">{t(emp.invitacion_pendiente ? 'sinAdmin.invited' : 'sinAdmin.none')}</StatusText>
                        </p>
                      )}
                    </td>
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
                          ...(emp.activo && emp.tiene_admin === false ? [{
                            id: 'invitar-admin',
                            label: t('inv.action.inviteAdmin'),
                            icon: ROW_ICON.user,
                            tone: 'primary' as const,
                            onClick: () => setInvitarDlg({ abierto: true, empresa: emp }),
                          }] : []),
                          {
                            id: 'detalle',
                            label: t('owner.viewDetail'),
                            icon: ROW_ICON.view,
                            tone: emp.activo && emp.tiene_admin === false ? undefined : 'primary',
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

      <EmpresaModal
        open={crearAbierto}
        onClose={() => setCrearAbierto(false)}
        onSaved={() => cargar()}
        onInvitar={emp => setInvitarDlg({ abierto: true, empresa: emp })}
      />

      <InvitarAdminModal
        open={invitarDlg.abierto}
        onClose={() => setInvitarDlg(d => ({ ...d, abierto: false }))}
        modo="owner"
        empresaFija={invitarDlg.empresa ? { id: invitarDlg.empresa.id, nombre: invitarDlg.empresa.nombre } : null}
        onEnviada={() => cargar()}
      />
      {dialogo}
    </div>
  );
}
