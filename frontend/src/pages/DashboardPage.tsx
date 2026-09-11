import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDashboard, type DashboardData } from '../services/api';
import { Badge, Button, EmptyState, TelemetryStrip, TelemetrySkeleton, cx } from '../components/ui';
import Skeleton from '../components/ui/Skeleton';
import { useTranslation } from '../i18n/useTranslation';
import { inicial, tiempoRelativo } from '../utils/tiempo';

const ICON = {
  accesos:    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  mora:       'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  pendientes: 'M12 8v4l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  dentro:     'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10',
  inbox:      'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
};

export default function DashboardPage() {
  const { t } = useTranslation();
  const [data, setData]       = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  // Se guarda la clave de traducción, no el texto: `t` cambia de identidad en
  // cada render, así que meterlo en las dependencias de `cargar` encadenaba
  // petición → render → petición sin parar.
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setLoading(true);
    setErrorKey(null);
    getDashboard()
      // Una respuesta buena limpia el aviso: con dos peticiones en vuelo (React
      // StrictMode monta el efecto dos veces) el error de la que falló se
      // quedaba en pantalla junto a los datos de la que sí llegó.
      .then(d => { setData(d); setErrorKey(null); })
      .catch(() => setErrorKey('dashboard.errorLoad'))
      .finally(() => setLoading(false));
  }, []);

  // Carga inicial del módulo; el estado se actualiza al resolver la petición.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar(); }, [cargar]);

  const recientes = useMemo(() => data?.accesos_recientes ?? [], [data]);
  // Visitantes todavía dentro entre los últimos accesos que devuelve la API.
  const dentro = useMemo(() => recientes.filter(a => !a.timestamp_salida).length, [recientes]);

  /** Casas con más movimiento entre los accesos recientes, de mayor a menor. */
  const topCasas = useMemo(() => {
    const conteo = new Map<string, number>();
    for (const a of recientes) conteo.set(a.numero_casa, (conteo.get(a.numero_casa) ?? 0) + 1);
    return [...conteo.entries()]
      .map(([numero, total]) => ({ numero, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [recientes]);

  return (
    <div className="sg-page">
      <div className="sg-page-inner space-y-5">
        <header className="sg-panel-heading">
          <div>
            <p className="sg-eyebrow">SecureGate</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-50 sm:text-3xl">{t('dashboard.title')}</h1>
            <p className="mt-1 text-sm text-gray-400">{t('dashboard.subtitle')}</p>
          </div>
          <Badge tone="success" dot>{t('dashboard.gateOnline')}</Badge>
        </header>

        <section className="sg-hero" aria-label="Resumen de control de acceso">
          <div className="sg-hero-grid">
            <div>
              <p className="sg-hero-label">Control de acceso</p>
              <h2 className="sg-hero-title">Todo lo importante de tu comunidad, en una mirada.</h2>
              <p className="sg-hero-copy">Monitorea la actividad de la garita y detecta pagos o residentes que requieren seguimiento.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="sg-hero-stat">
                <p className="sg-hero-stat-label">Dentro ahora</p>
                <p className="sg-hero-stat-value">
                  {loading ? <Skeleton height="1.75rem" width="2.5rem" /> : dentro}
                </p>
              </div>
              <div className="sg-hero-stat">
                <p className="sg-hero-stat-label">Accesos hoy</p>
                <p className="sg-hero-stat-value">
                  {loading ? <Skeleton height="1.75rem" width="2.5rem" /> : data?.accesos_hoy ?? 0}
                </p>
              </div>
            </div>
          </div>
        </section>

        {errorKey && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-400">
            <span>{t(errorKey)}</span>
            <Button variant="secondary" size="sm" onClick={cargar}>{t('dashboard.retry')}</Button>
          </div>
        )}

        {/* Consola de Telemetría Operativa (HUD) */}
        {loading ? (
          <TelemetrySkeleton count={4} />
        ) : data ? (
          <TelemetryStrip
            eyebrow="Consola de Garita · Telemetría en Vivo"
            statusBadge={<Badge tone="success" dot>{t('dashboard.gateOnline')}</Badge>}
            items={[
              {
                id: 'accesos',
                label: t('dashboard.accessesToday'),
                value: data.accesos_hoy,
                icon: ICON.accesos,
                tone: 'brand',
                hint: t('dashboard.todayHint'),
              },
              {
                id: 'dentro',
                label: t('dashboard.insideNow'),
                value: dentro,
                icon: ICON.dentro,
                tone: 'success',
                hint: t('dashboard.insideNowHint'),
              },
              {
                id: 'pendientes',
                label: t('dashboard.pendingPayments'),
                value: data.pagos_pendientes,
                icon: ICON.pendientes,
                tone: 'warning',
                hint: t('dashboard.pendingHint'),
                highlight: data.pagos_pendientes > 0,
                actionLabel: data.pagos_pendientes > 0 ? 'Verificar →' : undefined,
              },
              {
                id: 'mora',
                label: t('dashboard.residentsInDebt'),
                value: data.residentes_mora,
                icon: ICON.mora,
                tone: 'danger',
                hint: t('dashboard.debtHint'),
                highlight: data.residentes_mora > 0,
              },
            ]}
          />
        ) : null}

        {/* En pantallas anchas la actividad ocupa dos tercios y el resumen el
            tercio restante, en vez de apilarse a lo largo de toda la página. */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <section className="sg-card overflow-hidden xl:col-span-2">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-700 px-5 py-4">
              <div>
                <h2 className="text-base font-bold tracking-tight text-gray-50">{t('dashboard.recentAccesses')}</h2>
                <p className="mt-0.5 text-sm text-gray-400">{t('dashboard.recentSubtitle')}</p>
              </div>
              {!loading && dentro > 0 && (
                <Badge tone="success" dot>{dentro} {t('dashboard.openAccesses')}</Badge>
              )}
            </header>

            {loading ? (
              <ul className="divide-y divide-gray-700">
                {Array.from({ length: 5 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-3 px-5 py-3.5">
                    <Skeleton circle width={38} height={38} />
                    <div className="flex-1 space-y-2">
                      <Skeleton height="0.8rem" width="38%" />
                      <Skeleton height="0.7rem" width="24%" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : recientes.length === 0 ? (
              <EmptyState icon={ICON.inbox} title={t('dashboard.noAccesses')} />
            ) : (
              <ul className="divide-y divide-gray-700">
                {recientes.map(a => {
                  const activo = !a.timestamp_salida;
                  return (
                    <li key={a.id} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-gray-500/[0.06] sm:px-5">
                      <span
                        className={cx(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                          activo ? 'bg-success-500/15 text-success-400' : 'bg-gray-500/12 text-gray-300',
                        )}
                        aria-hidden="true"
                      >
                        {inicial(a.nombre_visitante)}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-100">{a.nombre_visitante}</p>
                        <p className="mt-0.5 text-xs text-gray-400">
                          {t('dashboard.unit')} <span className="font-semibold text-gray-300">{a.numero_casa}</span>
                          {' · '}
                          <time
                            dateTime={a.timestamp_entrada}
                            title={new Date(a.timestamp_entrada).toLocaleString('es-GT')}
                          >
                            {tiempoRelativo(a.timestamp_entrada, t)}
                          </time>
                        </p>
                      </div>

                      {activo ? (
                        <Badge tone="success" dot>{t('dashboard.active')}</Badge>
                      ) : (
                        <span className="shrink-0 text-xs text-gray-400">
                          {t('dashboard.exit')}{' '}
                          {new Date(a.timestamp_salida!).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="sg-card p-5">
            <h2 className="text-base font-bold tracking-tight text-gray-50">{t('dashboard.topHouses')}</h2>
            <p className="mt-0.5 text-sm text-gray-400">{t('dashboard.topHousesHint')}</p>

            {loading ? (
              <div className="mt-5 space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton height="0.7rem" width="30%" />
                    <Skeleton height="0.4rem" />
                  </div>
                ))}
              </div>
            ) : topCasas.length === 0 ? (
              <EmptyState compact icon={ICON.dentro} title={t('dashboard.noAccesses')} />
            ) : (
              <ul className="mt-5 space-y-4">
                {topCasas.map(casa => (
                  <li key={casa.numero}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold text-gray-100">
                        {t('dashboard.unit')} {casa.numero}
                      </span>
                      <span className="text-xs font-bold tabular-nums text-gray-400">
                        {casa.total} {t('dashboard.visits')}
                      </span>
                    </div>
                    {/* La barra compara contra la casa con más movimiento, no
                        contra el total: hace legible la diferencia relativa. */}
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-500/15">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${Math.round((casa.total / topCasas[0].total) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
