/**
 * Invitaciones administrativas: el owner invita administradores de empresa,
 * el admin de empresa invita administradores de sucursal. Un solo panel para
 * ambos porque la mecánica es la misma; `modo` fija a quién se invita y qué
 * selector aparece en el modal.
 *
 * Nada de esto toca las licencias de la app de garita: eso vincula
 * máquinas por huella de hardware; esto invita personas por correo.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getInvitaciones, reenviarInvitacion, revocarInvitacion,
  type Empresa, type Invitacion, type InvitacionEstado, type Sucursal,
} from '../services/api';
import {
  Badge, Button, DataTable, EmptyState, RowActions, ROW_ICON, useToast,
  type BadgeTone, type Column, type RowAction,
} from './ui';
import InvitarAdminModal, { ICON_MAIL, type InvitacionesModo } from './InvitarAdminModal';
import { useTranslation } from '../i18n/useTranslation';
import { formatearFechaHoraCorta } from '../utils/fecha';

export type { InvitacionesModo };

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
  /** Invitación reenviada: el diálogo abre directo en la vista del enlace. */
  const [reenviada, setReenviada] = useState<Invitacion | null>(null);

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

  const abrir = () => { setReenviada(null); setOpen(true); };

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
      if (r.enlace) { setReenviada(r); setOpen(true); }
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

      <InvitarAdminModal
        open={open}
        onClose={() => setOpen(false)}
        modo={modo}
        empresas={empresas}
        sucursales={sucursales}
        resultado={reenviada}
        onEnviada={cargar}
      />
    </section>
  );
}
