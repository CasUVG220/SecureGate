/**
 * «Planes y cobros» (owner): todas las empresas con su plan, estado y consumo del mes; las facturas por cobrar; cambio de plan y registro de pagos.
 *
 * Aquí se confirma el cobro a mano (transferencia o depósito): el sistema no suspende a nadie por una factura vencida, eso lo decide una persona.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  anularFacturaSaas, cambiarSuscripcion, generarFacturasSaas, getFacturasSaas, getPlanesSaas, getUsoOwner, pagarFacturaSaas, revisarVencidasSaas,
  type EstadoSuscripcion, type FacturaSaas, type MetodoPagoSaas, type PlanSaas, type UsoEmpresaOwner,
} from '../../services/api';
import {
  Badge, Button, Card, DataTable, EmptyState, Input, Modal, RowActions, Select, StatusText, useConfirmacion, useToast, type Column, type RowAction,
} from '../../components/ui';
import { useTranslation } from '../../i18n/useTranslation';
import { formatearDia } from '../../utils/fecha';
import { fmtCentavos, nombreDelMes, TONO_FACTURA, TONO_SUSCRIPCION } from '../../utils/saas';

const ICON_EDIT = 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z';
const ICON_CHECK = 'M20 6L9 17l-5-5';
const ICON_BLOCK = 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.93 4.93l14.14 14.14';
const ESTADOS: EstadoSuscripcion[] = ['prueba', 'activa', 'vencida', 'cancelada'];
const METODOS: MetodoPagoSaas[] = ['transferencia', 'deposito', 'efectivo', 'otro'];

type Dialogo =
  | { tipo: 'plan'; empresa: UsoEmpresaOwner }
  | { tipo: 'pago'; factura: FacturaSaas }
  | { tipo: 'anular'; factura: FacturaSaas }
  | null;

export default function SaasPage() {
  const { t, language } = useTranslation();
  const showToast = useToast();
  const { confirmar, dialogo } = useConfirmacion();

  const [periodo, setPeriodo] = useState('');
  const [empresas, setEmpresas] = useState<UsoEmpresaOwner[]>([]);
  const [facturas, setFacturas] = useState<FacturaSaas[]>([]);
  const [planes, setPlanes] = useState<PlanSaas[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<'generar' | 'revisar' | null>(null);

  const [abierto, setAbierto] = useState<Dialogo>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Campos de los diálogos.
  const [planCodigo, setPlanCodigo] = useState('');
  const [estado, setEstado] = useState<EstadoSuscripcion>('activa');
  const [motivo, setMotivo] = useState('');
  const [metodo, setMetodo] = useState<MetodoPagoSaas>('transferencia');
  const [referencia, setReferencia] = useState('');
  const [nota, setNota] = useState('');

  const cargar = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([getUsoOwner(), getFacturasSaas({ estado: 'pendiente' }), getFacturasSaas({ estado: 'vencida' })])
      .then(([uso, pendientes, vencidas]) => {
        setPeriodo(uso.periodo);
        setEmpresas(uso.empresas);
        setFacturas([...vencidas, ...pendientes]);
      })
      .catch(e => setError(e instanceof Error && e.message ? e.message : ''))
      .finally(() => setLoading(false));
  }, []);                                           // `t` cambia en cada render: no va en las dependencias
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { getPlanesSaas().then(setPlanes).catch(() => {}); }, []);

  const cerrar = () => { if (!saving) setAbierto(null); };

  const abrirPlan = (e: UsoEmpresaOwner) => {
    setPlanCodigo(e.plan ?? planes[0]?.codigo ?? ''); setEstado(e.estado ?? 'activa'); setMotivo(''); setFormError(null); setAbierto({ tipo: 'plan', empresa: e });
  };
  const abrirPago = (f: FacturaSaas) => { setMetodo('transferencia'); setReferencia(''); setNota(''); setFormError(null); setAbierto({ tipo: 'pago', factura: f }); };
  const abrirAnular = (f: FacturaSaas) => { setMotivo(''); setFormError(null); setAbierto({ tipo: 'anular', factura: f }); };

  const ejecutar = async (accion: () => Promise<unknown>, exito: string) => {
    setSaving(true);
    setFormError(null);
    try {
      await accion();
      showToast(exito, 'success');
      setAbierto(null);
      cargar();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const guardarPlan = (ev: FormEvent) => {
    ev.preventDefault();
    if (abierto?.tipo !== 'plan') return;
    if (!planCodigo) { setFormError(t('saas.plan.pick')); return; }
    void ejecutar(() => cambiarSuscripcion(abierto.empresa.empresa_id, { plan_codigo: planCodigo, estado, motivo: motivo.trim() || undefined }), t('saas.plan.saved'));
  };
  const guardarPago = (ev: FormEvent) => {
    ev.preventDefault();
    if (abierto?.tipo !== 'pago') return;
    if ((metodo === 'transferencia' || metodo === 'deposito') && !referencia.trim()) { setFormError(t('saas.pay.needRef')); return; }
    void ejecutar(() => pagarFacturaSaas(abierto.factura.id, { metodo, referencia: referencia.trim() || undefined, nota: nota.trim() || undefined }), t('saas.pay.saved'));
  };
  const guardarAnular = (ev: FormEvent) => {
    ev.preventDefault();
    if (abierto?.tipo !== 'anular') return;
    if (motivo.trim().length < 3) { setFormError(t('saas.void.needReason')); return; }
    void ejecutar(() => anularFacturaSaas(abierto.factura.id, motivo.trim()), t('saas.void.saved'));
  };

  const generar = async () => {
    const ok = await confirmar({ title: t('saas.gen.confirmTitle'), message: t('saas.gen.confirmMsg'), confirmLabel: t('saas.gen.button') });
    if (!ok) return;
    setOcupado('generar');
    try {
      const r = await generarFacturasSaas();
      showToast(t('saas.gen.done').replace('{n}', String(r.generadas)).replace('{periodo}', r.periodo).replace('{ya}', String(r.existentes)), r.errores ? 'warning' : 'success');
      cargar();
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('common.error'), 'error');
    } finally {
      setOcupado(null);
    }
  };
  const revisar = async () => {
    setOcupado('revisar');
    try {
      const r = await revisarVencidasSaas();
      showToast(t('saas.review.done').replace('{n}', String(r.vencidas)), 'success');
      cargar();
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('common.error'), 'error');
    } finally {
      setOcupado(null);
    }
  };

  const colEmpresas = useMemo<Column<UsoEmpresaOwner>[]>(() => [
    {
      key: 'nombre', header: t('saas.col.company'), primary: true,
      cell: e => (
        <div className="min-w-0">
          <p className="truncate font-medium text-gray-100" title={e.nombre}>{e.nombre}</p>
          {e.suspendida && <StatusText kind="bad">{t('saas.suspended')}</StatusText>}
        </div>
      ),
    },
    { key: 'plan', header: t('saas.col.plan'), cell: e => e.plan_nombre ?? <span className="text-gray-500">{t('saas.noPlan')}</span> },
    { key: 'estado', header: t('saas.col.status'), cell: e => e.estado ? <Badge tone={TONO_SUSCRIPCION[e.estado]} dot>{t(`plan.status.${e.estado}`)}</Badge> : '—' },
    {
      key: 'uso', header: t('saas.col.usage'), align: 'right',
      cell: e => <span className="tabular-nums">{e.visitas}{e.incluidas !== null && <span className="text-gray-400"> / {e.incluidas}</span>}</span>,
    },
    {
      key: 'exc', header: t('saas.col.over'), align: 'right', hideOnMobile: true,
      cell: e => e.excedente > 0 ? <span className="tabular-nums text-warning-400">{fmtCentavos(e.excedente_centavos, language)}</span> : <span className="text-gray-500">—</span>,
    },
    {
      key: 'deuda', header: t('saas.col.owed'), align: 'right',
      cell: e => e.pendiente_centavos > 0
        ? <StatusText kind={e.facturas_vencidas > 0 ? 'bad' : 'warn'}>{fmtCentavos(e.pendiente_centavos, language)}</StatusText>
        : <span className="text-gray-500">—</span>,
    },
    {
      key: 'acciones', header: '', actions: true, align: 'right',
      cell: e => {
        const acciones: RowAction[] = [{ id: 'plan', label: t('saas.changePlan'), icon: ICON_EDIT, onClick: () => abrirPlan(e) }];
        return <RowActions align="end" menuLabel={`${t('common.actions')}: ${e.nombre}`} actions={acciones} />;
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, language, planes]);

  const colFacturas = useMemo<Column<FacturaSaas>[]>(() => [
    { key: 'numero', header: t('plan.inv.number'), primary: true, cell: f => <span className="font-mono text-xs text-gray-200">{f.numero_texto}</span> },
    { key: 'empresa', header: t('saas.col.company'), cell: f => <span className="truncate" title={f.empresa_nombre}>{f.empresa_nombre}</span> },
    { key: 'periodo', header: t('plan.inv.period'), hideOnMobile: true, cell: f => <span className="capitalize">{nombreDelMes(f.periodo, language)}</span> },
    { key: 'total', header: t('plan.inv.total'), align: 'right', cell: f => <span className="font-semibold tabular-nums text-gray-100">{fmtCentavos(f.total_centavos, language)}</span> },
    { key: 'vence', header: t('plan.inv.due'), hideOnMobile: true, cell: f => formatearDia(f.vence_en, language) },
    { key: 'estado', header: t('plan.inv.status'), cell: f => <Badge tone={TONO_FACTURA[f.estado]} dot>{t(`plan.inv.status.${f.estado}`)}</Badge> },
    {
      key: 'acciones', header: '', actions: true, align: 'right',
      cell: f => {
        const acciones: RowAction[] = [
          { id: 'pagar', label: t('saas.markPaid'), icon: ICON_CHECK, onClick: () => abrirPago(f) },
          { id: 'anular', label: t('saas.void'), icon: ICON_BLOCK, tone: 'danger', onClick: () => abrirAnular(f) },
        ];
        return <RowActions align="end" menuLabel={`${t('common.actions')}: ${f.numero_texto}`} actions={acciones} />;
      },
    },
  ], [t, language]);

  const deuda = facturas.reduce((a, f) => a + f.total_centavos, 0);

  return (
    <div className="sg-page text-gray-100">
      <div className="sg-panel-heading">
        <div>
          <p className="sg-eyebrow">SecureGate · {t('saas.eyebrow')}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">{t('saas.title')}</h1>
          <p className="mt-1 text-sm text-gray-400">{t('saas.desc')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={revisar} loading={ocupado === 'revisar'}>{t('saas.review.button')}</Button>
          <Button onClick={generar} loading={ocupado === 'generar'}>{t('saas.gen.button')}</Button>
        </div>
      </div>

      {error !== null && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{t('saas.loadError')} {error}</p>}

      <Card title={t('saas.companies.title').replace('{mes}', periodo ? nombreDelMes(periodo, language) : '…')} description={t('saas.companies.desc')} padded={false}>
        <DataTable
          bare columns={colEmpresas} rows={empresas} rowKey={e => e.empresa_id} loading={loading} caption={t('saas.companies.title').replace('{mes}', '')}
          empty={<EmptyState compact title={t('saas.companies.empty')} />}
        />
      </Card>

      <Card
        title={t('saas.invoices.title')}
        description={deuda > 0 ? t('saas.invoices.owed').replace('{monto}', fmtCentavos(deuda, language)) : t('saas.invoices.desc')}
        padded={false}
      >
        <DataTable
          bare columns={colFacturas} rows={facturas} rowKey={f => f.id} loading={loading} caption={t('saas.invoices.title')}
          empty={<EmptyState compact title={t('saas.invoices.empty')} description={t('saas.invoices.emptyDesc')} />}
        />
      </Card>

      {/* ── Cambiar plan ── */}
      <Modal
        open={abierto?.tipo === 'plan'} onClose={cerrar} dismissible={!saving} size="md"
        title={abierto?.tipo === 'plan' ? t('saas.plan.title').replace('{empresa}', abierto.empresa.nombre) : undefined}
        footer={<>
          <Button variant="ghost" onClick={cerrar} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="submit" form="form-plan" loading={saving}>{t('common.save')}</Button>
        </>}
      >
        <form id="form-plan" onSubmit={guardarPlan} className="space-y-4">
          <Select label={t('saas.col.plan')} value={planCodigo} onChange={e => setPlanCodigo(e.target.value)}>
            <option value="">{t('saas.plan.pick')}</option>
            {planes.map(p => <option key={p.codigo} value={p.codigo}>{p.nombre} · {fmtCentavos(p.precio_mensual_centavos, language)}</option>)}
          </Select>
          <Select label={t('saas.col.status')} value={estado} onChange={e => setEstado(e.target.value as EstadoSuscripcion)}>
            {ESTADOS.map(s => <option key={s} value={s}>{t(`plan.status.${s}`)}</option>)}
          </Select>
          <Input label={t('saas.reason')} value={motivo} maxLength={300} onChange={e => setMotivo(e.target.value)} hint={t('saas.reason.hint')} />
          {formError && <p role="alert" className="text-sm font-medium text-danger-400">{formError}</p>}
        </form>
      </Modal>

      {/* ── Marcar pagada ── */}
      <Modal
        open={abierto?.tipo === 'pago'} onClose={cerrar} dismissible={!saving} size="md"
        title={abierto?.tipo === 'pago' ? t('saas.pay.title').replace('{numero}', abierto.factura.numero_texto) : undefined}
        description={abierto?.tipo === 'pago' ? `${abierto.factura.empresa_nombre} · ${fmtCentavos(abierto.factura.total_centavos, language)}` : undefined}
        footer={<>
          <Button variant="ghost" onClick={cerrar} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="submit" form="form-pago" loading={saving}>{t('saas.markPaid')}</Button>
        </>}
      >
        <form id="form-pago" onSubmit={guardarPago} className="space-y-4">
          <Select label={t('saas.pay.method')} value={metodo} onChange={e => setMetodo(e.target.value as MetodoPagoSaas)}>
            {METODOS.map(m => <option key={m} value={m}>{t(`saas.pay.method.${m}`)}</option>)}
          </Select>
          <Input label={t('saas.pay.ref')} value={referencia} maxLength={100} onChange={e => setReferencia(e.target.value)}
                 required={metodo === 'transferencia' || metodo === 'deposito'} hint={t('saas.pay.ref.hint')} />
          <Input label={t('saas.pay.note')} value={nota} maxLength={300} onChange={e => setNota(e.target.value)} />
          {formError && <p role="alert" className="text-sm font-medium text-danger-400">{formError}</p>}
        </form>
      </Modal>

      {/* ── Anular ── */}
      <Modal
        open={abierto?.tipo === 'anular'} onClose={cerrar} dismissible={!saving} size="md"
        title={abierto?.tipo === 'anular' ? t('saas.void.title').replace('{numero}', abierto.factura.numero_texto) : undefined}
        description={t('saas.void.desc')}
        footer={<>
          <Button variant="ghost" onClick={cerrar} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="submit" form="form-anular" variant="danger" loading={saving}>{t('saas.void')}</Button>
        </>}
      >
        <form id="form-anular" onSubmit={guardarAnular} className="space-y-4">
          <Input label={t('saas.reason')} value={motivo} maxLength={300} onChange={e => setMotivo(e.target.value)} required />
          {formError && <p role="alert" className="text-sm font-medium text-danger-400">{formError}</p>}
        </form>
      </Modal>

      {dialogo}
    </div>
  );
}
