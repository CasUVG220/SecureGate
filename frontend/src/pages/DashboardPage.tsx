import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDashboard, type DashboardData } from '../services/api';
import {
  AccesosPorHora, BarList, ResumenCifras, ResumenCifrasEsqueleto, comparar, fmtNumero, rellenar,
} from '../components/charts';
import { Badge, Button, EmptyState, cx } from '../components/ui';
import Skeleton from '../components/ui/Skeleton';
import { useTranslation } from '../i18n/useTranslation';
import { inicial, tiempoRelativo } from '../utils/tiempo';

const ICON = {
  dentro: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10',
  inbox:  'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
};

const LOCALE = { es: 'es-GT', en: 'en-US' } as const;

export default function DashboardPage({ onNavigate }: { onNavigate?: (pagina: string) => void } = {}) {
  const { t, language: lang } = useTranslation();
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

  /** Casas con más movimiento entre los accesos recientes, de mayor a menor. */
  const topCasas = useMemo(() => {
    const conteo = new Map<string, number>();
    for (const a of recientes) conteo.set(a.numero_casa, (conteo.get(a.numero_casa) ?? 0) + 1);
    return [...conteo.entries()]
      .map(([numero, total]) => ({ numero, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [recientes]);

  const n = (x: number) => fmtNumero(x, lang);
  // Sólo la inicial en mayúscula ("Jueves, 24 de septiembre"): `capitalize`
  // de CSS la pondría en cada palabra.
  const fecha = new Date().toLocaleDateString(LOCALE[lang], { weekday: 'long', day: 'numeric', month: 'long' });
  const hoy = fecha.charAt(0).toUpperCase() + fecha.slice(1);

  return (
    <div className="sg-page">
      <div className="sg-page-inner space-y-5">
        <header className="sg-panel-heading">
          <div>
            <h1 className="text-2xl font-bold text-gray-50 sm:text-3xl">{t('dashboard.title')}</h1>
            <p className="mt-1 text-sm text-gray-400">{t('dashboard.subtitle')}</p>
          </div>
          <p className="text-sm font-medium text-gray-300">{hoy}</p>
        </header>

        {errorKey && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-400">
            <span>{t(errorKey)}</span>
            <Button variant="secondary" size="sm" onClick={cargar}>{t('dashboard.retry')}</Button>
          </div>
        )}

        {loading && !data ? (
          <ResumenCifrasEsqueleto filas={3} />
        ) : data ? (
          <ResumenCifras
            ariaLabel={t('dashboard.summary')}
            principal={{
              etiqueta: t('dashboard.accessesToday'),
              valor: n(data.accesos_hoy),
              comparacion: comparar(data.accesos_hoy, data.accesos_ayer_misma_hora, {
                formato: n, bueno: null, lang,
                frente: t('dashboard.vsYesterday'),
                sinBase: t('dashboard.noYesterday'),
              }),
              grafico: (
                <AccesosPorHora
                  porHora={data.accesos_por_hora}
                  lang={lang}
                  etiquetas={{ serie: t('dashboard.accessesToday'), maximo: t('stats.chart.peak'), vacio: t('dashboard.noAccessesToday') }}
                  ariaLabel={`${t('dashboard.byHour')}. ${t('stats.chart.keyboardHint')}`}
                />
              ),
            }}
            filas={[
              {
                id: 'dentro',
                etiqueta: t('dashboard.insideNow'),
                valor: n(data.dentro_ahora),
                nota: t('dashboard.insideNowHint'),
              },
              {
                id: 'pendientes',
                etiqueta: t('dashboard.pendingPayments'),
                valor: n(data.pagos_pendientes),
                nota: data.pagos_pendientes ? t('dashboard.pendingHint') : t('dashboard.pendingNone'),
                atencion: data.pagos_pendientes > 0 ? 'warning' : undefined,
                accion: onNavigate && data.pagos_pendientes > 0
                  ? { texto: t('dashboard.goVerify'), onClick: () => onNavigate('verificacion') }
                  : undefined,
              },
              {
                id: 'mora',
                etiqueta: t('dashboard.residentsInDebt'),
                valor: n(data.residentes_mora),
                nota: data.residentes_mora ? t('dashboard.debtHint') : t('dashboard.debtNone'),
                atencion: data.residentes_mora > 0 ? 'danger' : undefined,
                accion: onNavigate && data.residentes_mora > 0
                  ? { texto: t('dashboard.goResidents'), onClick: () => onNavigate('residentes') }
                  : undefined,
              },
            ]}
          />
        ) : null}

        {/* En pantallas anchas la actividad ocupa dos tercios y el resumen el
            tercio restante, en vez de apilarse a lo largo de toda la página. */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <section className="sg-card min-w-0 overflow-hidden xl:col-span-2">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-700 px-5 py-4">
              <div>
                <h2 className="text-base font-bold tracking-tight text-gray-50">{t('dashboard.recentAccesses')}</h2>
                <p className="mt-0.5 text-sm text-gray-400">{t('dashboard.recentSubtitle')}</p>
              </div>
            </header>

            {loading && !data ? (
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

          <section className="sg-card min-w-0 p-5">
            <h2 className="text-base font-bold tracking-tight text-gray-50">{t('dashboard.topHouses')}</h2>
            <p className="mt-0.5 text-sm text-gray-400">{t('dashboard.topHousesHint')}</p>

            {loading && !data ? (
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
              <BarList
                className="mt-5"
                items={topCasas.map(c => ({ id: c.numero, etiqueta: `${t('dashboard.unit')} ${c.numero}`, valor: c.total }))}
                formato={x => rellenar(t(x === 1 ? 'stats.unit.visitOne' : 'stats.unit.visits'), { n: n(x) })}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
