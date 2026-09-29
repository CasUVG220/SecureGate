import { useEffect, useState } from 'react';
import { getEmpresaStats, getSucursales, type EmpresaStats, type Sucursal } from '../../services/api';
import { decodeTokenPayload } from '../../services/api';
import { TableSkeleton } from '../../components/Skeleton';
import { StatusText } from '../../components/ui';
import { ResumenCifrasEsqueleto } from '../../components/charts';
import ResumenEmpresa from './ResumenEmpresa';
import { useTranslation } from '../../i18n/useTranslation';

export default function AdminEmpresaDashboard() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<EmpresaStats | null>(null);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const empresaId = (() => {
    const token = localStorage.getItem('token');
    if (!token) return null;
    return (decodeTokenPayload(token)?.empresa_id as string) ?? null;
  })();

  useEffect(() => {
    if (!empresaId) {
      // El estado refleja la ausencia de contexto recibido desde autenticación.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('No se encontró empresa asociada al usuario.');
      setLoading(false);
      return;
    }
    Promise.all([getEmpresaStats(empresaId), getSucursales()])
      .then(([s, suc]) => {
        setStats(s);
        setSucursales(suc);
      })
      .catch(() => setError('No se pudo cargar la información.'))
      .finally(() => setLoading(false));
  }, [empresaId]);

  return (
    <div className="sg-page text-gray-100">
      <div className="sg-panel-heading">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-50 sm:text-3xl">{t('ae.dashTitle')}</h1>
          <p className="mt-1 text-sm text-gray-400">{t('ae.dashSubtitle')}</p>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-400">{error}</div>
      )}

      {loading ? <ResumenCifrasEsqueleto filas={3} /> : stats ? <ResumenEmpresa stats={stats} /> : null}

      {/* Sucursales table */}
      <div className="sg-table-wrap">
        <div className="border-b border-white/10 px-5 py-4 sm:px-6">
          <h2 className="text-base font-semibold text-white">{t('ae.branchesSection')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">{t('ae.branchLabel')}</th>
                <th className="px-4 py-3 font-medium">{t('empDetail.tipo')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('empDetail.residents')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('empDetail.agents')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={3} cols={5} />
              ) : sucursales.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                    {t('ae.noBranches')}
                  </td>
                </tr>
              ) : (
                sucursales.map(suc => (
                  <tr key={suc.id} className="border-b border-gray-700 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{suc.nombre}</p>
                      {suc.direccion && <p className="text-xs text-gray-500">{suc.direccion}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{suc.tipo ?? '—'}</td>
                    <td className="px-4 py-3 text-center">{suc.total_residentes}</td>
                    <td className="px-4 py-3 text-center">{suc.total_agentes}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusText kind={suc.activo ? 'on' : 'off'}>
                        {suc.activo ? t('common.activeF') : t('common.inactiveF')}
                      </StatusText>
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
