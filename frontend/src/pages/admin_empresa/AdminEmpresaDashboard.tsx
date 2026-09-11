import { useEffect, useState } from 'react';
import { getEmpresaStats, getSucursales, type EmpresaStats, type Sucursal } from '../../services/api';
import { decodeTokenPayload } from '../../services/api';
import { TableSkeleton } from '../../components/Skeleton';
import { StatusText, TelemetryStrip, TelemetrySkeleton } from '../../components/ui';
import { useTranslation } from '../../i18n/useTranslation';

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
      <div className="sg-panel-heading">
        <div>
          <p className="sg-eyebrow">SecureGate · Organización</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">{t('ae.dashTitle')}</h1>
          <p className="mt-1 text-sm text-[var(--sg-text-muted)]">Controla el rendimiento de cada comunidad desde una sola vista.</p>
        </div>
        <span className="sg-status bg-emerald-500/10 text-emerald-400">Red operativa</span>
      </div>

      <section className="sg-hero" aria-label="Resumen de la empresa">
        <div className="sg-hero-grid">
          <div>
            <p className="sg-hero-label">Cartera de comunidades</p>
            <h2 className="sg-hero-title">Tu operación, comunidad por comunidad.</h2>
            <p className="sg-hero-copy">Compara actividad, residentes y personal para decidir dónde actuar primero.</p>
          </div>
          <div className="sg-hero-stat">
            <p className="sg-hero-stat-label">Sucursales activas</p>
            <p className="sg-hero-stat-value">{stats?.total_sucursales ?? '—'}</p>
          </div>
        </div>
      </section>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      {/* Consola de Telemetría Operativa (HUD) */}
      {loading ? (
        <TelemetrySkeleton count={4} />
      ) : stats ? (
        <TelemetryStrip
          eyebrow="Consola de Red · Cartera Inmobiliaria"
          statusBadge={<span className="sg-status bg-emerald-500/10 text-emerald-400">Red operativa</span>}
          items={[
            {
              id: 'sucursales',
              label: t('empDetail.branches'),
              value: stats.total_sucursales,
              tone: 'brand',
              icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
              hint: 'Sedes bajo administración',
            },
            {
              id: 'residentes',
              label: t('empDetail.residents'),
              value: stats.total_residentes,
              tone: 'success',
              icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
              hint: 'Directorio consolidado',
            },
            {
              id: 'accesos',
              label: t('dashboard.accessesToday'),
              value: stats.total_accesos_hoy,
              tone: 'info',
              icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
              hint: 'Movimientos globales de hoy',
            },
            {
              id: 'pendientes',
              label: t('dashboard.pendingPayments'),
              value: stats.total_pagos_pendientes,
              tone: 'warning',
              icon: 'M1 4h22v16H1zM1 10h22',
              hint: 'Pendientes de revisión',
              highlight: stats.total_pagos_pendientes > 0,
              actionLabel: stats.total_pagos_pendientes > 0 ? 'Verificar →' : undefined,
            },
          ]}
        />
      ) : null}

      {/* Bar chart */}
      {!loading && stats && (
        <BarChart
          sucursales={stats.sucursales}
          noDataLabel={t('ae.noData')}
          title={t('ae.accessByBranch')}
        />
      )}

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
