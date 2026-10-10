import { useEffect, useState } from 'react';
import {
  getEmpresas, updateEmpresa, deleteEmpresa, assignAdminEmpresa,
  suspenderEmpresa, reactivarEmpresa, eliminarEmpresaDefinitivo,
  getUsuarios, createUsuario,
  type Empresa, type Usuario,
} from '../../services/api';
import { TableSkeleton } from '../../components/Skeleton';
import { Button, Input, Modal, PasswordInput, ROW_ICON, RowActions, Select, StatusText, Textarea, requisitosDeClave, useConfirmacion } from '../../components/ui';
import { useToast } from '../../components/Toast';
import InvitacionesPanel from '../../components/InvitacionesPanel';
import InvitarAdminModal from '../../components/InvitarAdminModal';
import EmpresaModal from '../../components/EmpresaModal';
import { useTranslation } from '../../i18n/useTranslation';
import { rellenar } from '../../components/charts/format';

type Dialogo = 'none' | 'assignAdmin';
type AssignMode = 'existing' | 'create';

const EMPTY_NEW_USER = { nombre: '', email: '', password: '' };

export default function OwnerEmpresas() {
  const showToast = useToast();
  const { t } = useTranslation();
  const { confirmar, dialogo } = useConfirmacion();

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearch]     = useState('');

  const [modal, setModal]               = useState<Dialogo>('none');
  /** Alta/edición de empresa (un solo formulario, compartido con el panel del owner). */
  const [empresaDlg, setEmpresaDlg]     = useState<{ abierto: boolean; empresa: Empresa | null }>({ abierto: false, empresa: null });
  /** «Invitar administrador» (tras crear la empresa o desde la fila). */
  const [invitarDlg, setInvitarDlg]     = useState<{ abierto: boolean; empresa: Empresa | null }>({ abierto: false, empresa: null });
  /** Cambia cuando se envía una invitación: el panel de abajo vuelve a pedir su lista. */
  const [panelKey, setPanelKey]         = useState(0);
  const [assignTarget, setAssignTarget] = useState<Empresa | null>(null);
  const [assignMode, setAssignMode]     = useState<AssignMode>('existing');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [newUserForm, setNewUserForm]   = useState(EMPTY_NEW_USER);
  const [saving, setSaving]             = useState(false);
  const [formError, setFormError]       = useState<string | null>(null);
  /** Empresa a suspender (modal con motivo). */
  const [suspendTarget, setSuspendTarget] = useState<Empresa | null>(null);
  const [motivo, setMotivo]             = useState('');
  /** Empresa a borrar físicamente (modal con nombre + contraseña del owner). */
  const [hardTarget, setHardTarget]     = useState<Empresa | null>(null);
  const [confirmNombre, setConfirmNombre] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');

  const cargar = () => {
    setLoading(true);
    Promise.all([getEmpresas(), getUsuarios()])
      .then(([emp, usr]) => { setEmpresas(emp); setUsuarios(usr); })
      .catch(() => setError('No se pudo cargar la lista de empresas.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, []);

  const closeModal = () => {
    setModal('none');
    setFormError(null); setSelectedUserId('');
    setAssignMode('existing'); setNewUserForm(EMPTY_NEW_USER);
  };

  const openAssignAdmin = (emp: Empresa) => {
    setAssignTarget(emp);
    setSelectedUserId('');
    setAssignMode('existing');
    setNewUserForm(EMPTY_NEW_USER);
    setFormError(null);
    setModal('assignAdmin');
  };

  const handleAssignExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignTarget || !selectedUserId) { setFormError(t('owner.selectUser')); return; }
    setSaving(true); setFormError(null);
    try {
      await assignAdminEmpresa(assignTarget.id, selectedUserId);
      closeModal(); cargar();
      showToast(t('owner.adminAssigned'));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al asignar administrador');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAndAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignTarget) return;
    const { nombre, email, password } = newUserForm;
    if (!nombre.trim() || !email.trim() || !password.trim()) {
      setFormError('Nombre, email y contraseña son requeridos');
      return;
    }
    if (!requisitosDeClave(password).every(r => r.ok)) {
      setFormError(t('owner.passwordRules'));
      return;
    }
    setSaving(true); setFormError(null);
    try {
      const newUser = await createUsuario({ nombre, email, password, rol: 'agente' });
      await assignAdminEmpresa(assignTarget.id, newUser.id);
      closeModal(); cargar();
      showToast(t('owner.adminAssigned'));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al crear y asignar usuario');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (emp: Empresa) => {
    try {
      await updateEmpresa(emp.id, { activo: !emp.activo });
      cargar();
      showToast(emp.activo ? t('owner.companyDeactivated') : t('owner.companyActivated'), emp.activo ? 'warning' : 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al actualizar empresa', 'error');
    }
  };

  const handleSuspend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendTarget) return;
    if (motivo.trim().length < 3) { setFormError(t('owner.suspendMotivoRequired')); return; }
    setSaving(true); setFormError(null);
    try {
      await suspenderEmpresa(suspendTarget.id, motivo.trim());
      setSuspendTarget(null); setMotivo('');
      cargar();
      showToast(t('owner.companySuspended'), 'warning');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al suspender empresa');
    } finally {
      setSaving(false);
    }
  };

  const handleReactivate = async (emp: Empresa) => {
    try {
      await reactivarEmpresa(emp.id);
      cargar();
      showToast(t('owner.companyReactivated'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al reactivar empresa', 'error');
    }
  };

  const handleHardDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hardTarget) return;
    if (confirmNombre.trim() !== hardTarget.nombre) { setFormError(t('owner.hardDeleteNameMismatch')); return; }
    if (!ownerPassword) { setFormError(t('owner.hardDeletePasswordRequired')); return; }
    setSaving(true); setFormError(null);
    try {
      const r = await eliminarEmpresaDefinitivo(hardTarget.id, ownerPassword);
      setHardTarget(null); setConfirmNombre(''); setOwnerPassword('');
      cargar();
      showToast(`${t('owner.hardDeleted')}: ${r.nombre}`, 'warning');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al eliminar empresa');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (emp: Empresa) => {
    const ok = await confirmar({
      title: rellenar(t('confirm.deleteCompany.title'), { nombre: emp.nombre }),
      message: t('confirm.deleteCompany.message'),
      confirmLabel: t('confirm.deleteCompany.action'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteEmpresa(emp.id);
      cargar();
      showToast(t('owner.empresaDeleted'), 'warning');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al eliminar empresa', 'error');
    }
  };

  const filtered = empresas.filter(emp => {
    const q = search.toLowerCase();
    return (`${emp.nombre} ${emp.nit ?? ''}`).toLowerCase().includes(q);
  });

  return (
    <div className="sg-page text-gray-100">
      <div className="sg-panel-heading">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-50 sm:text-3xl">{t('empresas.title')}</h1>
          <p className="mt-1 text-sm text-gray-400">
            {rellenar(t('empresas.counts'), { total: empresas.length, activas: empresas.filter(e => e.activo).length })}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="sg-section-title">Cartera de empresas</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre o NIT…"
            className="sg-input w-full sm:w-60"
          />
          <Button onClick={() => setEmpresaDlg({ abierto: true, empresa: null })}>
            {t('empresas.new')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      <div className="sg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">{t('empresas.title')}</th>
                <th className="px-4 py-3 font-medium">{t('owner.nit')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('owner.branches')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('common.status')}</th>
                <th className="px-4 py-3 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={5} cols={5} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                    {t('empresas.noCompanies')}
                  </td>
                </tr>
              ) : (
                filtered.map(emp => (
                  <tr key={emp.id} className="border-b border-gray-700/40 last:border-0 hover:bg-gray-700/20 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{emp.nombre}</p>
                      {emp.logo_url && (
                        <p className="text-xs text-gray-500 truncate max-w-xs">{emp.logo_url}</p>
                      )}
                      {emp.activo && emp.tiene_admin === false && (
                        <p className="mt-1">
                          <StatusText kind="warn">{t(emp.invitacion_pendiente ? 'sinAdmin.invited' : 'sinAdmin.none')}</StatusText>
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{emp.nit ?? '—'}</td>
                    <td className="px-4 py-3 text-center">{emp.total_sucursales}</td>
                    <td className="px-4 py-3 text-center">
                      {!emp.activo ? (
                        <StatusText kind="off">{t('common.inactiveF')}</StatusText>
                      ) : emp.suspendida ? (
                        <StatusText kind="bad">
                          <span title={emp.suspension_motivo ?? ''}>{t('owner.suspended')}</span>
                        </StatusText>
                      ) : (
                        <StatusText kind="on">{t('common.activeF')}</StatusText>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <RowActions
                        align="start"
                        menuLabel={`${t('common.actions')}: ${emp.nombre}`}
                        actions={[
                          ...(emp.activo && emp.tiene_admin === false ? [{
                            id: 'invitar-admin',
                            label: t('inv.action.inviteAdmin'),
                            icon: ROW_ICON.user,
                            tone: 'primary' as const,
                            onClick: () => setInvitarDlg({ abierto: true, empresa: emp }),
                          }] : []),
                          {
                            id: 'editar',
                            label: t('common.edit'),
                            icon: ROW_ICON.edit,
                            tone: emp.activo && emp.tiene_admin === false ? undefined : 'primary',
                            onClick: () => setEmpresaDlg({ abierto: true, empresa: emp }),
                          },
                          {
                            id: 'admin',
                            label: t('owner.assignAdmin'),
                            icon: ROW_ICON.user,
                            onClick: () => openAssignAdmin(emp),
                          },
                          ...(emp.activo ? [
                            emp.suspendida
                              ? { id: 'reactivar', label: t('owner.reactivate'), icon: ROW_ICON.play, onClick: () => handleReactivate(emp) }
                              : { id: 'suspender', label: t('owner.suspend'), icon: ROW_ICON.pause, tone: 'danger' as const, onClick: () => { setSuspendTarget(emp); setMotivo(''); setFormError(null); } },
                          ] : []),
                          {
                            id: 'toggle',
                            label: emp.activo ? t('common.deactivate') : t('common.activate'),
                            icon: emp.activo ? ROW_ICON.pause : ROW_ICON.play,
                            onClick: () => handleToggle(emp),
                          },
                          {
                            id: 'baja',
                            label: t('owner.softDelete'),
                            icon: ROW_ICON.pause,
                            onClick: () => handleDelete(emp),
                          },
                          {
                            id: 'eliminar-definitivo',
                            label: t('owner.hardDelete'),
                            icon: ROW_ICON.trash,
                            tone: 'danger',
                            onClick: () => { setHardTarget(emp); setConfirmNombre(''); setOwnerPassword(''); setFormError(null); },
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Aprovisionamiento en cascada: el owner invita al admin de cada empresa. */}
      <InvitacionesPanel key={panelKey} modo="owner" empresas={empresas} />

      <EmpresaModal
        open={empresaDlg.abierto}
        onClose={() => setEmpresaDlg(d => ({ ...d, abierto: false }))}
        empresa={empresaDlg.empresa}
        onSaved={() => cargar()}
        onInvitar={emp => setInvitarDlg({ abierto: true, empresa: emp })}
      />

      <InvitarAdminModal
        open={invitarDlg.abierto}
        onClose={() => setInvitarDlg(d => ({ ...d, abierto: false }))}
        modo="owner"
        empresaFija={invitarDlg.empresa ? { id: invitarDlg.empresa.id, nombre: invitarDlg.empresa.nombre } : null}
        onEnviada={() => { cargar(); setPanelKey(k => k + 1); }}
      />

      {/* ── Modal: suspender operaciones ── */}
      <Modal
        open={!!suspendTarget}
        onClose={() => setSuspendTarget(null)}
        title={t('owner.suspendTitle')}
        description={suspendTarget ? `${t('empresas.title')}: ${suspendTarget.nombre}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSuspendTarget(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" type="submit" form="form-suspender" loading={saving}>{t('owner.suspend')}</Button>
          </>
        }
      >
        <form id="form-suspender" onSubmit={handleSuspend} className="space-y-4">
          <p className="text-sm text-gray-300">{t('owner.suspendDesc')}</p>
          {formError && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{formError}</p>}
          <Textarea
            label={t('owner.suspendMotivo')}
            required
            minLength={3}
            maxLength={300}
            rows={3}
            autoFocus
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            hint={t('owner.suspendMotivoHint')}
          />
        </form>
      </Modal>

      {/* ── Modal: eliminar definitivamente (nombre + contraseña del owner) ── */}
      <Modal
        open={!!hardTarget}
        onClose={() => { if (!saving) setHardTarget(null); }}
        dismissible={!saving}
        title={t('owner.hardDeleteTitle')}
        description={hardTarget ? `${t('empresas.title')}: ${hardTarget.nombre}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setHardTarget(null)} disabled={saving}>{t('common.cancel')}</Button>
            <Button variant="danger" type="submit" form="form-eliminar-definitivo" loading={saving} disabled={!hardTarget || confirmNombre.trim() !== hardTarget.nombre || !ownerPassword}>
              {t('owner.hardDeleteConfirm')}
            </Button>
          </>
        }
      >
        <form id="form-eliminar-definitivo" onSubmit={handleHardDelete} className="space-y-4" autoComplete="off">
          <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">
            {t('owner.hardDeleteWarning')}
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-gray-400">
            <li>{t('owner.hardDeleteScope1')}</li>
            <li>{t('owner.hardDeleteScope2')}</li>
            <li>{t('owner.hardDeleteScope3')}</li>
          </ul>
          {formError && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{formError}</p>}
          <Input
            label={t('owner.hardDeleteTypeName').replace('{nombre}', hardTarget?.nombre ?? '')}
            required
            autoFocus
            autoComplete="off"
            value={confirmNombre}
            onChange={e => setConfirmNombre(e.target.value)}
          />
          <Input
            type="password"
            label={t('owner.hardDeletePassword')}
            required
            autoComplete="current-password"
            value={ownerPassword}
            onChange={e => setOwnerPassword(e.target.value)}
            hint={t('owner.hardDeletePasswordHint')}
          />
        </form>
      </Modal>

      {/* ── Modal: asignar administrador (usuario existente o cuenta nueva) ── */}
      <Modal
        open={modal === 'assignAdmin'}
        onClose={closeModal}
        dismissible={!saving}
        title={t('owner.assignAdminModal')}
        description={assignTarget ? `${t('empresas.title')}: ${assignTarget.nombre}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>{t('common.cancel')}</Button>
            <Button type="submit" form="form-asignar-admin" loading={saving}>
              {assignMode === 'existing' ? t('owner.assignAdmin') : t('owner.createAndAssign')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-1 rounded-lg bg-gray-500/10 p-1" role="tablist">
            {(['existing', 'create'] as AssignMode[]).map(m => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={assignMode === m}
                onClick={() => { setAssignMode(m); setFormError(null); }}
                className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                  assignMode === m ? 'bg-brand-500 text-brand-ink' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {m === 'existing' ? t('owner.existingUser') : t('owner.createNewUser')}
              </button>
            ))}
          </div>

          {formError && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{formError}</p>}

          <form
            id="form-asignar-admin"
            onSubmit={assignMode === 'existing' ? handleAssignExisting : handleCreateAndAssign}
            className="space-y-4"
            noValidate
          >
            {assignMode === 'existing' ? (
              <Select label={t('owner.selectUser')} value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
                <option value="">— seleccionar —</option>
                {usuarios.map(u => (
                  <option key={u.id} value={u.id}>{u.nombre} ({u.email}) — {u.rol}</option>
                ))}
              </Select>
            ) : (
              <>
                <Input name="nombre" label={t('common.name')} required value={newUserForm.nombre}
                  onChange={e => setNewUserForm(prev => ({ ...prev, nombre: e.target.value }))} />
                <Input name="email" type="email" label={t('common.email')} required value={newUserForm.email}
                  onChange={e => setNewUserForm(prev => ({ ...prev, email: e.target.value }))} />
                <PasswordInput name="password" label={t('common.password')} required value={newUserForm.password}
                  onChange={e => setNewUserForm(prev => ({ ...prev, password: e.target.value }))} />
              </>
            )}
          </form>
        </div>
      </Modal>
      {dialogo}
    </div>
  );
}
