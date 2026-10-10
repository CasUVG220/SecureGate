import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  downloadReporteAccesos, downloadReportePagos, getEstadisticas, type Estadisticas,
} from '../services/api';
import {
  BarList, BotonTabla, ChartCard, Heatmap, Medidor, ResumenCifras, ResumenCifrasEsqueleto, SegmentedBar, TablaDatos,
  TimeSeriesChart, comparar, fmtCompacto, fmtDuracion, fmtFechaCorta, fmtNumero, fmtPorcentaje, fmtQuetzales, fmtRango,
} from '../components/charts';
import type { LangKey } from '../context/LanguageContext';
import { Button, ErrorState, Skeleton, cx } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { useTranslation } from '../i18n/useTranslation';
import { calcularHallazgos, rellenar, type TonoHallazgo } from './estadisticas/hallazgos';
import {
  PRESETS, rangoDePreset, validarRango, type Preset, type Rango,
} from './estadisticas/periodos';

const ICON = {
  exportar:  'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  refrescar: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
  info:      'M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  ok:        'M20 6L9 17l-5-5',
  alerta:    'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  candado:   'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4',
};

const PRESET_KEY = 'sg_stats_preset';

// El ícono lleva el estado (con su color); la frase, el contenido. Sin recuadro de fondo.
const TONO_HALLAZGO: Record<TonoHallazgo, { color: string; icono: string }> = {
  info:    { color: 'text-gray-400',    icono: ICON.info },
  success: { color: 'text-success-400', icono: ICON.ok },
  warning: { color: 'text-warning-400', icono: ICON.alerta },
  danger:  { color: 'text-danger-400',  icono: ICON.alerta },
};

function Icono({ d, size = 16, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Encabezado de cada bloque temático: título y cómo leerlo, sin adornos. */
function Seccion({ id, titulo, pista, children }: {
  id: string; titulo: string; pista: string; children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[rgb(var(--c-hairline))] pb-3">
        <h2 id={id} className="text-lg font-semibold tracking-tight text-gray-50">{titulo}</h2>
        <p className="text-sm text-gray-400">{pista}</p>
      </header>
      {children}
    </section>
  );
}

/** Subtítulo dentro de una tarjeta: en tono normal, no en mayúsculas espaciadas. */
function Subtitulo({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-3 text-sm font-medium text-gray-300">{children}</h4>;
}

/** Celda de una franja de datos sueltos (perfil de visitas, reservas). */
function Celda({ etiqueta, valor, nota, atencion, children }: {
  etiqueta: string; valor: string; nota?: string; atencion?: 'warning' | 'danger'; children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 px-5 py-4">
      <dt className="flex items-start gap-1.5 text-sm leading-snug text-gray-400">
        {atencion && <Icono d={ICON.alerta} size={14} className={cx('mt-0.5 shrink-0', atencion === 'danger' ? 'text-danger-400' : 'text-warning-400')} />}
        <span>{etiqueta}</span>
      </dt>
      <dd className="mt-1 text-xl font-semibold tracking-tight text-gray-50">{valor}</dd>
      {nota && <dd className="mt-0.5 text-xs text-gray-400">{nota}</dd>}
      {children && <dd className="mt-2.5">{children}</dd>}
    </div>
  );
}

/** Gráfico de la cifra principal, con su leyenda y su vista de tabla. */
function GraficoVisitas({ d, lang, t }: { d: Estadisticas; lang: LangKey; t: (k: string, f?: string) => string }) {
  const [tabla, setTabla] = useState(false);
  const n = (x: number) => fmtNumero(x, lang);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-3 text-2xs text-gray-400" aria-hidden="true">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded-full bg-viz-series" />{t('stats.chart.current')}</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded-full bg-gray-500" />{t('stats.chart.previous')}</span>
        </span>
        <BotonTabla activo={tabla} onClick={() => setTabla(v => !v)} etiquetas={{ verTabla: t('stats.chart.viewTable'), verGrafico: t('stats.chart.viewChart') }} />
      </div>
      {tabla ? (
        <TablaDatos
          caption={t('stats.chart.visitsTitle')}
          columnas={[t('stats.table.date'), t('stats.chart.current'), t('stats.chart.previous')]}
          numericas={[1, 2]}
          filas={d.accesos.por_dia.map((p, i) => [fmtFechaCorta(p.fecha, lang), n(p.total), n(d.accesos.por_dia_anterior[i] ?? 0)])}
        />
      ) : (
        <TimeSeriesChart
          alto={250}
          datos={d.accesos.por_dia.map(p => ({ fecha: p.fecha, valor: p.total }))}
          anterior={d.accesos.por_dia_anterior}
          lang={lang}
          formatoValor={n}
          formatoEje={x => fmtCompacto(x, lang)}
          etiquetas={{ actual: t('stats.chart.current'), anterior: t('stats.chart.previous'), maximo: t('stats.chart.peak'), vacio: t('stats.chart.empty') }}
          ariaLabel={`${t('stats.chart.visitsTitle')}. ${t('stats.chart.keyboardHint')}`}
        />
      )}
    </div>
  );
}

function EsqueletoPagina() {
  return (
    <div className="space-y-6" role="status" aria-label="Cargando">
      <ResumenCifrasEsqueleto filas={4} />
      <div className="sg-card space-y-3 p-5">
        <Skeleton height="0.9rem" width="30%" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height="2.75rem" />)}
        </div>
      </div>
    </div>
  );
}

