import { useEffect, useState } from 'react';
import {
  getSucursales, createSucursal, updateSucursal, deleteSucursal, assignAdminSucursal,
  getUsuarios, createUsuario, deleteUsuario,
  type Sucursal, type SucursalInput, type Usuario,
} from '../../services/api';
import { TableSkeleton } from '../../components/Skeleton';
import { Button, EmptyState, Input, Modal, PasswordInput, ROW_ICON, RowActions, Select, StatusText, requisitosDeClave, useConfirmacion } from '../../components/ui';
import { useToast } from '../../components/Toast';
import InvitacionesPanel from '../../components/InvitacionesPanel';
import InvitarAdminModal from '../../components/InvitarAdminModal';
import TipoSucursalSelect from '../../components/TipoSucursalSelect';
import { etiquetaTipoSucursal } from '../../utils/sucursal';
import { decodeTokenPayload } from '../../services/api';
import { useTranslation } from '../../i18n/useTranslation';
import { rellenar } from '../../components/charts/format';

type Modal = 'none' | 'sucursal' | 'admin' | 'usuario';

const ICON_SUCURSAL = 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10';

const EMPTY_SUC: SucursalInput = { empresa_id: '', nombre: '', direccion: '', tipo: '' };

interface UsuarioForm {
  nombre: string;
  email: string;
  password: string;
  rol: string;
  sucursal_id: string;
}
const EMPTY_USR: UsuarioForm = { nombre: '', email: '', password: '', rol: 'agente', sucursal_id: '' };

