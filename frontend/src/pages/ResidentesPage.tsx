import { useEffect, useState } from 'react';
import {
  getResidentes,
  createResidente,
  updateResidente,
  deleteResidente,
  decodeTokenPayload,
  type Residente,
  type ResidenteInput,
  type ResidenteUpdate,
} from '../services/api';

type FormMode = 'none' | 'create' | 'edit';

const EMPTY_CREATE: ResidenteInput = {
  nombre: '', email: '', password: '', numero_casa: '', telefono: '',
};
const EMPTY_UPDATE: ResidenteUpdate = {
  numero_casa: '', estado_pago: '', telefono: '', saldo_pendiente: 0,
};

const BADGE: Record<string, string> = {
  al_dia:   'bg-green-100 text-green-700',
  mora:     'bg-red-100 text-red-700',
  pendiente:'bg-yellow-100 text-yellow-700',
};
const BADGE_LABEL: Record<string, string> = {
  al_dia: 'Al día', mora: 'Mora', pendiente: 'Pendiente',
};

export default function ResidentesPage() {
  const [residentes, setResidentes]   = useState<Residente[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [formMode, setFormMode]       = useState<FormMode>('none');
  const [editTarget, setEditTarget]   = useState<Residente | null>(null);
  const [createForm, setCreateForm]   = useState<ResidenteInput>(EMPTY_CREATE);
  const [updateForm, setUpdateForm]   = useState<ResidenteUpdate>(EMPTY_UPDATE);
  const [saving, setSaving]           = useState(false);
  const [sinSesion, setSinSesion]     = useState(false);
  const [usuarioNombre, setUsuarioNombre] = useState('');

  const cargarResidentes = () => {
    setLoading(true);
    getResidentes()
      .then(setResidentes)
      .catch(() => setError('No se pudo cargar la lista de residentes.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setSinSesion(true); setLoading(false); return; }
    const payload = decodeTokenPayload(token);
    if (payload) setUsuarioNombre((payload.nombre as string) || '');
    cargarResidentes();
  }, []);

  const handleCreateChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setCreateForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleUpdateChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => setUpdateForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const openEdit = (r: Residente) => {
    setEditTarget(r);
    setUpdateForm({
      numero_casa: r.numero_casa,
      estado_pago: r.estado_pago,
      telefono: r.telefono || '',
      saldo_pendiente: parseFloat(r.saldo_pendiente),
    });
    setFormMode('edit');
    setError(null);
  };

  const cancelForm = () => {
    setFormMode('none');
    setEditTarget(null);
    setCreateForm(EMPTY_CREATE);
    setUpdateForm(EMPTY_UPDATE);
    setError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createResidente(createForm);
      cancelForm();
      cargarResidentes();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al crear residente');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setSaving(true);
    setError(null);
    try {
      await updateResidente(editTarget.id, updateForm);
      cancelForm();
      cargarResidentes();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al actualizar residente');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: Residente) => {
    if (!window.confirm(`¿Eliminar al residente de la casa ${r.numero_casa}?`)) return;
    setError(null);
    try {
      await deleteResidente(r.id);
      cargarResidentes();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al eliminar residente');
    }
  };

  if (sinSesion) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="bg-red-50 border border-red-300 rounded-xl p-8 text-center max-w-sm">
          <p className="text-red-700 font-semibold text-lg">Sesión no iniciada</p>
          <p className="text-red-600 text-sm mt-2">Inicia sesión para acceder al panel de administración.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">SecureGate</h1>
          <p className="text-xs text-gray-400">Gestión de Residentes</p>
        </div>
        {usuarioNombre && (
          <span className="text-sm text-gray-300">
            Admin: <span className="font-medium text-white">{usuarioNombre}</span>
          </span>
        )}
      </header>

      <main className="flex-1 px-6 py-8 max-w-5xl mx-auto w-full">

        {/* Error banner */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Create form */}
        {formMode === 'create' && (
          <form onSubmit={handleCreate} className="bg-gray-800 rounded-2xl p-6 mb-6 space-y-4">
            <h2 className="font-bold text-white text-lg">Nuevo residente</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {([
                ['nombre',     'Nombre completo', 'text',     true],
                ['email',      'Email',           'email',    true],
                ['password',   'Contraseña',      'password', true],
                ['numero_casa','Casa',             'text',     true],
                ['telefono',   'Teléfono',         'text',     false],
              ] as [keyof ResidenteInput, string, string, boolean][]).map(([name, label, type, req]) => (
                <div key={name}>
                  <label className="block text-sm text-gray-300 mb-1">{label}{req && ' *'}</label>
                  <input
                    name={name}
                    type={type}
                    value={createForm[name] ?? ''}
                    onChange={handleCreateChange}
                    required={req}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-6 py-2 rounded-xl transition-colors">
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
              <button type="button" onClick={cancelForm}
                className="text-gray-400 hover:text-gray-200 px-4 py-2 rounded-xl transition-colors">
                Cancelar
              </button>
            </div>
          </form>
        )}

        {/* Edit form */}
        {formMode === 'edit' && editTarget && (
          <form onSubmit={handleUpdate} className="bg-gray-800 rounded-2xl p-6 mb-6 space-y-4">
            <h2 className="font-bold text-white text-lg">
              Editar — Casa {editTarget.numero_casa}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Casa *</label>
                <input name="numero_casa" value={updateForm.numero_casa ?? ''}
                  onChange={handleUpdateChange} required
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors" />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Estado de pago</label>
                <select name="estado_pago" value={updateForm.estado_pago ?? ''}
                  onChange={handleUpdateChange}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors">
                  <option value="al_dia">Al día</option>
                  <option value="mora">Mora</option>
                  <option value="pendiente">Pendiente</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Teléfono</label>
                <input name="telefono" value={updateForm.telefono ?? ''}
                  onChange={handleUpdateChange}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors" />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Saldo pendiente (Q)</label>
                <input name="saldo_pendiente" type="number" min="0" step="0.01"
                  value={updateForm.saldo_pendiente ?? 0}
                  onChange={handleUpdateChange}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors" />
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-6 py-2 rounded-xl transition-colors">
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
              <button type="button" onClick={cancelForm}
                className="text-gray-400 hover:text-gray-200 px-4 py-2 rounded-xl transition-colors">
                Cancelar
              </button>
            </div>
          </form>
        )}

        {/* Action bar */}
        {formMode === 'none' && (
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-white font-semibold text-lg">
              Residentes
              {!loading && (
                <span className="ml-2 text-sm font-normal text-gray-400">
                  ({residentes.length})
                </span>
              )}
            </h2>
            <button onClick={() => { setFormMode('create'); setError(null); }}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2 rounded-xl transition-colors text-sm">
              + Nuevo residente
            </button>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <p className="text-gray-400 text-sm">Cargando...</p>
        ) : residentes.length === 0 ? (
          <div className="bg-gray-800 rounded-2xl p-8 text-center text-gray-400">
            No hay residentes registrados.
          </div>
        ) : (
          <div className="bg-gray-800 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-left">
                  <th className="px-5 py-3 font-medium">Casa</th>
                  <th className="px-5 py-3 font-medium">Nombre</th>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Estado</th>
                  <th className="px-5 py-3 font-medium">Saldo (Q)</th>
                  <th className="px-5 py-3 font-medium">Teléfono</th>
                  <th className="px-5 py-3 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {residentes.map((r, i) => (
                  <tr key={r.id}
                    className={`border-b border-gray-700 last:border-0 ${i % 2 === 1 ? 'bg-gray-750' : ''}`}>
                    <td className="px-5 py-3 font-semibold text-white">{r.numero_casa}</td>
                    <td className="px-5 py-3 text-gray-200">{r.nombre}</td>
                    <td className="px-5 py-3 text-gray-400">{r.email}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${BADGE[r.estado_pago] ?? 'bg-gray-600 text-gray-200'}`}>
                        {BADGE_LABEL[r.estado_pago] ?? r.estado_pago}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-300">{parseFloat(r.saldo_pendiente).toFixed(2)}</td>
                    <td className="px-5 py-3 text-gray-400">{r.telefono || '—'}</td>
                    <td className="px-5 py-3 flex gap-3">
                      <button onClick={() => openEdit(r)}
                        className="text-blue-400 hover:text-blue-300 transition-colors">
                        Editar
                      </button>
                      <button onClick={() => handleDelete(r)}
                        className="text-red-400 hover:text-red-300 transition-colors">
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}