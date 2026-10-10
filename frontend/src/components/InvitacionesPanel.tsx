/**
 * Invitaciones administrativas: el owner invita administradores de empresa,
 * el admin de empresa invita administradores de sucursal. Un solo panel para
 * ambos porque la mecánica es la misma; `modo` fija a quién se invita y qué
 * selector aparece en el modal.
 *
 * Nada de esto toca las licencias de la app de garita: eso vincula
 * máquinas por huella de hardware; esto invita personas por correo.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  crearInvitacion, getInvitaciones, reenviarInvitacion, revocarInvitacion,
  type Empresa, type Invitacion, type InvitacionEstado, type InvitacionInput, type Sucursal,
} from '../services/api';
import {
  Badge, Button, DataTable, EmptyState, Input, Modal, RowActions, ROW_ICON, Select, useToast,
  type BadgeTone, type Column, type RowAction,
} from './ui';
import { useTranslation } from '../i18n/useTranslation';
import { formatearFechaHoraCorta } from '../utils/fecha';

export type InvitacionesModo = 'owner' | 'admin_empresa';

interface Props {
  modo: InvitacionesModo;
  /** Owner: empresas existentes a las que se puede sumar un admin. */
  empresas?: Empresa[];
  /** Admin de empresa: sucursales de SU empresa (el backend vuelve a validar). */
  sucursales?: Sucursal[];
}

// pendiente = amarillo, aceptada = verde, expirada/revocada = gris.
const TONO: Record<InvitacionEstado, BadgeTone> = {
  pendiente: 'warning', aceptada: 'success', expirada: 'neutral', revocada: 'neutral',
};

type EmpresaMode = 'new' | 'existing';

const ICON_MAIL = 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6';
const ICON_SEND = 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z';

const fecha = (iso: string, lang: string) =>
  formatearFechaHoraCorta(iso, lang === 'en' ? 'en' : 'es');

