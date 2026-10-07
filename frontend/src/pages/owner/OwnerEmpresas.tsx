import { useEffect, useState } from 'react';
import {
  getEmpresas, createEmpresa, updateEmpresa, deleteEmpresa, assignAdminEmpresa,
  suspenderEmpresa, reactivarEmpresa, eliminarEmpresaDefinitivo,
  getUsuarios, createUsuario,
  type Empresa, type EmpresaInput, type Usuario,
} from '../../services/api';
import { TableSkeleton } from '../../components/Skeleton';
import { Button, Input, Modal, ROW_ICON, RowActions, StatusText, Textarea } from '../../components/ui';
import { useToast } from '../../components/Toast';
import InvitacionesPanel from '../../components/InvitacionesPanel';
import { useTranslation } from '../../i18n/useTranslation';
import { rellenar } from '../../components/charts/format';

type Modal = 'none' | 'create' | 'edit' | 'assignAdmin';
type AssignMode = 'existing' | 'create';

const EMPTY: EmpresaInput = { nombre: '', nit: '', logo_url: '' };
const EMPTY_NEW_USER = { nombre: '', email: '', password: '' };

export default function OwnerEmpresas() {
  const showToast = useToast();
  const { t } = useTranslation();

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearch]     = useState('');

  const [modal, setModal]               = useState<Modal>('none');
  const [editTarget, setEditTarget]     = useState<Empresa | null>(null);
  const [assignTarget, setAssignTarget] = useState<Empresa | null>(null);
  const [assignMode, setAssignMode]     = useState<AssignMode>('existing');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [newUserForm, setNewUserForm]   = useState(EMPTY_NEW_USER);
  const [form, setForm]                 = useState<EmpresaInput>(EMPTY);
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

  const openCreate = () => {
    setForm(EMPTY); setFormError(null); setEditTarget(null); setModal('create');
  };

  const openEdit = (emp: Empresa) => {
    setEditTarget(emp);
    setForm({ nombre: emp.nombre, nit: emp.nit ?? '', logo_url: emp.logo_url ?? '' });
    setFormError(null);
    setModal('edit');
  };

  const closeModal = () => {
    setModal('none'); setEditTarget(null); setAssignTarget(null);
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre.trim()) { setFormError('El nombre es requerido'); return; }
    setSaving(true); setFormError(null);
    try {
      await createEmpresa({ nombre: form.nombre, nit: form.nit || undefined, logo_url: form.logo_url || undefined });
      closeModal(); cargar();
      showToast(t('owner.companyCreated'));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al crear empresa');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    if (!form.nombre.trim()) { setFormError('El nombre es requerido'); return; }
    setSaving(true); setFormError(null);
    try {
      await updateEmpresa(editTarget.id, { nombre: form.nombre, nit: form.nit || undefined, logo_url: form.logo_url || undefined });
      closeModal(); cargar();
      showToast(t('owner.companyUpdated'));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al actualizar empresa');
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
    if (!window.confirm(`${t('owner.confirmDeleteEmpresa')} "${emp.nombre}"?`)) return;
    try {
      await deleteEmpresa(emp.id);
      cargar();
      showToast(t('owner.empresaDeleted'), 'warning');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al eliminar empresa', 'error');
    }
  };

  const fields: [keyof EmpresaInput, string, string][] = [
    ['nombre',   `${t('common.name')} *`, 'text'],
    ['nit',      t('owner.nit'),          'text'],
    ['logo_url', t('owner.logoUrl'),      'url'],
  ];

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
          <button
            onClick={openCreate}
            className="sg-btn sg-btn-primary flex items-center justify-center gap-2 text-sm"
          >
            <span className="text-lg leading-none">+</span> {t('empresas.new')}
          </button>
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
                          {
                            id: 'editar',
                            label: t('common.edit'),
                            icon: ROW_ICON.edit,
                            tone: 'primary',
                            onClick: () => openEdit(emp),
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
      <InvitacionesPanel modo="owner" empresas={empresas} />

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

      {/* ── Modal: assign admin empresa ── */}
      {modal === 'assignAdmin' && assignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 border border-gray-700/30">
            <div>
              <h2 className="text-lg font-bold text-white">{t('owner.assignAdminModal')}</h2>
              <p className="text-sm text-gray-400 mt-1">
                {t('empresas.title')}: <span className="text-white font-medium">{assignTarget.nombre}</span>
              </p>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-gray-700/40 rounded-lg p-1">
              {(['existing', 'create'] as AssignMode[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setAssignMode(m); setFormError(null); }}
                  className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
                    assignMode === m
                      ? 'bg-brand-500 text-brand-ink'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {m === 'existing' ? t('owner.existingUser') : t('owner.createNewUser')}
                </button>
              ))}
            </div>

            {formError && (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">{formError}</div>
            )}

            {assignMode === 'existing' ? (
              <form onSubmit={handleAssignExisting} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">{t('owner.selectUser')}</label>
                  <select
                    value={selectedUserId}
                    onChange={e => setSelectedUserId(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— seleccionar —</option>
                    {usuarios.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.nombre} ({u.email}) — {u.rol}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3">
                  <Button type="submit" loading={saving} className="flex-1">
                    {t('owner.assignAdmin')}
                  </Button>
                  <Button variant="ghost" onClick={closeModal}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleCreateAndAssign} className="space-y-3">
                {([
                  ['nombre',   `${t('common.name')} *`,     'text'],
                  ['email',    `${t('common.email')} *`,    'email'],
                  ['password', `${t('common.password')} *`, 'password'],
                ] as [keyof typeof newUserForm, string, string][]).map(([name, label, type]) => (
                  <div key={name}>
                    <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
                    <input
                      name={name}
                      type={type}
                      value={newUserForm[name]}
                      onChange={e => setNewUserForm(prev => ({ ...prev, [e.target.name]: e.target.value }))}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                ))}
                <div className="flex gap-3 pt-1">
                  <Button type="submit" loading={saving} className="flex-1">
                    {t('owner.createAndAssign')}
                  </Button>
                  <Button variant="ghost" onClick={closeModal}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Modal: create / edit empresa ── */}
      {(modal === 'create' || modal === 'edit') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5 border border-gray-700/30">
            <h2 className="text-lg font-bold text-white">
              {modal === 'create' ? t('empresas.createTitle') : t('empresas.editTitle')}
            </h2>

            {formError && (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">{formError}</div>
            )}

            <form onSubmit={modal === 'create' ? handleCreate : handleUpdate} className="space-y-4">
              {fields.map(([name, label, type]) => (
                <div key={name}>
                  <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
                  <input
                    name={name}
                    type={type}
                    value={form[name] ?? ''}
                    onChange={handleChange}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}

              <div className="flex gap-3 pt-2">
                <Button type="submit" loading={saving} className="flex-1">
                  {modal === 'create' ? t('empresas.create') : t('common.save')}
                </Button>
                <Button variant="ghost" onClick={closeModal}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
