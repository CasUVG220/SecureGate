import { useEffect, useState } from 'react';
import { getEmpresaStats, getSucursales, type EmpresaStats, type Sucursal } from '../../services/api';
import { decodeTokenPayload } from '../../services/api';
import { TableSkeleton } from '../../components/Skeleton';
import { useTranslation } from '../../i18n/useTranslation';

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

function BarChart({ sucursales, noDataLabel, title }: { sucursales: EmpresaStats['sucursales']; noDataLabel: string; title: string }) {
  const max = Math.max(...sucursales.map(s => s.accesos_hoy), 1);
  return (
      <div className="sg-card space-y-3 p-5 sm:p-6">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <div className="overflow-x-auto">
      <div className="space-y-2 min-w-[320px]">
        {sucursales.map(s => (
          <div key={s.id} className="flex items-center gap-3">
            <span className="text-xs text-gray-400 w-32 truncate shrink-0">{s.nombre}</span>
            <div className="flex-1 bg-gray-700 rounded-full h-4 overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${(s.accesos_hoy / max) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-300 w-6 text-right">{s.accesos_hoy}</span>
          </div>
        ))}
        {sucursales.length === 0 && (
          <p className="text-gray-500 text-sm">{noDataLabel}</p>
        )}
      </div>
    </div>
    </div>
  );
}

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
      <h1 className="text-xl font-bold text-white">{t('ae.dashTitle')}</h1>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="sg-card p-5 border-l-4 border-gray-700 animate-pulse">
              <div className="h-3 bg-gray-700 rounded w-3/4 mb-3" />
              <div className="h-8 bg-gray-700 rounded w-1/2" />
            </div>
          ))
        ) : stats ? (
          <>
            <StatCard label={t('empDetail.branches')}        value={stats.total_sucursales}       accent="text-blue-400"   iconPath="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <StatCard label={t('empDetail.residents')}       value={stats.total_residentes}       accent="text-green-400"  iconPath="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
            <StatCard label={t('dashboard.accessesToday')}   value={stats.total_accesos_hoy}      accent="text-teal-400"   iconPath="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <StatCard label={t('dashboard.pendingPayments')} value={stats.total_pagos_pendientes} accent="text-amber-400"  iconPath="M1 4h22v16H1zM1 10h22" />
          </>
        ) : null}
      </div>

      {/* Bar chart */}
      {!loading && stats && (
        <BarChart
          sucursales={stats.sucursales}
          noDataLabel={t('ae.noData')}
          title={t('ae.accessByBranch')}
        />
      )}

      {/* Sucursales table */}
      <div className="sg-card overflow-hidden">
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
                      <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${
                        suc.activo ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'
                      }`}>
                        {suc.activo ? t('common.activeF') : t('common.inactiveF')}
                      </span>
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
