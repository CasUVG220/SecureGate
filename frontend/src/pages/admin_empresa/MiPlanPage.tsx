/**
 * «Mi plan» (administrador de empresa): el plan contratado, el consumo del mes contra lo incluido, la proyección del excedente, los límites,
 * el historial de facturas, los primeros pasos pendientes y la descarga de los datos de la empresa.
 *
 * Todo sale de `GET /empresas/:id/panel`. El dinero llega en centavos enteros y solo se divide entre 100 para mostrarlo (utils/saas).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  crearLicencia, decodeTokenPayload, exportarDatosEmpresa, getPanelEmpresa,
  type FacturaSaas, type PanelEmpresa, type PasoOnboardingId,
} from '../../services/api';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Skeleton, StatusText, useToast, type Column } from '../../components/ui';
import { useTranslation } from '../../i18n/useTranslation';
import { plural } from '../../i18n/plural';
import { formatearDia } from '../../utils/fecha';
import { fmtCentavos, guardarArchivo, nombreDelMes, porcentajeUsado, TONO_FACTURA, TONO_SUSCRIPCION } from '../../utils/saas';

const PASOS: PasoOnboardingId[] = ['empresa', 'sucursal', 'plan', 'admin', 'garita'];

const limite = (usadas: number, maximo: number | null, t: (k: string) => string) =>
  maximo === null ? `${usadas} · ${t('plan.unlimited')}` : `${usadas} / ${maximo}`;

export default function MiPlanPage() {
  const { t, language } = useTranslation();
  const showToast = useToast();
  const empresaId = useMemo(() => {
    const token = localStorage.getItem('token');
    return token ? ((decodeTokenPayload(token)?.empresa_id as string | undefined) ?? '') : '';
  }, []);

  const [panel, setPanel] = useState<PanelEmpresa | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const [creandoGarita, setCreandoGarita] = useState(false);
  /** Código de la garita recién creada: se muestra en grande para pegarlo en la app de escritorio. */
  const [codigoGarita, setCodigoGarita] = useState<string | null>(null);

  const cargar = useCallback(() => {
    if (!empresaId) { setError('—'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    getPanelEmpresa(empresaId)
      .then(setPanel)
      .catch(e => setError(e instanceof Error && e.message ? e.message : '—'))
      .finally(() => setLoading(false));
  }, [empresaId]);                                  // `t` cambia en cada render: no va en las dependencias (se lee al pintar)
  useEffect(() => { cargar(); }, [cargar]);

  const exportar = async () => {
    setExportando(true);
    try {
      const { blob, nombre } = await exportarDatosEmpresa(empresaId);
      guardarArchivo(blob, nombre);
      showToast(t('plan.export.done'), 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('plan.export.error'), 'error');
    } finally {
      setExportando(false);
    }
  };

  const crearGarita = async () => {
    if (!panel?.progreso.primera_sucursal_id) return;
    setCreandoGarita(true);
    try {
      const lic = await crearLicencia({ sucursal_id: panel.progreso.primera_sucursal_id, etiqueta: t('plan.steps.gateLabel') });
      setCodigoGarita(lic.codigo_activacion);
      showToast(t('lic.created'), 'success');
      cargar();
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('plan.loadError'), 'error');
    } finally {
      setCreandoGarita(false);
    }
  };

  const columnas = useMemo<Column<FacturaSaas>[]>(() => [
    { key: 'numero', header: t('plan.inv.number'), primary: true, cell: f => <span className="font-mono text-xs text-gray-200">{f.numero_texto}</span> },
    { key: 'periodo', header: t('plan.inv.period'), cell: f => <span className="capitalize">{nombreDelMes(f.periodo, language)}</span> },
    { key: 'total', header: t('plan.inv.total'), align: 'right', cell: f => <span className="font-semibold tabular-nums text-gray-100">{fmtCentavos(f.total_centavos, language)}</span> },
    { key: 'vence', header: t('plan.inv.due'), hideOnMobile: true, cell: f => formatearDia(f.vence_en, language) },
    { key: 'estado', header: t('plan.inv.status'), cell: f => <Badge tone={TONO_FACTURA[f.estado]} dot>{t(`plan.inv.status.${f.estado}`)}</Badge> },
  ], [t, language]);

  if (loading) return <div className="sg-page" aria-busy="true"><Skeleton height={140} /><div className="mt-4"><Skeleton height={220} /></div></div>;
  if (error || !panel) {
    return <ErrorState title={t('plan.loadError')} detail={error && error !== '—' ? error : undefined} action={<Button onClick={cargar}>{t('error.retry')}</Button>} />;
  }

  const { suscripcion: s, uso, proyeccion, limites, facturas, progreso } = panel;
  const usado = porcentajeUsado(uso.visitas, uso.incluidas);
  const hechos = new Set(progreso.pasos.filter(p => p.hecho).map(p => p.id));

  return (
    <div className="sg-page text-gray-100">
      <div className="sg-panel-heading">
        <div>
          <p className="sg-eyebrow">{panel.empresa.nombre} · {t('plan.eyebrow')}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">{t('plan.title')}</h1>
          <p className="mt-1 text-sm text-gray-400">{t('plan.desc')}</p>
        </div>
      </div>

      {panel.facturas_vencidas > 0 && (
        <p role="alert" className="rounded-lg border border-warning-500/30 bg-warning-500/10 px-4 py-3 text-sm font-medium text-warning-400">
          {plural(t, 'plan.overdue', panel.facturas_vencidas)} {fmtCentavos(panel.pendiente_centavos, language)}. {t('plan.overdue.note')}
        </p>
      )}

      {!progreso.completo && (
        <Card title={t('plan.steps.title')} description={t('plan.steps.desc')}>
          <ol className="space-y-2" aria-label={t('plan.steps.title')}>
            {PASOS.map(id => (
              <li key={id} className="flex items-center gap-3 text-sm">
                <span aria-hidden="true" className={hechos.has(id) ? 'text-success-400' : 'text-gray-500'}>{hechos.has(id) ? '✓' : '○'}</span>
                <span className={hechos.has(id) ? 'text-gray-300' : 'font-semibold text-gray-100'}>{t(`plan.steps.${id}`)}</span>
                <span className="sr-only">{hechos.has(id) ? t('plan.steps.done') : t('plan.steps.todo')}</span>
              </li>
            ))}
          </ol>
          {!hechos.has('garita') && hechos.has('sucursal') && (
            <div className="mt-4">
              <Button onClick={crearGarita} loading={creandoGarita}>{t('plan.steps.createGate')}</Button>
            </div>
          )}
          {codigoGarita && (
            <div className="mt-4 rounded-lg border border-brand-500/30 bg-brand-500/10 p-4" data-testid="codigo-garita">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{t('lic.created')}</p>
              <p className="mt-1 font-mono text-lg tracking-widest text-gray-50">{codigoGarita}</p>
              <p className="mt-2 text-sm text-gray-300">{t('plan.steps.gateHelp')}</p>
            </div>
          )}
        </Card>
      )}

      {!s ? (
        <Card><EmptyState title={t('plan.none.title')} description={t('plan.none.desc')} /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={s.plan.nombre} description={s.plan.descripcion ?? undefined} actions={<Badge tone={TONO_SUSCRIPCION[s.estado]} dot>{t(`plan.status.${s.estado}`)}</Badge>}>
            <p className="text-3xl font-bold tabular-nums text-gray-50">
              {fmtCentavos(s.plan.precio_mensual_centavos, language)}<span className="ml-1 text-sm font-medium text-gray-400">{t('plan.perMonth')}</span>
            </p>
            <ul className="mt-3 space-y-1 text-sm text-gray-300">
              <li>{plural(t, 'plan.includes', s.plan.visitas_incluidas)}</li>
              <li>{t('plan.extra').replace('{precio}', fmtCentavos(s.plan.precio_visita_extra_centavos, language))}</li>
              <li>{t('plan.limits.branches')}: {limite(limites.sucursales.usadas, limites.sucursales.maximo, t)}</li>
              <li>{t('plan.limits.gates')}: {limite(limites.garitas.usadas, limites.garitas.maximo, t)}</li>
            </ul>
            {s.estado === 'prueba' && s.prueba_hasta && (
              <p className="mt-3 text-sm text-brand-400">{t('plan.trialUntil').replace('{fecha}', formatearDia(s.prueba_hasta, language))}</p>
            )}
            {s.plan.supuesto && <p className="mt-3 text-xs text-gray-400">{t('plan.assumed')}</p>}
          </Card>

          <Card title={t('plan.usage.title').replace('{mes}', nombreDelMes(uso.periodo, language))} description={t('plan.usage.desc')}>
            <p className="text-sm text-gray-300">
              <span className="text-3xl font-bold tabular-nums text-gray-50">{uso.visitas}</span>
              {uso.incluidas !== null && <span className="ml-2">{t('plan.usage.of').replace('{n}', String(uso.incluidas))}</span>}
            </p>
            {uso.incluidas !== null && (
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-gray-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usado} aria-label={t('plan.usage.bar')}>
                <div className={`h-full rounded-full ${uso.excedente > 0 ? 'bg-warning-500' : 'bg-brand-500'}`} style={{ width: `${usado}%` }} />
              </div>
            )}
            {uso.excedente > 0 ? (
              <p className="mt-3 text-sm font-semibold text-warning-400">
                {plural(t, 'plan.usage.over', uso.excedente)} · {fmtCentavos(uso.excedente_centavos, language)}
              </p>
            ) : (
              <p className="mt-3 text-sm text-gray-400">{t('plan.usage.within')}</p>
            )}
            {proyeccion && (
              <p className="mt-3 border-t border-gray-700 pt-3 text-sm text-gray-300" data-testid="proyeccion">
                {plural(t, 'plan.forecast', proyeccion.visitas_proyectadas)}{' '}
                {proyeccion.excedente_proyectado > 0
                  ? <span className="font-semibold text-warning-400">{plural(t, 'plan.forecast.over', proyeccion.excedente_proyectado, { monto: fmtCentavos(proyeccion.excedente_proyectado_centavos, language) })}</span>
                  : <StatusText kind="on">{t('plan.forecast.ok')}</StatusText>}
                <span className="mt-1 block text-xs text-gray-400">{t('plan.forecast.note')}</span>
              </p>
            )}
          </Card>
        </div>
      )}

      <Card title={t('plan.inv.title')} description={t('plan.inv.desc')} padded={false}>
        <DataTable
          bare
          columns={columnas}
          rows={facturas}
          rowKey={f => f.id}
          caption={t('plan.inv.title')}
          empty={<EmptyState compact title={t('plan.inv.empty')} description={t('plan.inv.emptyDesc')} />}
        />
      </Card>

      <Card title={t('plan.export.title')} description={t('plan.export.desc')}>
        <p className="mb-3 text-sm text-gray-400">{t('plan.export.warn')}</p>
        <Button variant="secondary" onClick={exportar} loading={exportando}>{t('plan.export.button')}</Button>
      </Card>
    </div>
  );
}
