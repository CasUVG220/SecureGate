import { useEffect, useState } from 'react';
import {
  getPreautorizaciones,
  createPreautorizacion,
  deletePreautorizacion,
  getResidentes,
  type Preautorizacion,
  type Residente,
} from '../services/api';

const EMPTY_FORM = {
  residente_id: '',
  nombre_visitante: '',
  numero_dpi: '',
  fecha_inicio: '',
  fecha_fin: '',
};

export default function PreautPage() {
  const [preauths, setPreauths]       = useState<Preautorizacion[]>([]);
  const [residentes, setResidentes]   = useState<Residente[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [showModal, setShowModal]     = useState(false);
  const [form, setForm]               = useState(EMPTY_FORM);
  const [saving, setSaving]           = useState(false);
  const [formError, setFormError]     = useState<string | null>(null);
  const [deletingId, setDeletingId]   = useState<string | null>(null);

  const cargarPreauths = () => {
    setLoading(true);
    getPreautorizaciones()
      .then(setPreauths)
      .catch(() => setError('No se pudo cargar la lista de preautorizaciones.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    cargarPreauths();
    getResidentes().then(setResidentes).catch(() => {/* silencioso */});
  }, []);

  const abrirModal = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowModal(true);
  };

  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.residente_id || !form.nombre_visitante || !form.fecha_inicio) {
      setFormError('Residente, nombre del visitante y fecha de inicio son obligatorios.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await createPreautorizacion({
        residente_id:    form.residente_id,
        nombre_visitante: form.nombre_visitante,
        numero_dpi:      form.numero_dpi   || undefined,
        fecha_inicio:    form.fecha_inicio,
        fecha_fin:       form.fecha_fin    || undefined,
      });
      setShowModal(false);
      cargarPreauths();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error al crear preautorización');
    } finally {
      setSaving(false);
    }
  };

  const handleEliminar = async (id: string) => {
    if (!window.confirm('¿Eliminar esta preautorización?')) return;
    setDeletingId(id);
    setError(null);
    try {
      await deletePreautorizacion(id);
      cargarPreauths();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al eliminar');
    } finally {
      setDeletingId(null);
    }
  };

  const formatFecha = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('es-GT') : '—';

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">SecureGate</h1>
          <p className="text-xs text-gray-400">Preautorizaciones</p>
        </div>
        <button
          onClick={abrirModal}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          + Nueva Preautorización
        </button>
      </header>

      <main className="px-6 py-8">
        {error && (
          <div className="mb-4 bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
          {loading ? (
            <p className="text-gray-400 text-sm text-center py-12">Cargando preautorizaciones...</p>
          ) : preauths.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-12">
              No hay preautorizaciones activas.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Casa</th>
                  <th className="px-4 py-3 font-medium">Nombre visitante</th>
                  <th className="px-4 py-3 font-medium">DPI</th>
                  <th className="px-4 py-3 font-medium">Desde</th>
                  <th className="px-4 py-3 font-medium">Hasta</th>
                  <th className="px-4 py-3 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {preauths.map(p => (
                  <tr key={p.id} className="border-b border-gray-700 last:border-0">
                    <td className="px-4 py-3 font-medium">{p.numero_casa}</td>
                    <td className="px-4 py-3">{p.nombre_visitante}</td>
                    <td className="px-4 py-3 text-gray-400">{p.numero_dpi ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-300">{formatFecha(p.fecha_inicio)}</td>
                    <td className="px-4 py-3 text-gray-300">{formatFecha(p.fecha_fin)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleEliminar(p.id)}
                        disabled={deletingId === p.id}
                        className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 font-medium transition-colors"
                      >
                        {deletingId === p.id ? '...' : 'Eliminar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-gray-800 rounded-2xl p-8 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-6">Nueva Preautorización</h2>

            {formError && (
              <div className="mb-4 bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-red-700 text-sm">
                {formError}
              </div>
            )}

            <form onSubmit={handleCrear} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Residente *</label>
                <select
                  name="residente_id"
                  value={form.residente_id}
                  onChange={handleFormChange}
                  required
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="">Seleccionar residente...</option>
                  {residentes.map(r => (
                    <option key={r.id} value={r.id}>
                      Casa {r.numero_casa} — {r.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Nombre del visitante *</label>
                <input
                  name="nombre_visitante"
                  value={form.nombre_visitante}
                  onChange={handleFormChange}
                  required
                  placeholder="Juan Pérez"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Número de DPI <span className="text-gray-500">(opcional)</span>
                </label>
                <input
                  name="numero_dpi"
                  value={form.numero_dpi}
                  onChange={handleFormChange}
                  placeholder="1234567890101"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Desde *</label>
                  <input
                    type="date"
                    name="fecha_inicio"
                    value={form.fecha_inicio}
                    onChange={handleFormChange}
                    required
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">
                    Hasta <span className="text-gray-500">(opcional)</span>
                  </label>
                  <input
                    type="date"
                    name="fecha_fin"
                    value={form.fecha_fin}
                    onChange={handleFormChange}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors"
                >
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  disabled={saving}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
