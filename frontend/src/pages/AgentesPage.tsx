import { useEffect, useMemo, useState } from 'react';
import {
  getUsuarios, createUsuario, updateUsuario, desactivarUsuario, restablecerDosPasos, decodeTokenPayload, type Usuario,
} from '../services/api';
import { TableSkeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n/useTranslation';
import { Button, Input, Modal, PasswordInput, ROW_ICON, RowActions, Select, StatusText, useConfirmacion } from '../components/ui';
import { rellenar } from '../components/charts/format';

const EMPTY_AGENT = { nombre: '', email: '', password: '' };

/** Roles entre los que se puede mover a alguien del personal (ver `updateUsuario` en el backend). */
const ROLES_EDITABLES = ['agente', 'admin_sucursal'];

interface EdicionForm { nombre: string; email: string; rol: string; password: string }

export default function AgentesPage() {
  const showToast = useToast();
  const { t } = useTranslation();
  const { confirmar, dialogo: dialogoConfirmar } = useConfirmacion();

  const [agentes, setAgentes] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState('');
  const [showForm, setShowForm] = useState(false);
  const [agentForm, setAgentForm] = useState(EMPTY_AGENT);
  const [saving, setSaving] = useState(false);

  const [editando, setEditando] = useState<Usuario | null>(null);
  const [editForm, setEditForm] = useState<EdicionForm>({ nombre: '', email: '', rol: 'agente', password: '' });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [baja, setBaja] = useState<Usuario | null>(null);
  const [bajaError, setBajaError] = useState<string | null>(null);
  const [bajaSaving, setBajaSaving] = useState(false);

  // Nadie se edita ni se da de baja a sí mismo (el backend también lo rechaza).
  const miId = useMemo(() => {
    const payload = decodeTokenPayload(localStorage.getItem('token') ?? '');
    return typeof payload?.id === 'string' ? payload.id : null;
  }, []);

  const rolLabel = (rol: string): string => {
    const clave: Record<string, string> = {
      agente: 'agents.roleAgent', admin_sucursal: 'agents.roleBranchAdmin',
      admin_empresa: 'agents.roleCompanyAdmin', owner: 'agents.roleOwner', residente: 'agents.roleResident',
    };
    return clave[rol] ? t(clave[rol]) : rol.replace('_', ' ');
  };

  const cargar = () => {
    setLoading(true);
    getUsuarios()
      .then(data => setAgentes(data))
      .catch(() => setError(t('agents.loadError')))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, []);

  const handleAgentChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setAgentForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const cancelForm = () => {
    setShowForm(false);
    setAgentForm(EMPTY_AGENT);
    setError(null);
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createUsuario({
        nombre: agentForm.nombre,
        email: agentForm.email,
        password: agentForm.password,
        rol: 'agente',
      });
      cancelForm();
      cargar();
      showToast(t('residents.agentCreated') || 'Agente creado');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al crear agente');
    } finally {
      setSaving(false);
    }
  };

  // ── Editar ──────────────────────────────────────────────────────────────
  const abrirEdicion = (u: Usuario) => {
    setEditando(u);
    setEditForm({ nombre: u.nombre, email: u.email, rol: u.rol, password: '' });
    setEditError(null);
  };
  const cerrarEdicion = () => { if (!editSaving) setEditando(null); };

  const guardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editando) return;
    // Solo viaja lo que cambió; la contraseña vacía significa «conservar la actual».
    const cambios: Parameters<typeof updateUsuario>[1] = {};
    if (editForm.nombre.trim() !== editando.nombre) cambios.nombre = editForm.nombre.trim();
    if (editForm.email.trim().toLowerCase() !== editando.email) cambios.email = editForm.email.trim();
    if (ROLES_EDITABLES.includes(editando.rol) && editForm.rol !== editando.rol) cambios.rol = editForm.rol;
    if (editForm.password) cambios.password = editForm.password;
    if (Object.keys(cambios).length === 0) { setEditando(null); return; }

    setEditSaving(true);
    setEditError(null);
    try {
      await updateUsuario(editando.id, cambios);
      setEditando(null);
      cargar();
      showToast(t('agents.saved'));
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Error al editar usuario');
    } finally {
      setEditSaving(false);
    }
  };

  // ── Dar de baja ─────────────────────────────────────────────────────────
  const cerrarBaja = () => { if (!bajaSaving) setBaja(null); };

  const confirmarBaja = async () => {
    if (!baja) return;
    setBajaSaving(true);
    setBajaError(null);
    try {
      await desactivarUsuario(baja.id);
      setBaja(null);
      cargar();
      showToast(t('agents.deactivated'));
    } catch (err: unknown) {
      setBajaError(err instanceof Error ? err.message : 'Error al dar de baja');
    } finally {
      setBajaSaving(false);
    }
  };

  // ── Restablecer la verificación en dos pasos (SCRUM-123) ─────────────────
  // Para quien perdió el teléfono y los códigos de recuperación. Le borra el segundo factor y le cierra las sesiones.
  const restablecerVerificacion = async (u: Usuario) => {
    const ok = await confirmar({
      title: rellenar(t('agents.twofaResetTitle'), { nombre: u.nombre }),
      message: t('agents.twofaResetBody'),
      confirmLabel: t('agents.twofaResetConfirm'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await restablecerDosPasos(u.id);
      cargar();
      showToast(t('agents.twofaResetDone'));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('twofa.err.generic'));
    }
  };

  const filtered = agentes.filter(a => {
    const q = search.toLowerCase();
    return (`${a.nombre} ${a.email} ${a.rol} ${rolLabel(a.rol)}`).toLowerCase().includes(q);
  });

  const puedeGestionar = (a: Usuario) => a.activo && a.id !== miId && a.rol !== 'owner';

  return (
    <div className="sg-page text-gray-100">
      {error && (
        <div className="bg-danger-900/40 border border-danger-700 rounded-lg px-4 py-3 text-danger-300 text-sm">{error}</div>
      )}

      <div className="sg-panel-heading">
        <div>
          <p className="sg-eyebrow">SecureGate · Personal operativo</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">Personal y agentes</h1>
          <p className="mt-1 text-sm text-gray-400">Gestiona quién está listo para proteger la operación de tu comunidad.</p>
        </div>
        {!loading && <span className="sg-status bg-success-500/10 text-success-400">{filtered.length} registrados</span>}
      </div>

      {/* Create agent form */}
      {showForm && (
        <form onSubmit={handleCreateAgent} className="sg-card space-y-4 p-5 sm:p-7">
          <h2 className="font-bold text-white text-lg">{t('residents.createAgentTitle') || 'Nuevo Agente'}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input name="nombre" label={t('common.name')} required value={agentForm.nombre} onChange={handleAgentChange} />
            <Input name="email" type="email" label={t('common.email')} required value={agentForm.email} onChange={handleAgentChange} />
            <PasswordInput
              name="password"
              label={t('common.password')}
              required
              minLength={8}
              value={agentForm.password}
              onChange={handleAgentChange}
              wrapperClassName="sm:col-span-2"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <Button type="submit" loading={saving}>
              {saving ? t('common.saving') : t('common.create')}
            </Button>
            <Button variant="ghost" onClick={cancelForm}>{t('common.cancel')}</Button>
          </div>
        </form>
      )}

      {/* Action bar */}
      {!showForm && (
        <div className="sg-card space-y-3 p-5 sm:p-6">
          <div className="flex justify-between items-center">
            <h1 className="text-xl font-bold text-white">
              Personal / Agentes
              {!loading && <span className="ml-2 text-sm font-normal text-gray-400">({filtered.length})</span>}
            </h1>
            <Button onClick={() => { setShowForm(true); setError(null); }}>
              {t('residents.newAgent') || 'Nuevo Agente'}
            </Button>
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email o rol…"
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 text-sm focus:outline-none focus:border-brand-500 transition-colors"
          />
        </div>
      )}

      {/* Table */}
      <div className="sg-table-wrap overflow-hidden">
        {!loading && filtered.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-10">No hay personal registrado</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-5 py-3 font-medium">{t('common.name')}</th>
                <th className="px-5 py-3 font-medium">{t('common.email')}</th>
                <th className="px-5 py-3 font-medium">{t('agents.role')}</th>
                <th className="px-5 py-3 font-medium">Estado</th>
                <th className="px-5 py-3 font-medium text-right">{t('agents.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={4} cols={5} />
              ) : (
                filtered.map((a, i) => (
                  <tr key={a.id} className={`border-b border-gray-700 last:border-0 ${i % 2 === 1 ? 'bg-gray-700/20' : ''}`}>
                    <td className="px-5 py-3 font-semibold text-white">{a.nombre}</td>
                    <td className="px-5 py-3 text-gray-400">
                      {a.email}
                      {a.dos_pasos && <span className="mt-0.5 block text-xs text-gray-500">{t('agents.twofaOn')}</span>}
                    </td>
                    <td className="px-5 py-3 text-gray-200">{rolLabel(a.rol)}</td>
                    <td className="px-5 py-3">
                      <StatusText kind={a.activo ? 'on' : 'off'}>
                        {a.activo ? t('agents.statusActive') : t('agents.statusInactive')}
                      </StatusText>
                    </td>
                    <td className="px-5 py-3">
                      {puedeGestionar(a) && (
                        <RowActions
                          inline={0}
                          menuLabel={`${t('agents.menuLabel')} ${a.nombre}`}
                          actions={[
                            { id: 'editar', label: t('agents.edit'), icon: ROW_ICON.edit, onClick: () => abrirEdicion(a) },
                            ...(a.dos_pasos
                              ? [{ id: 'dos-pasos', label: t('agents.twofaReset'), icon: ROW_ICON.history, onClick: () => void restablecerVerificacion(a) }]
                              : []),
                            { id: 'baja', label: t('agents.deactivate'), icon: ROW_ICON.pause, tone: 'danger', onClick: () => { setBaja(a); setBajaError(null); } },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal: editar */}
      <Modal
        open={editando !== null}
        onClose={cerrarEdicion}
        dismissible={!editSaving}
        title={t('agents.editTitle')}
        description={t('agents.editDesc')}
        footer={
          <>
            <Button variant="ghost" onClick={cerrarEdicion} disabled={editSaving}>{t('common.cancel')}</Button>
            <Button type="submit" form="form-editar-personal" loading={editSaving}>
              {editSaving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="form-editar-personal" onSubmit={guardarEdicion} className="space-y-4">
          {editError && (
            <p role="alert" className="rounded-lg border border-danger-500/40 bg-danger-500/10 px-3 py-2 text-sm text-danger-400">
              {editError}
            </p>
          )}
          <Input
            label={t('common.name')} required value={editForm.nombre} maxLength={100}
            onChange={e => setEditForm(f => ({ ...f, nombre: e.target.value }))}
          />
          <Input
            label={t('common.email')} type="email" required value={editForm.email} maxLength={150}
            onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
          />
          {editando && ROLES_EDITABLES.includes(editando.rol) ? (
            <Select
              label={t('agents.role')} value={editForm.rol}
              onChange={e => setEditForm(f => ({ ...f, rol: e.target.value }))}
            >
              <option value="agente">{t('agents.roleAgent')}</option>
              <option value="admin_sucursal">{t('agents.roleBranchAdmin')}</option>
            </Select>
          ) : editando && (
            <Input label={t('agents.role')} value={rolLabel(editando.rol)} readOnly disabled hint={t('agents.roleLocked')} />
          )}
          <PasswordInput
            label={t('agents.newPassword')}
            value={editForm.password}
            onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))}
            requisitos={editForm.password.length > 0}
            hint={t('agents.newPasswordHint')}
            autoComplete="new-password"
          />
        </form>
      </Modal>

      {/* Modal: dar de baja */}
      <Modal
        open={baja !== null}
        onClose={cerrarBaja}
        dismissible={!bajaSaving}
        size="sm"
        title={t('agents.deactivateTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={cerrarBaja} disabled={bajaSaving}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={confirmarBaja} loading={bajaSaving}>{t('agents.deactivateConfirm')}</Button>
          </>
        }
      >
        {baja && (
          <div className="space-y-3 text-sm text-gray-300">
            <p><strong className="text-gray-50">{baja.nombre}</strong> ({baja.email}) {t('agents.deactivateBody')}</p>
            {bajaError && (
              <p role="alert" className="rounded-lg border border-danger-500/40 bg-danger-500/10 px-3 py-2 text-danger-400">
                {bajaError}
              </p>
            )}
          </div>
        )}
      </Modal>

      {dialogoConfirmar}
    </div>
  );
}