export default function InvitacionesPanel({ modo, empresas = [], sucursales = [] }: Props) {
  const { t, language } = useTranslation();
  const showToast = useToast();

  const [invitaciones, setInvitaciones] = useState<Invitacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [empresaMode, setEmpresaMode] = useState<EmpresaMode>('new');
  const [empresaId, setEmpresaId] = useState('');
  const [empresaNombre, setEmpresaNombre] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** Última invitación creada/reenviada: se ofrece el enlace para copiar. */
  const [ultima, setUltima] = useState<Invitacion | null>(null);

  // Sin `t` en las dependencias: se recrea en cada render y dispararía el
  // fetch en bucle. El texto del error se traduce al pintarlo.
  const cargar = useCallback(() => {
    setLoading(true);
    setError(false);
    getInvitaciones()
      .then(setInvitaciones)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const abrir = () => {
    setEmail(''); setEmpresaMode('new'); setEmpresaId(''); setEmpresaNombre(''); setSucursalId('');
    setFormError(null); setUltima(null); setOpen(true);
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const input: InvitacionInput = modo === 'owner'
      ? { email, rol_invitado: 'admin_empresa', ...(empresaMode === 'existing' ? { empresa_id: empresaId } : { empresa_nombre: empresaNombre.trim() }) }
      : { email, rol_invitado: 'admin_sucursal', sucursal_id: sucursalId };
    if (modo === 'owner' && empresaMode === 'existing' && !empresaId) { setFormError(t('inv.selectEmpresa')); return; }
    if (modo === 'admin_empresa' && !sucursalId) { setFormError(t('inv.selectSucursal')); return; }
    setSaving(true);
    try {
      const inv = await crearInvitacion(input);
      setUltima(inv);
      showToast(t('inv.sent').replace('{email}', inv.email), 'success');
      cargar();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  const copiar = async (enlace: string) => {
    try {
      await navigator.clipboard.writeText(enlace);
      showToast(t('inv.linkCopied'), 'info');
    } catch {
      window.prompt(t('inv.copyLink'), enlace);
    }
  };

  const revocar = async (inv: Invitacion) => {
    if (!window.confirm(`${t('inv.confirmRevoke')} ${inv.email}?`)) return;
    try {
      await revocarInvitacion(inv.id);
      showToast(t('inv.revoked'), 'warning');
      cargar();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error', 'error');
    }
  };

  const reenviar = async (inv: Invitacion) => {
    try {
      const r = await reenviarInvitacion(inv.id);
      showToast(t('inv.resent'), 'success');
      if (r.enlace) { setUltima(r); setOpen(true); }
      cargar();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error', 'error');
    }
  };

  const alcance = (inv: Invitacion) =>
    inv.rol_invitado === 'admin_sucursal'
      ? `${inv.sucursal_nombre ?? '—'} · ${inv.empresa_nombre ?? ''}`
      : `${inv.empresa_nombre ?? '—'}${inv.crea_empresa ? ` · ${t('inv.newCompany')}` : ''}`;

  const columns = useMemo<Column<Invitacion>[]>(() => [
    { key: 'email', header: t('inv.col.email'), primary: true, cell: inv => <span className="font-medium text-gray-100">{inv.email}</span> },
    { key: 'alcance', header: t('inv.col.scope'), cell: inv => <span className="text-gray-300">{alcance(inv)}</span> },
    { key: 'estado', header: t('inv.col.status'), cell: inv => <Badge tone={TONO[inv.estado]} dot={inv.estado === 'pendiente'}>{t(`inv.status.${inv.estado}`)}</Badge> },
    { key: 'vence', header: t('inv.col.expires'), hideOnMobile: true, cell: inv => <span className="text-gray-400 tabular-nums">{fecha(inv.expira_en, language)}</span> },
    {
      key: 'acciones', header: '', actions: true, align: 'right',
      cell: inv => {
        const acciones: RowAction[] = [];
        if (inv.estado === 'pendiente' || inv.estado === 'expirada') {
          acciones.push({ id: 'reenviar', label: t('inv.action.resend'), icon: ICON_SEND, onClick: () => void reenviar(inv) });
        }
        if (inv.estado === 'pendiente') {
          acciones.push({ id: 'revocar', label: t('inv.action.revoke'), icon: ROW_ICON.trash, tone: 'danger', onClick: () => void revocar(inv) });
        }
        return acciones.length ? <RowActions align="end" menuLabel={`${t('common.actions')}: ${inv.email}`} actions={acciones} /> : null;
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, language]);

  const esOwner = modo === 'owner';

  return (
    <section className="space-y-4" aria-label={t(esOwner ? 'inv.owner.title' : 'inv.ae.title')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="sg-section-title">{t(esOwner ? 'inv.owner.title' : 'inv.ae.title')}</h2>
          <p className="mt-1 text-sm text-gray-400">{t(esOwner ? 'inv.owner.desc' : 'inv.ae.desc')}</p>
        </div>
        <Button onClick={abrir}>{t(esOwner ? 'inv.owner.invite' : 'inv.ae.invite')}</Button>
      </div>

      {error && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{t('inv.loadError')}</p>}

      <DataTable
        columns={columns}
        rows={invitaciones}
        rowKey={inv => inv.id}
        loading={loading}
        caption={t(esOwner ? 'inv.owner.title' : 'inv.ae.title')}
        empty={<EmptyState compact icon={ICON_MAIL} title={t('inv.empty.title')} description={t('inv.empty.desc')} />}
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t(esOwner ? 'inv.modal.ownerTitle' : 'inv.modal.aeTitle')}
        footer={ultima ? (
          <Button onClick={() => setOpen(false)}>{t('common.close', 'Cerrar')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" form="form-invitacion" loading={saving}>{t('inv.send')}</Button>
          </>
        )}
      >
        {ultima ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-200">{t('inv.sent').replace('{email}', ultima.email)}</p>
            {ultima.enlace && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">{t('inv.linkHint')}</p>
                <div className="flex gap-2">
                  <Input readOnly value={ultima.enlace} className="font-mono text-xs" wrapperClassName="flex-1" aria-label="Enlace" onFocus={e => e.currentTarget.select()} />
                  <Button variant="secondary" onClick={() => void copiar(ultima.enlace!)}>{t('inv.copyLink')}</Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <form id="form-invitacion" onSubmit={enviar} className="space-y-4">
            {formError && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{formError}</p>}
            <Input type="email" label={t('inv.field.email')} icon={ICON_MAIL} required autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder="nombre@empresa.com" />

            {esOwner ? (
              <>
                <div className="flex gap-1 rounded-lg bg-gray-500/10 p-1" role="tablist">
                  {(['new', 'existing'] as EmpresaMode[]).map(m => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={empresaMode === m}
                      onClick={() => setEmpresaMode(m)}
                      className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${empresaMode === m ? 'bg-brand-500 text-brand-ink' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                      {t(m === 'new' ? 'inv.empresaMode.new' : 'inv.empresaMode.existing')}
                    </button>
                  ))}
                </div>
                {empresaMode === 'new' ? (
                  <Input label={t('inv.field.empresaNueva')} required minLength={2} maxLength={150} value={empresaNombre} onChange={e => setEmpresaNombre(e.target.value)} />
                ) : (
                  <Select label={t('inv.field.empresa')} required value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
                    <option value="">{t('inv.selectEmpresa')}</option>
                    {empresas.filter(e => e.activo).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                  </Select>
                )}
              </>
            ) : (
              <Select label={t('inv.field.sucursal')} required value={sucursalId} onChange={e => setSucursalId(e.target.value)}>
                <option value="">{t('inv.selectSucursal')}</option>
                {sucursales.filter(s => s.activo).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </Select>
            )}
          </form>
        )}
      </Modal>
    </section>
  );
}
