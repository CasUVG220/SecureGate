import { useEffect, useState } from 'react';
import {
  getSucursales, createSucursal, updateSucursal, deleteSucursal, assignAdminSucursal,
  getUsuarios, createUsuario, deleteUsuario,
  type Sucursal, type SucursalInput, type Usuario,
} from '../../services/api';
import { Spinner, TableSkeleton } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { decodeTokenPayload } from '../../services/api';
import { useTranslation } from '../../i18n/useTranslation';

type Modal = 'none' | 'sucursal' | 'admin' | 'usuario';

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

  useEffect(() => { cargar(); }, []);

  const closeModal = () => {
    setModal('none');
    setEditSuc(null);
    setAdminTarget(null);
    setModalError(null);
  };

  // ── Sucursal modals ──────────────────────────────────────────────────────

  const openCreateSuc = () => {
    setSucForm({ ...EMPTY_SUC, empresa_id: empresaId });
    setEditSuc(null);
    setModalError(null);
    setModal('sucursal');
  };

  const openEditSuc = (suc: Sucursal) => {
    setEditSuc(suc);
    setSucForm({ empresa_id: suc.empresa_id, nombre: suc.nombre, direccion: suc.direccion ?? '', tipo: suc.tipo ?? '' });
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
      } else {
        await createSucursal({
          empresa_id: empresaId,
          nombre:     sucForm.nombre,
          direccion:  sucForm.direccion || undefined,
          tipo:       sucForm.tipo      || undefined,
        });
        showToast(t('ae.branchCreated'));
      }
      closeModal();
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
    if (!window.confirm(`${t('ae.confirmDeleteSucursal')} "${suc.nombre}"?`)) return;
    try {
      await deleteSucursal(suc.id);
      cargar();
      showToast(t('ae.sucursalDeleted'), 'warning');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al eliminar sucursal', 'error');
    }
  };

  const handleDeleteUsuario = async (u: Usuario) => {
    if (!window.confirm(`${t('ae.confirmDeleteUser')} "${u.nombre}"?`)) return;
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

  const staffUsuarios = usuarios.filter(u => {
    if (u.rol === 'residente') return false;
    if (staffFilter === 'all') return true;
    return u.rol === staffFilter;
  });

  return (
    <div className="p-6 text-gray-100 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-white">{t('ae.managementTitle')}</h1>
        <div className="flex gap-2">
          <button
            onClick={openUserModal}
            className="flex items-center gap-2 bg-green-700 hover:bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {t('ae.newUser')}
          </button>
          <button
            onClick={openCreateSuc}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {t('ae.newBranch')}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      {/* Sucursales table */}
      <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700">
          <h2 className="text-base font-semibold text-white">{t('ae.branchesSection')}</h2>
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
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                    {t('ae.noBranches')}
                  </td>
                </tr>
              ) : (
                sucursales.map(suc => (
                  <tr key={suc.id} className="border-b border-gray-700 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{suc.nombre}</p>
                      {suc.direccion && <p className="text-xs text-gray-500">{suc.direccion}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{suc.tipo ?? '—'}</td>
                    <td className="px-4 py-3 text-center">{suc.total_residentes}</td>
                    <td className="px-4 py-3 text-center">{suc.total_agentes}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${
                        suc.activo ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'
                      }`}>
                        {suc.activo ? t('common.activeF') : t('common.inactiveF')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => openEditSuc(suc)}
                          className="text-blue-400 hover:text-blue-300 text-xs font-medium transition-colors"
                        >
                          {t('common.edit')}
                        </button>
                        <span className="text-gray-600">·</span>
                        <button
                          onClick={() => openAdminModal(suc)}
                          className="text-teal-400 hover:text-teal-300 text-xs font-medium transition-colors"
                        >
                          {t('empDetail.assignAdmin')}
                        </button>
                        <span className="text-gray-600">·</span>
                        <button
                          onClick={() => handleToggle(suc)}
                          className={`text-xs font-medium transition-colors ${
                            suc.activo
                              ? 'text-amber-400 hover:text-amber-300'
                              : 'text-green-400 hover:text-green-300'
                          }`}
                        >
                          {suc.activo ? t('common.deactivate') : t('common.activate')}
                        </button>
                        <span className="text-gray-600">·</span>
                        <button
                          onClick={() => handleDeleteSucursal(suc)}
                          className="text-red-400 hover:text-red-300 text-xs font-medium transition-colors"
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Staff users table */}
      <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-base font-semibold text-white">{t('ae.staffSection')}</h2>
          <div className="flex gap-1 bg-gray-700/50 rounded-lg p-1">
            {(['all', 'agente', 'admin_sucursal'] as const).map(f => (
              <button
                key={f}
                onClick={() => setStaffFilter(f)}
                className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                  staffFilter === f
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {f === 'all' ? t('ae.filterAll') : f === 'agente' ? t('ae.filterAgents') : t('ae.filterAdmins')}
              </button>
            ))}
          </div>
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
                      <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${
                        u.activo ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'
                      }`}>
                        {u.activo ? t('common.active') : t('common.inactive')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDeleteUsuario(u)}
                        className="text-red-400 hover:text-red-300 text-xs font-medium transition-colors"
                      >
                        {t('common.delete')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Modal: create / edit sucursal ── */}
      {modal === 'sucursal' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
            <h2 className="text-lg font-bold text-white">
              {editSuc ? t('ae.editBranch') : t('ae.newBranchModal')}
            </h2>
            {modalError && (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">{modalError}</div>
            )}
            <form onSubmit={handleSucSubmit} className="space-y-4">
              {([
                ['nombre',    `${t('common.name')} *`,    'text'],
                ['tipo',      t('empDetail.tipo'),         'text'],
                ['direccion', t('empDetail.direction'),    'text'],
              ] as [keyof SucursalInput, string, string][]).map(([name, label, type]) =>
                name !== 'empresa_id' && (
                  <div key={name}>
                    <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
                    <input
                      name={name}
                      type={type}
                      value={(sucForm[name] as string) ?? ''}
                      onChange={handleSucChange}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {saving && <Spinner size={14} />}
                  {editSuc ? t('common.save') : t('ae.createBranch')}
                </button>
                <button type="button" onClick={closeModal}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: asignar admin ── */}
      {modal === 'admin' && adminTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
            <h2 className="text-lg font-bold text-white">{t('ae.assignAdminModal')}</h2>
            <p className="text-sm text-gray-400">
              {t('ae.branchLabel')}: <span className="text-white font-medium">{adminTarget.nombre}</span>
            </p>
            {modalError && (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">{modalError}</div>
            )}
            <form onSubmit={handleAssignAdmin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">{t('ae.selectUser')}</label>
                <select
                  value={adminUserId}
                  onChange={e => setAdminUserId(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">{t('ae.selectUser')}</option>
                  {usuarios.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.nombre} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {saving && <Spinner size={14} />} {t('ae.assign')}
                </button>
                <button type="button" onClick={closeModal}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: crear usuario ── */}
      {modal === 'usuario' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
            <h2 className="text-lg font-bold text-white">{t('ae.newUserModal')}</h2>
            {modalError && (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">{modalError}</div>
            )}
            <form onSubmit={handleCreateUsuario} className="space-y-4">
              {([
                ['nombre',   `${t('common.name')} *`,     'text'],
                ['email',    `${t('common.email')} *`,    'email'],
                ['password', `${t('common.password')} *`, 'password'],
              ] as [keyof UsuarioForm, string, string][]).map(([name, label, type]) => (
                <div key={name}>
                  <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
                  <input
                    name={name}
                    type={type}
                    value={usrForm[name]}
                    onChange={handleUsrChange}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">{t('common.role')} *</label>
                <select
                  name="rol"
                  value={usrForm.rol}
                  onChange={handleUsrChange}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="agente">{t('ae.agentRole')}</option>
                  <option value="admin_sucursal">{t('ae.adminSucRole')}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">{t('ae.branchLabel')}</label>
                <select
                  name="sucursal_id"
                  value={usrForm.sucursal_id}
                  onChange={handleUsrChange}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">{t('ae.noAssigned')}</option>
                  {sucursales.filter(s => s.activo).map(s => (
                    <option key={s.id} value={s.id}>{s.nombre}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {saving && <Spinner size={14} />} {t('ae.createUser')}
                </button>
                <button type="button" onClick={closeModal}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
