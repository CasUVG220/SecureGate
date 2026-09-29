/**
 * Garitas: códigos de activación de la app de escritorio.
 *
 * El admin de sucursal emite un código, lo pega en la app Tauri del equipo de
 * garita y ese equipo queda vinculado a la sucursal por su huella de
 * hardware. Desde aquí también se revoca (kill switch: el siguiente
 * heartbeat de la app falla y deja de sincronizar). Owner y admin de empresa
 * ven lo mismo, con selector de sucursal al emitir.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  crearLicencia, decodeTokenPayload, getLicencias, getSucursales, revocarLicencia,
  type Licencia, type Sucursal,
} from '../services/api';
import {
  Badge, Button, DataTable, EmptyState, Input, Modal, RowActions, Select, StatusText, useToast,
  type Column, type RowAction,
} from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';

const ICON_KEY = 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4';
const ICON_COPY = 'M8 4h10a2 2 0 0 1 2 2v10M4 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z';
const ICON_BLOCK = 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.93 4.93l14.14 14.14';

const rolActual = (): string => {
  const token = localStorage.getItem('token');
  return token ? ((decodeTokenPayload(token)?.rol as string) ?? '') : '';
};

/** "hace 3 min" / "hace 2 h" / "hace 5 días". */
function haceCuanto(iso: string | null, lang: string): string {
  if (!iso) return '—';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  const es = lang !== 'en';
  if (min < 1) return es ? 'hace un momento' : 'just now';
  if (min < 60) return es ? `hace ${min} min` : `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return es ? `hace ${h} h` : `${h} h ago`;
  const d = Math.floor(h / 24);
  return es ? `hace ${d} día${d === 1 ? '' : 's'}` : `${d} day${d === 1 ? '' : 's'} ago`;
}

export default function LicenciasPage() {
  const { t, language } = useTranslation();
  const showToast = useToast();
  const rol = useMemo(rolActual, []);
  // El admin de sucursal emite para la suya (la toma el backend del JWT);
  // owner y admin de empresa eligen.
  const eligeSucursal = rol === 'owner' || rol === 'admin_empresa';

  const [licencias, setLicencias] = useState<Licencia[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [open, setOpen] = useState(false);
  const [etiqueta, setEtiqueta] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** Código recién emitido: se muestra en grande para copiarlo a la app. */
  const [emitida, setEmitida] = useState<Licencia | null>(null);

  const cargar = useCallback(() => {
    setLoading(true);
    setError(false);
    getLicencias()
      .then(setLicencias)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (eligeSucursal) getSucursales().then(setSucursales).catch(() => {});
  }, [eligeSucursal]);

  const abrir = () => { setEtiqueta(''); setSucursalId(''); setFormError(null); setEmitida(null); setOpen(true); };

  const emitir = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (eligeSucursal && !sucursalId) { setFormError(t('lic.selectBranch')); return; }
    setSaving(true);
    try {
      const lic = await crearLicencia({ etiqueta: etiqueta.trim() || undefined, ...(eligeSucursal ? { sucursal_id: sucursalId } : {}) });
      setEmitida(lic);
      showToast(t('lic.created'), 'success');
      cargar();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  const copiar = async (codigo: string) => {
    try {
      await navigator.clipboard.writeText(codigo);
      showToast(t('lic.copied'), 'info');
    } catch {
      window.prompt(t('lic.copy'), codigo);
    }
  };

  const revocar = async (lic: Licencia) => {
    if (!window.confirm(`${t('lic.confirmRevoke')} ${lic.etiqueta || lic.codigo_activacion}?`)) return;
    try {
      await revocarLicencia(lic.id);
      showToast(t('lic.revoked'), 'warning');
      cargar();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error', 'error');
    }
  };

  const columns = useMemo<Column<Licencia>[]>(() => {
    const cols: Column<Licencia>[] = [
      {
        key: 'etiqueta', header: t('lic.col.device'), primary: true,
        cell: lic => (
          <div className="min-w-0">
            <p className="truncate font-medium text-gray-100">{lic.etiqueta || t('lic.noLabel')}</p>
            {eligeSucursal && <p className="truncate text-xs text-gray-400">{lic.sucursal_nombre}</p>}
          </div>
        ),
      },
      {
        key: 'codigo', header: t('lic.col.code'),
        cell: lic => <span className="font-mono text-xs tracking-wider text-gray-200">{lic.codigo_activacion}</span>,
      },
      {
        key: 'estado', header: t('lic.col.status'),
        cell: lic => lic.estado === 'revocada'
          ? <StatusText kind="bad">{t('lic.status.revoked')}</StatusText>
          : lic.activada
            ? <StatusText kind="on">{t('lic.status.active')}</StatusText>
            : <Badge tone="warning" dot>{t('lic.status.pending')}</Badge>,
      },
      {
        key: 'heartbeat', header: t('lic.col.lastSeen'), hideOnMobile: true,
        cell: lic => <span className="text-gray-400" title={lic.ultimo_heartbeat ?? ''}>{haceCuanto(lic.ultimo_heartbeat, language)}</span>,
      },
      {
        key: 'acciones', header: '', actions: true, align: 'right',
        cell: lic => {
          const acciones: RowAction[] = [
            { id: 'copiar', label: t('lic.copy'), icon: ICON_COPY, onClick: () => void copiar(lic.codigo_activacion) },
          ];
          if (lic.estado === 'activa') {
            acciones.push({ id: 'revocar', label: t('lic.revoke'), icon: ICON_BLOCK, tone: 'danger', onClick: () => void revocar(lic) });
          }
          return <RowActions align="end" menuLabel={`${t('common.actions')}: ${lic.etiqueta || lic.codigo_activacion}`} actions={acciones} />;
        },
      },
    ];
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, language, eligeSucursal]);

  const activas = licencias.filter(l => l.estado === 'activa' && l.activada).length;
  const pendientes = licencias.filter(l => l.estado === 'activa' && !l.activada).length;

  return (
    <div className="sg-page text-gray-100">
      <div className="sg-panel-heading">
        <div>
          <p className="sg-eyebrow">SecureGate · {t('lic.eyebrow')}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">{t('lic.title')}</h1>
          <p className="mt-1 text-sm text-gray-400">{t('lic.desc')}</p>
        </div>
        {!loading && (
          <div className="flex items-center gap-4 text-sm">
            <StatusText kind="on">{activas} {t('lic.summary.active')}</StatusText>
            {pendientes > 0 && <StatusText kind="warn">{pendientes} {t('lic.summary.pending')}</StatusText>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="sg-section-title">{t('lic.listTitle')}</h2>
        <Button onClick={abrir} icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON_KEY} /></svg>}>
          {t('lic.new')}
        </Button>
      </div>

      {error && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{t('lic.loadError')}</p>}

      <DataTable
        columns={columns}
        rows={licencias}
        rowKey={l => l.id}
        loading={loading}
        caption={t('lic.title')}
        empty={<EmptyState icon={ICON_KEY} title={t('lic.empty.title')} description={t('lic.empty.desc')} action={<Button onClick={abrir}>{t('lic.new')}</Button>} />}
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={emitida ? t('lic.modal.doneTitle') : t('lic.modal.title')}
        description={emitida ? undefined : t('lic.modal.desc')}
        footer={emitida ? (
          <Button onClick={() => setOpen(false)}>{t('common.close')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" form="form-licencia" loading={saving}>{t('lic.generate')}</Button>
          </>
        )}
      >
        {emitida ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-600 bg-gray-500/[0.06] px-5 py-4 text-center">
              <p className="text-2xs font-bold uppercase tracking-widest text-gray-400">{t('lic.col.code')}</p>
              <p className="mt-2 select-all font-mono text-2xl font-semibold tracking-[0.15em] text-gray-50" data-testid="codigo-emitido">{emitida.codigo_activacion}</p>
              {emitida.etiqueta && <p className="mt-2 text-sm text-gray-300">{emitida.etiqueta}</p>}
            </div>
            <Button variant="secondary" fullWidth onClick={() => void copiar(emitida.codigo_activacion)}>{t('lic.copy')}</Button>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-300">
              <li>{t('lic.steps.1')}</li>
              <li>{t('lic.steps.2')}</li>
              <li>{t('lic.steps.3')}</li>
            </ol>
          </div>
        ) : (
          <form id="form-licencia" onSubmit={emitir} className="space-y-4">
            {formError && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{formError}</p>}
            {eligeSucursal && (
              <Select label={t('lic.field.branch')} required value={sucursalId} onChange={e => setSucursalId(e.target.value)}>
                <option value="">{t('lic.selectBranch')}</option>
                {sucursales.filter(s => s.activo).map(s => <option key={s.id} value={s.id}>{s.nombre}{rol === 'owner' ? ` · ${s.empresa_nombre}` : ''}</option>)}
              </Select>
            )}
            <Input
              label={t('lic.field.label')}
              placeholder={t('lic.field.labelPlaceholder')}
              maxLength={100}
              autoFocus
              value={etiqueta}
              onChange={e => setEtiqueta(e.target.value)}
              hint={t('lic.field.labelHint')}
            />
          </form>
        )}
      </Modal>
    </div>
  );
}