export default function GestionSucursales() {
  const showToast = useToast();
  const { t } = useTranslation();
  const { confirmar, dialogo } = useConfirmacion();

  const empresaId = (() => {
    const token = localStorage.getItem('token');
    if (!token) return '';
    return (decodeTokenPayload(token)?.empresa_id as string) ?? '';
  })();

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [usuarios, setUsuarios]     = useState<Usuario[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  const [modal, setModal]             = useState<Modal>('none');
  const [sucForm, setSucForm]         = useState<SucursalInput>({ ...EMPTY_SUC, empresa_id: empresaId });
  const [editSuc, setEditSuc]         = useState<Sucursal | null>(null);
  const [adminTarget, setAdminTarget] = useState<Sucursal | null>(null);
  const [adminUserId, setAdminUserId] = useState('');
  const [usrForm, setUsrForm]         = useState<UsuarioForm>(EMPTY_USR);
  const [saving, setSaving]           = useState(false);
  const [modalError, setModalError]   = useState<string | null>(null);
  /** Sucursal recién creada: el diálogo pasa al paso «Invitar administrador». */
  const [creada, setCreada]           = useState<Sucursal | null>(null);
  const [invitarDlg, setInvitarDlg]   = useState<{ abierto: boolean; sucursal: Sucursal | null }>({ abierto: false, sucursal: null });
  /** Cambia cuando se envía una invitación: el panel de abajo vuelve a pedir su lista. */
  const [panelKey, setPanelKey]       = useState(0);

  const cargar = () => {
    setLoading(true);
    Promise.all([getSucursales(), getUsuarios()])
      .then(([suc, usr]) => {
        setSucursales(suc);
        setUsuarios(usr);
      })
      .catch(() => setError(t('ae.noData')))
      .finally(() => setLoading(false));
  };

  // Carga inicial del módulo de administración por empresa.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, []);

  const closeModal = () => {
    setModal('none');
    setModalError(null);
  };

  // ── Sucursal modals ──────────────────────────────────────────────────────

  const openCreateSuc = () => {
    setSucForm({ ...EMPTY_SUC, empresa_id: empresaId });
    setEditSuc(null);
    setCreada(null);
    setModalError(null);
    setModal('sucursal');
  };

  const openEditSuc = (suc: Sucursal) => {
    setEditSuc(suc);
    setSucForm({ empresa_id: suc.empresa_id, nombre: suc.nombre, direccion: suc.direccion ?? '', tipo: suc.tipo ?? '' });
    setCreada(null);
    setModalError(null);
    setModal('sucursal');
  };

  const handleSucChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setSucForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSucSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sucForm.nombre.trim()) { setModalError('El nombre es requerido'); return; }
    setSaving(true); setModalError(null);
    try {
      if (editSuc) {
        await updateSucursal(editSuc.id, {
          nombre:    sucForm.nombre,
          direccion: sucForm.direccion || undefined,
          tipo:      sucForm.tipo      || undefined,
        });
        showToast(t('ae.branchSaved'));
        closeModal();
      } else {
        const nueva = await createSucursal({
          empresa_id: empresaId,
          nombre:     sucForm.nombre,
          direccion:  sucForm.direccion || undefined,
          tipo:       sucForm.tipo      || undefined,
        });
        // No se cierra: una sucursal sin administrador no sirve de nada, y el siguiente paso es invitarlo.
        setCreada(nueva);
      }
      cargar();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Error al guardar sucursal');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (suc: Sucursal) => {
    try {
      await updateSucursal(suc.id, { activo: !suc.activo });
      cargar();
      showToast(suc.activo ? t('ae.deactivated') : t('ae.activated'), suc.activo ? 'warning' : 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al actualizar sucursal', 'error');
    }
  };

  const handleDeleteSucursal = async (suc: Sucursal) => {
    const ok = await confirmar({
      title: rellenar(t('confirm.deleteBranch.title'), { nombre: suc.nombre }),
      message: t('confirm.deleteBranch.message'),
      confirmLabel: t('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteSucursal(suc.id);
      cargar();
      showToast(t('ae.sucursalDeleted'), 'warning');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al eliminar sucursal', 'error');
    }
  };

  const handleDeleteUsuario = async (u: Usuario) => {
    const ok = await confirmar({
      title: rellenar(t('confirm.deactivateUser.title'), { nombre: u.nombre }),
      message: t('confirm.deactivateUser.message'),
      confirmLabel: t('confirm.deactivateUser.action'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteUsuario(u.id);
      cargar();
      showToast(t('ae.userDeleted'), 'warning');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al eliminar usuario', 'error');
    }
  };

  // ── Assign admin modal ───────────────────────────────────────────────────

  const openAdminModal = (suc: Sucursal) => {
    setAdminTarget(suc);
    setAdminUserId('');
    setModalError(null);
    setModal('admin');
  };

  const handleAssignAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminTarget || !adminUserId.trim()) { setModalError(t('ae.selectUser')); return; }
    setSaving(true); setModalError(null);
    try {
      await assignAdminSucursal(adminTarget.id, adminUserId.trim());
      closeModal();
      cargar();
      showToast(t('ae.adminAssigned'));
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Error al asignar admin');
    } finally {
      setSaving(false);
    }
  };

  // ── Create user modal ────────────────────────────────────────────────────

  const openUserModal = () => {
    setUsrForm({ ...EMPTY_USR, sucursal_id: sucursales[0]?.id ?? '' });
    setModalError(null);
    setModal('usuario');
  };

  const handleUsrChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setUsrForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleCreateUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usrForm.nombre.trim() || !usrForm.email.trim() || !usrForm.password.trim()) {
      setModalError('Nombre, email y contraseña son requeridos');
      return;
    }
    if (!requisitosDeClave(usrForm.password).every(r => r.ok)) {
      setModalError(t('owner.passwordRules'));
      return;
    }
    setSaving(true); setModalError(null);
    try {
      await createUsuario({
        nombre:      usrForm.nombre,
        email:       usrForm.email,
        password:    usrForm.password,
        rol:         usrForm.rol,
        sucursal_id: usrForm.sucursal_id || undefined,
      });
      closeModal();
      cargar();
      showToast(t('ae.userCreated'));
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Error al crear usuario');
    } finally {
      setSaving(false);
    }
  };

  const [staffFilter, setStaffFilter] = useState<'all' | 'agente' | 'admin_sucursal'>('all');
  const [sucSearch, setSucSearch]     = useState('');
  const [staffSearch, setStaffSearch] = useState('');

  const filteredSucursales = sucursales.filter(s =>
    s.nombre.toLowerCase().includes(sucSearch.toLowerCase())
  );

  const staffUsuarios = usuarios.filter(u => {
    if (u.rol === 'residente') return false;
    if (staffFilter !== 'all' && u.rol !== staffFilter) return false;
    const q = staffSearch.toLowerCase();
    return (`${u.nombre} ${u.email}`).toLowerCase().includes(q);
  });

  return (
    <div className="sg-page text-gray-100">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-50">{t('ae.managementTitle')}</h1>
          <p className="mt-1 text-sm text-gray-400">
            {rellenar(t('ae.managementCounts'), { sucursales: sucursales.length, personal: usuarios.length })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={openUserModal}>{t('ae.newUser')}</Button>
          {(loading || sucursales.length > 0) && <Button variant="secondary" onClick={openCreateSuc}>{t('ae.newBranch')}</Button>}
        </div>
      </div>

      {error && (
        <div className="bg-danger-900/40 border border-danger-700 rounded-lg px-4 py-3 text-danger-300 text-sm">{error}</div>
      )}

      {/* Sucursales table */}
      <div className="sg-card overflow-hidden">
        <div className="space-y-3 border-b border-white/10 px-5 py-4 sm:px-6">
          <h2 className="text-base font-semibold text-white">{t('ae.branchesSection')}</h2>
          <input
            type="text"
            value={sucSearch}
            onChange={e => setSucSearch(e.target.value)}
            placeholder="Buscar sucursal…"
            className="sg-input"
          />
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
                <th className="px-4 py-3 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={3} cols={6} />
              ) : sucursales.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={ICON_SUCURSAL}
                      title={t('ae.welcome.title')}
                      description={t('ae.welcome.body')}
                      action={<Button onClick={openCreateSuc}>{t('ae.welcome.cta')}</Button>}
                    />
                  </td>
                </tr>
              ) : filteredSucursales.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                    {t('ae.noBranches')}
                  </td>
                </tr>
              ) : (
                filteredSucursales.map(suc => (
                  <tr key={suc.id} className="border-b border-gray-700 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{suc.nombre}</p>
                      {suc.direccion && <p className="text-xs text-gray-500">{suc.direccion}</p>}
                      {suc.activo && suc.tiene_admin === false && (
                        <p className="mt-1">
                          <StatusText kind="warn">{t(suc.invitacion_pendiente ? 'sinAdmin.invited' : 'sinAdmin.none')}</StatusText>
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{etiquetaTipoSucursal(t, suc.tipo)}</td>
                    <td className="px-4 py-3 text-center">{suc.total_residentes}</td>
                    <td className="px-4 py-3 text-center">{suc.total_agentes}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusText kind={suc.activo ? 'on' : 'off'}>
                        {suc.activo ? t('common.activeF') : t('common.inactiveF')}
                      </StatusText>
                    </td>
                    <td className="px-4 py-3">
                      <RowActions
                        align="start"
                        menuLabel={`${t('common.actions')}: ${suc.nombre}`}
                        actions={[
                          ...(suc.activo && suc.tiene_admin === false ? [{
                            id: 'invitar-admin',
                            label: t('inv.action.inviteAdmin'),
                            icon: ROW_ICON.user,
                            tone: 'primary' as const,
                            onClick: () => setInvitarDlg({ abierto: true, sucursal: suc }),
                          }] : []),
                          {
                            id: 'editar',
                            label: t('common.edit'),
                            icon: ROW_ICON.edit,
                            tone: suc.activo && suc.tiene_admin === false ? undefined : 'primary',
                            onClick: () => openEditSuc(suc),
                          },
                          {
                            id: 'admin',
                            label: t('empDetail.assignAdmin'),
                            icon: ROW_ICON.user,
                            onClick: () => openAdminModal(suc),
                          },
                          {
                            id: 'toggle',
                            label: suc.activo ? t('common.deactivate') : t('common.activate'),
                            icon: suc.activo ? ROW_ICON.pause : ROW_ICON.play,
                            onClick: () => handleToggle(suc),
                          },
                          {
                            id: 'eliminar',
                            label: t('common.delete'),
                            icon: ROW_ICON.trash,
                            tone: 'danger',
                            onClick: () => handleDeleteSucursal(suc),
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

      {/* Staff users table */}
      <div className="sg-card overflow-hidden">
        <div className="space-y-3 border-b border-white/10 px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-base font-semibold text-white">{t('ae.staffSection')}</h2>
            <div className="flex gap-1 bg-gray-700/50 rounded-lg p-1">
              {(['all', 'agente', 'admin_sucursal'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setStaffFilter(f)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                    staffFilter === f
                      ? 'bg-brand-500 text-brand-ink'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {f === 'all' ? t('ae.filterAll') : f === 'agente' ? t('ae.filterAgents') : t('ae.filterAdmins')}
                </button>
              ))}
            </div>
          </div>
          <input
            type="text"
            value={staffSearch}
            onChange={e => setStaffSearch(e.target.value)}
            placeholder="Buscar por nombre o email…"
            className="sg-input"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">{t('common.name')}</th>
                <th className="px-4 py-3 font-medium">{t('common.email')}</th>
                <th className="px-4 py-3 font-medium">{t('common.role')}</th>
                <th className="px-4 py-3 font-medium">{t('ae.branchLabel')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('common.status')}</th>
                <th className="px-4 py-3 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={3} cols={5} />
              ) : staffUsuarios.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                    {t('ae.noStaff')}
                  </td>
                </tr>
              ) : (
                staffUsuarios.map(u => (
                  <tr key={u.id} className="border-b border-gray-700 last:border-0">
                    <td className="px-4 py-3 font-medium text-white">{u.nombre}</td>
                    <td className="px-4 py-3 text-gray-400">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">
                        {u.rol}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{u.sucursal_nombre ?? '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusText kind={u.activo ? 'on' : 'off'}>
                        {u.activo ? t('common.active') : t('common.inactive')}
                      </StatusText>
                    </td>
                    <td className="px-4 py-3">
                      <RowActions
                        align="start"
                        menuLabel={`${t('common.actions')}: ${u.nombre}`}
                        actions={[
                          {
                            id: 'eliminar',
                            label: t('common.delete'),
                            icon: ROW_ICON.trash,
                            tone: 'danger',
                            onClick: () => handleDeleteUsuario(u),
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

      {/* Aprovisionamiento en cascada: el admin de empresa invita al admin de cada sucursal. */}
      <InvitacionesPanel key={panelKey} modo="admin_empresa" sucursales={sucursales} />

      {/* ── Modal: crear / editar sucursal (al crear, paso siguiente: invitar administrador) ── */}
      <Modal
        open={modal === 'sucursal'}
        onClose={closeModal}
        dismissible={!saving}
        title={creada ? t('ae.ready.title') : editSuc ? t('ae.editBranch') : t('ae.newBranchModal')}
        footer={creada ? (
          <>
            <Button variant="secondary" onClick={closeModal}>{t('empresa.ready.later')}</Button>
            <Button onClick={() => { setInvitarDlg({ abierto: true, sucursal: creada }); closeModal(); }}>{t('empresa.ready.invite')}</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>{t('common.cancel')}</Button>
            <Button type="submit" form="form-sucursal" loading={saving}>{editSuc ? t('common.save') : t('ae.createBranch')}</Button>
          </>
        )}
      >
        {creada ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-200">{rellenar(t('ae.ready.body'), { nombre: creada.nombre })}</p>
            <p className="text-xs text-gray-400">{t('ae.ready.laterHint')}</p>
          </div>
        ) : (
          <form id="form-sucursal" onSubmit={handleSucSubmit} className="space-y-4" noValidate>
            {modalError && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{modalError}</p>}
            <Input name="nombre" label={t('common.name')} required autoFocus value={sucForm.nombre} onChange={handleSucChange} />
            <TipoSucursalSelect value={sucForm.tipo ?? ''} onChange={tipo => setSucForm(prev => ({ ...prev, tipo }))} />
            <Input name="direccion" label={t('empDetail.direction')} value={sucForm.direccion ?? ''} onChange={handleSucChange} />
          </form>
        )}
      </Modal>

      <InvitarAdminModal
        open={invitarDlg.abierto}
        onClose={() => setInvitarDlg(d => ({ ...d, abierto: false }))}
        modo="admin_empresa"
        sucursalFija={invitarDlg.sucursal ? { id: invitarDlg.sucursal.id, nombre: invitarDlg.sucursal.nombre } : null}
        onEnviada={() => { cargar(); setPanelKey(k => k + 1); }}
      />

      {/* ── Modal: asignar admin ── */}
      <Modal
        open={modal === 'admin'}
        onClose={closeModal}
        dismissible={!saving}
        size="sm"
        title={t('ae.assignAdminModal')}
        description={adminTarget ? `${t('ae.branchLabel')}: ${adminTarget.nombre}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>{t('common.cancel')}</Button>
            <Button type="submit" form="form-asignar-admin-suc" loading={saving}>{t('ae.assign')}</Button>
          </>
        }
      >
        <form id="form-asignar-admin-suc" onSubmit={handleAssignAdmin} className="space-y-4" noValidate>
          {modalError && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{modalError}</p>}
          <Select label={t('ae.selectUser')} value={adminUserId} onChange={e => setAdminUserId(e.target.value)}>
            <option value="">{t('ae.selectUser')}</option>
            {usuarios.map(u => (
              <option key={u.id} value={u.id}>{u.nombre} ({u.email})</option>
            ))}
          </Select>
        </form>
      </Modal>

      {/* ── Modal: crear usuario ── */}
      <Modal
        open={modal === 'usuario'}
        onClose={closeModal}
        dismissible={!saving}
        title={t('ae.newUserModal')}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>{t('common.cancel')}</Button>
            <Button type="submit" form="form-usuario" loading={saving}>{t('ae.createUser')}</Button>
          </>
        }
      >
        <form id="form-usuario" onSubmit={handleCreateUsuario} className="space-y-4" noValidate>
          {modalError && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{modalError}</p>}
          <Input name="nombre" label={t('common.name')} required value={usrForm.nombre} onChange={handleUsrChange} />
          <Input name="email" type="email" label={t('common.email')} required value={usrForm.email} onChange={handleUsrChange} />
          <PasswordInput name="password" label={t('common.password')} required value={usrForm.password} onChange={handleUsrChange} />
          <Select name="rol" label={t('common.role')} required value={usrForm.rol} onChange={handleUsrChange}>
            <option value="agente">{t('ae.agentRole')}</option>
            <option value="admin_sucursal">{t('ae.adminSucRole')}</option>
          </Select>
          <Select name="sucursal_id" label={t('ae.branchLabel')} value={usrForm.sucursal_id} onChange={handleUsrChange}>
            <option value="">{t('ae.noAssigned')}</option>
            {sucursales.filter(x => x.activo).map(x => (
              <option key={x.id} value={x.id}>{x.nombre}</option>
            ))}
          </Select>
        </form>
      </Modal>
      {dialogo}
    </div>
  );
}
