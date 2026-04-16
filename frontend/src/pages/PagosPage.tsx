import { useEffect, useState } from 'react';
import {
  getPagos,
  createPago,
  aprobarPago,
  rechazarPago,
  getResidentes,
  type Pago,
  type Residente,
} from '../services/api';

const BADGE: Record<Pago['estado'], string> = {
  aprobado:  'bg-green-100  text-green-700',
  pendiente: 'bg-yellow-100 text-yellow-700',
  rechazado: 'bg-red-100    text-red-700',
};

const LABEL: Record<Pago['estado'], string> = {
  aprobado:  'Aprobado',
  pendiente: 'Pendiente',
  rechazado: 'Rechazado',
};

const METODO_LABEL: Record<Pago['metodo'], string> = {
  efectivo:     'Efectivo',
  transferencia: 'Transferencia',
};

const EMPTY_FORM = { residente_id: '', monto: '' };

export default function PagosPage() {
  const [pagos, setPagos]             = useState<Pago[]>([]);
  const [residentes, setResidentes]   = useState<Residente[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [showModal, setShowModal]     = useState(false);
  const [form, setForm]               = useState(EMPTY_FORM);
  const [saving, setSaving]           = useState(false);
  const [formError, setFormError]     = useState<string | null>(null);
  const [actionId, setActionId]       = useState<string | null>(null);

  const cargarPagos = () => {
    setLoading(true);
    getPagos()
      .then(setPagos)
      .catch(() => setError('No se pudo cargar la lista de pagos.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    cargarPagos();
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
    if (!form.residente_id || !form.monto) {
      setFormError('Selecciona un residente e ingresa el monto.');
      return;
    }
    const monto = parseFloat(form.monto);
    if (isNaN(monto) || monto <= 0) {
      setFormError('El monto debe ser un número mayor a 0.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await createPago({ residente_id: form.residente_id, monto });
      setShowModal(false);
      cargarPagos();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error al registrar pago');
    } finally {
      setSaving(false);
    }
  };

  const handleAprobar = async (id: string) => {
    setActionId(id);
    try {
      await aprobarPago(id);
      cargarPagos();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al aprobar pago');
    } finally {
      setActionId(null);
    }
  };

  const handleRechazar = async (id: string) => {
    setActionId(id);
    try {
      await rechazarPago(id);
      cargarPagos();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al rechazar pago');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">SecureGate</h1>
          <p className="text-xs text-gray-400">Gestión de Pagos</p>
        </div>
        <button
          onClick={abrirModal}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          + Registrar Pago en Efectivo
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
            <p className="text-gray-400 text-sm text-center py-12">Cargando pagos...</p>
          ) : pagos.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-12">No hay pagos registrados.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Casa</th>
                  <th className="px-4 py-3 font-medium">Residente</th>
                  <th className="px-4 py-3 font-medium">Monto</th>
                  <th className="px-4 py-3 font-medium">Método</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pagos.map(p => (
                  <tr key={p.id} className="border-b border-gray-700 hover:bg-gray-750 last:border-0">
                    <td className="px-4 py-3 font-medium">{p.numero_casa}</td>
                    <td className="px-4 py-3 text-gray-300">{p.residente_nombre}</td>
                    <td className="px-4 py-3 font-semibold">Q{parseFloat(p.monto).toFixed(2)}</td>
                    <td className="px-4 py-3 text-gray-300">{METODO_LABEL[p.metodo]}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${BADGE[p.estado]}`}>
                        {LABEL[p.estado]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(p.fecha_pago).toLocaleDateString('es-GT')}
                    </td>
                    <td className="px-4 py-3 flex gap-2">
                      {p.estado === 'pendiente' && (
                        <>
                          <button
                            onClick={() => handleAprobar(p.id)}
                            disabled={actionId === p.id}
                            className="text-xs text-green-400 hover:text-green-300 disabled:opacity-50 font-medium transition-colors"
                          >
                            {actionId === p.id ? '...' : 'Aprobar'}
                          </button>
                          <button
                            onClick={() => handleRechazar(p.id)}
                            disabled={actionId === p.id}
                            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 font-medium transition-colors"
                          >
                            Rechazar
                          </button>
                        </>
                      )}
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
            <h2 className="text-lg font-bold text-white mb-6">Registrar Pago en Efectivo</h2>

            {formError && (
              <div className="mb-4 bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-red-700 text-sm">
                {formError}
              </div>
            )}

            <form onSubmit={handleCrear} className="space-y-5">
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
                <label className="block text-sm text-gray-300 mb-1">Monto (Q) *</label>
                <input
                  type="number"
                  name="monto"
                  value={form.monto}
                  onChange={handleFormChange}
                  required
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors"
                />
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