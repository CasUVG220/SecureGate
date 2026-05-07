import { useEffect, useState } from 'react';
import { getDashboard, type DashboardData } from '../services/api';
import { TableSkeleton } from '../components/Skeleton';
import { useTranslation } from '../i18n/useTranslation';

function StatCard({ label, value, colorClass, iconPath }: { label: string; value: number; colorClass: string; iconPath: string }) {
  return (
    <div className={`relative overflow-hidden bg-dark-800/40 backdrop-blur-md rounded-3xl p-6 border border-white/5 shadow-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_0_20px_rgba(0,0,0,0.3)] group`}>
      <div className={`absolute top-0 right-0 w-32 h-32 opacity-10 rounded-full blur-2xl -mr-10 -mt-10 transition-all duration-500 group-hover:scale-150 ${colorClass.replace('text-', 'bg-')}`}></div>
      <div className="flex justify-between items-start mb-4 relative z-10">
        <p className="text-gray-400 text-sm font-semibold tracking-wide uppercase">{label}</p>
        <div className={`p-2.5 rounded-xl bg-white/5 border border-white/5 shadow-glow ${colorClass}`}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d={iconPath}/></svg>
        </div>
      </div>
      <p className="text-4xl font-bold text-white relative z-10">{value}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const [data, setData]       = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    getDashboard()
      .then(setData)
      .catch(() => setError('No se pudo cargar el dashboard.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8 text-gray-100 space-y-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white tracking-tight">{t('dashboard.title')}</h1>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-dark-800/40 rounded-3xl p-6 border border-white/5 animate-pulse">
              <div className="h-4 bg-white/10 rounded w-1/2 mb-8" />
              <div className="h-10 bg-white/10 rounded w-1/3" />
            </div>
          ))
        ) : data ? (
          <>
            <StatCard label={t('dashboard.accessesToday')} value={data.accesos_hoy} colorClass="text-brand-500" iconPath="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            <StatCard label={t('dashboard.residentsInDebt')} value={data.residentes_mora} colorClass="text-red-500" iconPath="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            <StatCard label={t('dashboard.pendingPayments')} value={data.pagos_pendientes} colorClass="text-yellow-500" iconPath="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </>
        ) : null}
      </div>

      <div className="bg-dark-800/40 backdrop-blur-md rounded-3xl shadow-xl overflow-hidden border border-white/5">
        <div className="px-8 py-5 border-b border-white/5 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-white tracking-tight">{t('dashboard.recentAccesses')}</h2>
        </div>
        {!loading && data?.accesos_recientes.length === 0 ? (
          <div className="py-16 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </div>
            <p className="text-gray-400 text-sm">{t('dashboard.noAccesses')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-gray-400 text-left bg-white/[0.02]">
                <th className="px-8 py-4 font-semibold uppercase tracking-wider text-xs">{t('dashboard.visitor')}</th>
                <th className="px-8 py-4 font-semibold uppercase tracking-wider text-xs">{t('dashboard.unit')}</th>
                <th className="px-8 py-4 font-semibold uppercase tracking-wider text-xs">{t('dashboard.entry')}</th>
                <th className="px-8 py-4 font-semibold uppercase tracking-wider text-xs">{t('dashboard.exit')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <TableSkeleton rows={5} cols={4} />
              ) : (
                data?.accesos_recientes.map(a => (
                  <tr key={a.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-8 py-4 font-medium text-gray-200">{a.nombre_visitante}</td>
                    <td className="px-8 py-4 font-bold text-white">{a.numero_casa}</td>
                    <td className="px-8 py-4 text-gray-400">
                      {new Date(a.timestamp_entrada).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-8 py-4">
                      {a.timestamp_salida ? (
                        <span className="text-gray-400">
                          {new Date(a.timestamp_salida).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 bg-brand-500/10 border border-brand-500/20 text-brand-400 text-xs font-bold px-2.5 py-1 rounded-md shadow-[0_0_10px_rgba(99,102,241,0.2)]">
                          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse"></span>
                          {t('dashboard.active')}
                        </span>
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