export default function EstadisticasPage({ onNavigate }: { onNavigate?: (pagina: string) => void } = {}) {
  const { t, language: lang } = useTranslation();
  const showToast = useToast();

  const [preset, setPreset] = useState<Preset>(() => {
    try {
      const guardado = localStorage.getItem(PRESET_KEY) as Preset | null;
      return guardado && PRESETS.includes(guardado) && guardado !== 'custom' ? guardado : '30d';
    } catch {
      return '30d';
    }
  });
  const [rango, setRango] = useState<Rango>(() => rangoDePreset(preset === 'custom' ? '30d' : preset));
  const [borrador, setBorrador] = useState<Rango>(rango);
  const [datos, setDatos] = useState<Estadisticas | null>(null);
  const [cargando, setCargando] = useState(true);
  // Clave de traducción y no texto: `t` cambia de identidad en cada render.
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [descargando, setDescargando] = useState<'accesos' | 'pagos' | null>(null);

  const cargar = useCallback((signal: AbortSignal) => {
    setCargando(true);
    getEstadisticas(rango.desde, rango.hasta, signal)
      .then(d => { setDatos(d); setErrorKey(null); })
      .catch(err => { if ((err as Error).name !== 'AbortError') setErrorKey('stats.errorTitle'); })
      .finally(() => { if (!signal.aborted) setCargando(false); });
  }, [rango]);

  // Cada cambio de periodo (o reintento) vuelve a pedir; el anterior se cancela.
  useEffect(() => {
    const ac = new AbortController();
    cargar(ac.signal);
    return () => ac.abort();
  }, [cargar, intento]);

  const elegirPreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') {
      const r = rangoDePreset(p);
      setRango(r);
      setBorrador(r);
    }
    try { localStorage.setItem(PRESET_KEY, p); } catch { /* sin storage no se recuerda */ }
  };

  const errorRango = validarRango(borrador);
  const aplicarPersonalizado = (e: React.FormEvent) => {
    e.preventDefault();
    if (!errorRango) setRango({ ...borrador });
  };

  const descargar = async (tipo: 'accesos' | 'pagos') => {
    setDescargando(tipo);
    try {
      await (tipo === 'accesos' ? downloadReporteAccesos : downloadReportePagos)(rango.desde, rango.hasta);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('stats.export.error'), 'error');
    } finally {
      setDescargando(null);
    }
  };

  // ── Formatos ──────────────────────────────────────────────────────────────
  const n = (x: number) => fmtNumero(x, lang);
  const q = (x: number) => fmtQuetzales(x, lang);
  const qEje = (x: number) => fmtQuetzales(x, lang, { compacto: true });
  const pct = (x: number) => fmtPorcentaje(x, lang);
  const visitasTxt = (x: number) => rellenar(t(x === 1 ? 'stats.unit.visitOne' : 'stats.unit.visits'), { n: n(x) });

  const frente = t('stats.vsPrev');
  const sinBase = t('stats.noPrev');

  const hallazgos = useMemo(() => (datos ? calcularHallazgos(datos, t, lang) : []),
    // `t` cambia en cada render; el idioma es la dependencia real.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [datos, lang]);

  const diasCortos = t('stats.days.short').split(',');
  const diasLargos = t('stats.days.long').split(',');
  const verTabla = { verTabla: t('stats.chart.viewTable'), verGrafico: t('stats.chart.viewChart') };

  const d = datos;
  const refrescando = cargando && !!d;

  return (
    <div className="sg-page">
      <div className="sg-page-inner space-y-6">
        <header className="sg-panel-heading">
          <div>
            <h1 className="text-2xl font-bold text-gray-50 sm:text-3xl">{t('stats.title')}</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-400">{t('stats.subtitle')}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIntento(i => i + 1)}
            loading={cargando}
            icon={<Icono d={ICON.refrescar} size={14} />}
          >
            {cargando ? t('stats.updating') : t('stats.refresh')}
          </Button>
        </header>

        {/* ── Filtro de periodo: una sola fila, gobierna todo lo de abajo ── */}
        <div className="sg-card space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="group"
              aria-label={t('stats.period.label')}
              className="grid w-full grid-cols-3 gap-1 rounded-xl bg-gray-500/10 p-1 sm:inline-flex sm:w-auto"
            >
              {PRESETS.map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => elegirPreset(p)}
                  aria-pressed={preset === p}
                  className={cx(
                    'h-9 whitespace-nowrap rounded-lg px-1.5 text-xs font-semibold transition-colors sm:px-3 sm:text-sm',
                    preset === p
                      ? 'bg-brand-500 text-brand-ink shadow-sm'
                      : 'text-gray-300 hover:bg-gray-500/10 hover:text-gray-50',
                  )}
                >
                  {t(`stats.period.${p}`)}
                </button>
              ))}
            </div>
            {d && (
              <p className="text-sm text-gray-400">
                <span className="font-semibold text-gray-100">{fmtRango(d.periodo.desde, d.periodo.hasta, lang)}</span>
                <span className="mx-1.5" aria-hidden="true">·</span>
                {rellenar(t('stats.period.compared'), { rango: fmtRango(d.periodo.anterior.desde, d.periodo.anterior.hasta, lang) })}
              </p>
            )}
          </div>

          {preset === 'custom' && (
            <form onSubmit={aplicarPersonalizado} className="flex flex-wrap items-end gap-3 border-t border-[rgb(var(--c-hairline))] pt-4">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-400">{t('reports.from')}</span>
                <input type="date" value={borrador.desde} max={borrador.hasta || undefined}
                       onChange={e => setBorrador(b => ({ ...b, desde: e.target.value }))} className="sg-input w-44" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-400">{t('reports.until')}</span>
                <input type="date" value={borrador.hasta} min={borrador.desde || undefined}
                       onChange={e => setBorrador(b => ({ ...b, hasta: e.target.value }))} className="sg-input w-44" />
              </label>
              <Button type="submit" disabled={!!errorRango}>{t('stats.period.apply')}</Button>
              {errorRango && (
                <p role="alert" className="basis-full text-sm text-warning-400">{t(`stats.period.error.${errorRango}`)}</p>
              )}
            </form>
          )}
        </div>

        {errorKey && !d ? (
          <div className="sg-card">
            <ErrorState
              title={t(errorKey)}
              description={t('stats.errorHint')}
              action={<Button onClick={() => setIntento(i => i + 1)}>{t('stats.retry')}</Button>}
            />
          </div>
        ) : !d ? (
          <EsqueletoPagina />
        ) : (
          // Al cambiar de periodo el marco se queda (atenuado) mientras llegan los
          // datos nuevos: sin saltos de layout ni destellos de esqueleto.
          <div className={cx('space-y-8 transition-opacity duration-200', refrescando && 'pointer-events-none opacity-60')} aria-busy={refrescando}>
            {errorKey && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-400">
                <span>{t(errorKey)}</span>
                <Button variant="secondary" size="sm" onClick={() => setIntento(i => i + 1)}>{t('stats.retry')}</Button>
              </div>
            )}

            {/* ── Cifras del periodo: cuatro, no más. Una manda (con su gráfico) y tres se comparan. ── */}
            <ResumenCifras
              ariaLabel={t('stats.summary')}
              principal={{
                etiqueta: t('stats.lead.visits'),
                valor: n(d.accesos.total),
                comparacion: comparar(d.accesos.total, d.accesos.total_anterior, { formato: n, bueno: null, frente, sinBase, lang }),
                grafico: <GraficoVisitas d={d} lang={lang} t={t} />,
              }}
              filas={[
                {
                  id: 'recaudado',
                  etiqueta: t('stats.kpi.collected'),
                  valor: q(d.pagos.recaudado),
                  barra: {
                    tipo: 'comparada', valor: d.pagos.recaudado, anterior: d.pagos.recaudado_anterior,
                    etiqueta: `${q(d.pagos.recaudado)} · ${t('stats.chart.previous')}: ${q(d.pagos.recaudado_anterior)}`,
                  },
                  comparacion: comparar(d.pagos.recaudado, d.pagos.recaudado_anterior, { formato: q, bueno: 'sube', frente, sinBase, lang }),
                },
                {
                  id: 'pendientes',
                  etiqueta: t('stats.kpi.pending'),
                  valor: n(d.pagos.por_estado.pendiente.cantidad),
                  nota: d.pagos.por_estado.pendiente.cantidad
                    ? rellenar(t('stats.kpi.pendingNote'), { monto: q(d.pagos.por_estado.pendiente.monto) })
                    : t('stats.kpi.pendingNone'),
                  atencion: d.pagos.por_estado.pendiente.cantidad > 0 ? 'warning' : undefined,
                  accion: onNavigate && d.pagos.por_estado.pendiente.cantidad > 0
                    ? { texto: t('stats.kpi.verify'), onClick: () => onNavigate('verificacion') }
                    : undefined,
                },
                {
                  id: 'al-dia',
                  etiqueta: t('stats.kpi.upToDate'),
                  valor: d.cartera.residentes ? pct(d.cartera.al_dia / d.cartera.residentes) : '—',
                  barra: {
                    tipo: 'proporcion',
                    fraccion: d.cartera.residentes ? d.cartera.al_dia / d.cartera.residentes : 0,
                    tono: d.cartera.mora / Math.max(1, d.cartera.residentes) > 0.2 ? 'warning' : 'success',
                    etiqueta: t('stats.kpi.upToDate'),
                  },
                  nota: rellenar(t('stats.kpi.upToDateNote'), { al_dia: n(d.cartera.al_dia), total: n(d.cartera.residentes), mora: n(d.cartera.mora) }),
                },
              ]}
            />

            {/* ── Lo más importante ── */}
            <section className="sg-card p-5 sm:p-6" aria-labelledby="stats-hallazgos">
              <h2 id="stats-hallazgos" className="text-base font-semibold tracking-tight text-gray-50">{t('stats.insights.title')}</h2>
              <p className="mt-0.5 text-sm text-gray-400">{t('stats.insights.subtitle')}</p>
              <ul className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2">
                {hallazgos.map(h => (
                  <li key={h.id} className="flex items-start gap-2.5">
                    <Icono d={TONO_HALLAZGO[h.tono].icono} size={16} className={cx('mt-[3px] shrink-0', TONO_HALLAZGO[h.tono].color)} />
                    <p className="text-sm leading-relaxed text-gray-200">{h.texto}</p>
                  </li>
                ))}
              </ul>
            </section>

            {/* ── Accesos ── */}
            <Seccion id="stats-accesos" titulo={t('stats.section.access')} pista={t('stats.section.accessHint')}>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <ChartCard
                  className="xl:col-span-2"
                  titulo={t('stats.chart.heatTitle')}
                  descripcion={t('stats.chart.heatDesc')}
                  etiquetas={verTabla}
                  tabla={
                    <TablaDatos
                      caption={t('stats.chart.heatTitle')}
                      columnas={[t('stats.table.day'), t('stats.table.night0'), t('stats.table.morning'), t('stats.table.afternoon'), t('stats.table.evening'), t('stats.table.total')]}
                      numericas={[1, 2, 3, 4, 5]}
                      filas={d.accesos.por_franja.map((fila, i) => {
                        const tramo = (a: number) => fila.slice(a, a + 6).reduce((x, y) => x + y, 0);
                        return [diasLargos[i], n(tramo(0)), n(tramo(6)), n(tramo(12)), n(tramo(18)), n(fila.reduce((x, y) => x + y, 0))];
                      })}
                    />
                  }
                >
                  <Heatmap
                    matriz={d.accesos.por_franja}
                    dias={diasCortos}
                    diasLargos={diasLargos}
                    formatoValor={visitasTxt}
                    etiquetas={{ menos: t('stats.heat.less'), mas: t('stats.heat.more'), sinMovimiento: t('stats.heat.none') }}
                    ariaLabel={`${t('stats.chart.heatTitle')}. ${t('stats.chart.keyboardHint')}`}
                  />
                </ChartCard>

                <ChartCard
                  titulo={t('stats.chart.topHouses')}
                  descripcion={t('stats.chart.topHousesDesc')}
                >
                  {d.accesos.top_casas.length ? (
                    <BarList
                      items={d.accesos.top_casas.map(c => ({ id: c.numero_casa, etiqueta: `${t('dashboard.unit')} ${c.numero_casa}`, valor: c.total }))}
                      formato={n}
                    />
                  ) : (
                    <p className="py-8 text-center text-sm text-gray-400">{t('stats.chart.empty')}</p>
                  )}
                </ChartCard>
              </div>

              <section className="sg-card" aria-labelledby="stats-perfil">
                <header className="px-5 pt-5">
                  <h3 id="stats-perfil" className="text-base font-bold tracking-tight text-gray-50">{t('stats.chart.profileTitle')}</h3>
                  <p className="mt-0.5 text-sm text-gray-400">{t('stats.chart.profileDesc')}</p>
                </header>
                <dl className="mt-2 grid grid-cols-1 divide-y divide-[rgb(var(--c-hairline))] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5 lg:divide-x">
                  <Celda etiqueta={t('stats.profile.unique')} valor={n(d.accesos.visitantes_unicos)}
                         nota={d.accesos.total ? rellenar(t('stats.profile.uniqueNote'), { n: fmtNumero(d.accesos.total / Math.max(1, d.accesos.visitantes_unicos), lang) }) : undefined} />
                  <Celda etiqueta={t('stats.profile.vehicle')} valor={d.accesos.total ? pct(d.accesos.con_vehiculo / d.accesos.total) : '—'}
                         nota={rellenar(t('stats.profile.vehicleNote'), { n: n(d.accesos.con_vehiculo) })}>
                    <Medidor fraccion={d.accesos.total ? d.accesos.con_vehiculo / d.accesos.total : 0} tono="series" etiqueta={t('stats.profile.vehicle')} />
                  </Celda>
                  <Celda etiqueta={t('stats.profile.duration')} valor={d.accesos.duracion_mediana_min == null ? '—' : fmtDuracion(d.accesos.duracion_mediana_min)}
                         nota={t('stats.profile.durationNote')} />
                  <Celda etiqueta={t('stats.profile.openExits')} valor={n(d.accesos.sin_salida)}
                         atencion={d.accesos.sin_salida > 0 ? 'warning' : undefined} nota={t('stats.profile.openExitsNote')} />
                  <Celda etiqueta={t('stats.profile.unauthorized')} valor={n(d.accesos.no_autorizados)}
                         atencion={d.accesos.no_autorizados > 0 ? 'danger' : undefined} />
                </dl>
              </section>
            </Seccion>

            {/* ── Finanzas ── */}
            <Seccion id="stats-finanzas" titulo={t('stats.section.finance')} pista={t('stats.section.financeHint')}>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <ChartCard
                  className="xl:col-span-2"
                  titulo={t('stats.chart.collectedTitle')}
                  descripcion={t('stats.chart.collectedDesc')}
                  etiquetas={verTabla}
                  tabla={
                    <TablaDatos
                      caption={t('stats.chart.collectedTitle')}
                      columnas={[t('stats.table.date'), t('stats.chart.collected')]}
                      numericas={[1]}
                      filas={d.pagos.por_dia.map(p => [fmtFechaCorta(p.fecha, lang), q(p.monto)])}
                    />
                  }
                >
                  <TimeSeriesChart
                    variante="columnas"
                    datos={d.pagos.por_dia.map(p => ({ fecha: p.fecha, valor: p.monto }))}
                    lang={lang}
                    formatoValor={q}
                    formatoEje={qEje}
                    etiquetas={{ actual: t('stats.chart.collected'), maximo: t('stats.chart.peak'), vacio: t('stats.chart.emptyPayments') }}
                    ariaLabel={`${t('stats.chart.collectedTitle')}. ${t('stats.chart.keyboardHint')}`}
                  />
                </ChartCard>

                <ChartCard titulo={t('stats.chart.paymentsTitle')} descripcion={t('stats.chart.paymentsDesc')}>
                  <SegmentedBar
                    lang={lang}
                    formato={n}
                    ariaLabel={t('stats.chart.paymentsTitle')}
                    vacio={t('stats.chart.emptyPayments')}
                    segmentos={[
                      { id: 'aprobado',  etiqueta: t('stats.pay.aprobado'),  valor: d.pagos.por_estado.aprobado.cantidad,  color: 'bg-success-500', detalle: q(d.pagos.por_estado.aprobado.monto) },
                      { id: 'pendiente', etiqueta: t('stats.pay.pendiente'), valor: d.pagos.por_estado.pendiente.cantidad, color: 'bg-warning-500', detalle: q(d.pagos.por_estado.pendiente.monto) },
                      { id: 'rechazado', etiqueta: t('stats.pay.rechazado'), valor: d.pagos.por_estado.rechazado.cantidad, color: 'bg-danger-500',  detalle: q(d.pagos.por_estado.rechazado.monto) },
                    ]}
                  />
                  <div className="mt-6 border-t border-[rgb(var(--c-hairline))] pt-5">
                    <Subtitulo>{t('stats.chart.methodsTitle')}</Subtitulo>
                    {d.pagos.por_metodo.length ? (
                      <BarList
                        items={d.pagos.por_metodo.map(m => ({ id: m.metodo, etiqueta: t(`stats.method.${m.metodo}`, m.metodo), valor: m.monto }))}
                        formato={q}
                      />
                    ) : (
                      <p className="text-sm text-gray-400">{t('stats.chart.emptyPayments')}</p>
                    )}
                  </div>
                </ChartCard>
              </div>

              <ChartCard titulo={t('stats.chart.portfolioTitle')} descripcion={t('stats.chart.portfolioDesc')}>
                <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
                  <SegmentedBar
                    lang={lang}
                    formato={n}
                    ariaLabel={t('stats.chart.portfolioTitle')}
                    vacio={t('stats.chart.emptyResidents')}
                    segmentos={[
                      { id: 'al_dia',    etiqueta: t('stats.portfolio.al_dia'),    valor: d.cartera.al_dia,    color: 'bg-success-500' },
                      { id: 'pendiente', etiqueta: t('stats.portfolio.pendiente'), valor: d.cartera.pendiente, color: 'bg-warning-500' },
                      { id: 'mora',      etiqueta: t('stats.portfolio.mora'),      valor: d.cartera.mora,      color: 'bg-danger-500' },
                    ]}
                  />
                  <div className="border-t border-[rgb(var(--c-hairline))] pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                    <p className="text-sm text-gray-400">{t('stats.portfolio.balance')}</p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-50">{q(d.cartera.saldo_pendiente)}</p>
                    <p className="mt-1 text-xs text-gray-400">{t('stats.portfolio.balanceNote')}</p>
                  </div>
                </div>
              </ChartCard>
            </Seccion>

            {/* ── Comunidad ── */}
            <Seccion id="stats-comunidad" titulo={t('stats.section.community')} pista={t('stats.section.communityHint')}>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ChartCard titulo={t('stats.chart.ticketsTitle')} descripcion={t('stats.chart.ticketsDesc')}>
                  <p className="mb-4 text-sm text-gray-300">
                    <span className="font-semibold text-gray-50">
                      {rellenar(t('stats.kpi.ticketsNote'), { cerradas: n(d.solicitudes.por_estado.cerrado), total: n(d.solicitudes.total) })}
                    </span>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    {rellenar(t('stats.kpi.ticketsOpen'), { n: n(d.solicitudes.por_estado.abierto) })}
                  </p>
                  <SegmentedBar
                    lang={lang}
                    formato={n}
                    ariaLabel={t('stats.chart.ticketsTitle')}
                    vacio={t('stats.chart.emptyTickets')}
                    segmentos={[
                      { id: 'abierto',    etiqueta: t('stats.ticket.abierto'),    valor: d.solicitudes.por_estado.abierto,    color: 'bg-viz-ord-1' },
                      { id: 'en_proceso', etiqueta: t('stats.ticket.en_proceso'), valor: d.solicitudes.por_estado.en_proceso, color: 'bg-viz-ord-2' },
                      { id: 'cerrado',    etiqueta: t('stats.ticket.cerrado'),    valor: d.solicitudes.por_estado.cerrado,    color: 'bg-viz-ord-3' },
                    ]}
                  />
                  {d.solicitudes.por_tipo.length > 0 && (
                    <div className="mt-6 border-t border-[rgb(var(--c-hairline))] pt-5">
                      <Subtitulo>{t('stats.ticket.byType')}</Subtitulo>
                      <BarList
                        items={d.solicitudes.por_tipo.map(x => ({ id: x.tipo, etiqueta: t(`stats.ticketType.${x.tipo}`, x.tipo), valor: x.total }))}
                        formato={n}
                      />
                    </div>
                  )}
                </ChartCard>

                <ChartCard titulo={t('stats.chart.bookingsTitle')} descripcion={t('stats.chart.bookingsDesc')}>
                  <dl className="divide-y divide-[rgb(var(--c-hairline))]">
                    {[
                      { k: 'effective', v: d.reservas.por_estado.confirmada + d.reservas.por_estado.completada },
                      { k: 'pending',   v: d.reservas.por_estado.pendiente_aprobacion },
                      { k: 'cancelled', v: d.reservas.por_estado.cancelada + d.reservas.por_estado.rechazada },
                      { k: 'charges',   v: d.reservas.cargos, dinero: true },
                    ].map(x => (
                      <div key={x.k} className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0">
                        <dt className="text-sm text-gray-300">{t(`stats.booking.${x.k}`)}</dt>
                        <dd className="text-base font-semibold tabular-nums text-gray-50">{x.dinero ? q(x.v) : n(x.v)}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-6 border-t border-[rgb(var(--c-hairline))] pt-5">
                    <Subtitulo>{t('stats.booking.topAreas')}</Subtitulo>
                    {d.reservas.top_areas.length ? (
                      <BarList items={d.reservas.top_areas.map(a => ({ id: a.area, etiqueta: a.area, valor: a.total }))} formato={n} />
                    ) : (
                      <p className="text-sm text-gray-400">{t('stats.chart.emptyBookings')}</p>
                    )}
                  </div>
                </ChartCard>
              </div>
            </Seccion>

            {/* ── Exportar ── */}
            <Seccion id="stats-exportar" titulo={t('stats.section.export')} pista={t('stats.section.exportHint')}>
              <div className="sg-card p-5">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {(['accesos', 'pagos'] as const).map(tipo => (
                    <div key={tipo} className="flex items-center gap-4 rounded-xl border border-[rgb(var(--c-hairline))] p-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-gray-50">{t(`stats.export.${tipo}`)}</p>
                        <p className="text-xs text-gray-400">{t(`stats.export.${tipo}Desc`)}</p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => descargar(tipo)}
                        disabled={descargando !== null}
                        loading={descargando === tipo}
                        icon={<Icono d={ICON.exportar} size={14} />}
                        aria-label={`${t('common.download')}: ${t(`stats.export.${tipo}`)}`}
                      >
                        {descargando === tipo ? t('common.downloading') : 'CSV'}
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="mt-4 flex items-start gap-2 text-xs text-gray-400">
                  <Icono d={ICON.candado} size={14} className="mt-px shrink-0" />
                  {rellenar(t('stats.export.privacy'), { rango: fmtRango(rango.desde, rango.hasta, lang) })}
                </p>
              </div>
            </Seccion>
          </div>
        )}
      </div>
    </div>
  );
}
