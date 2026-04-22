import { useEffect, useState } from 'react';
import {
  getResidenteMe,
  getMisPreautorizaciones,
  createMisPreautorizacion,
  deleteMisPreautorizacion,
  getMisAccesos,
  type ResidenteMe,
  type MiPreautorizacion,
  type MiVisita,
} from '../services/api';

const BADGE: Record<string, string> = {
  al_dia:   'bg-green-100 text-green-700',
  mora:     'bg-red-100 text-red-700',
  pendiente:'bg-yellow-100 text-yellow-700',
};
const BADGE_LABEL: Record<string, string> = {
  al_dia: 'Al día', mora: 'Mora', pendiente: 'Pendiente',
};
const PAGO_CLASS: Record<string, string> = {
  pendiente: 'bg-yellow-100 text-yellow-700',
  aprobado:  'bg-green-100 text-green-700',
  rechazado: 'bg-red-100 text-red-700',
};
const PAGO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado',
};

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_FORM = { nombre_visitante: '', numero_dpi: '', placa: '', fecha_inicio: today(), fecha_fin: '' };

export default function ResidentePage() {
  const [data, setData]         = useState<ResidenteMe | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const [tab, setTab]           = useState<'pagos' | 'invitados'>('pagos');

  const [preauths, setPreauths] = useState<MiPreautorizacion[]>([]);
  const [visitas, setVisitas]   = useState<MiVisita[]>([]);
  const [invLoading, setInvLoading] = useState(false);
  const [invLoaded, setInvLoaded]   = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [tipo, setTipo]         = useState<'permanente' | 'temporal'>('permanente');
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    getResidenteMe()
      .then(setData)
      .catch(() => setError('No se pudo cargar tu información.'))
      .finally(() => setLoading(false));
  }, []);

  const loadInvitados = () => {
    if (invLoaded) return;
    setInvLoading(true);
    Promise.all([getMisPreautorizaciones(), getMisAccesos()])
      .then(([p, v]) => { setPreauths(p); setVisitas(v); setInvLoaded(true); })
      .catch(() => setError('No se pudo cargar la sección de invitados.'))
      .finally(() => setInvLoading(false));
  };

  const handleTabChange = (t: 'pagos' | 'invitados') => {
    setTab(t);
    if (t === 'invitados') loadInvitados();
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const payload: Parameters<typeof createMisPreautorizacion>[0] = {
        nombre_visitante: form.nombre_visitante,
        numero_dpi:       form.numero_dpi || undefined,
        placa:            form.placa || undefined,
        fecha_inicio:     form.fecha_inicio,
        fecha_fin:        tipo === 'temporal' ? form.fecha_fin || undefined : undefined,
      };
      const created = await createMisPreautorizacion(payload);
      setPreauths(prev => [created, ...prev]);
      setShowForm(false);
      setForm(EMPTY_FORM);
      setTipo('permanente');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, nombre: string) => {
    if (!window.confirm(`¿Eliminar la preautorización de ${nombre}?`)) return;
    setDeletingId(id);
    try {
      await deleteMisPreautorizacion(id);
      setPreauths(prev => prev.filter(p => p.id !== id));
    } catch {
      // silently ignore — the card stays
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Cargando...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="bg-red-50 border border-red-300 rounded-xl p-8 text-center max-w-sm">
          <p className="text-red-700 font-semibold">{error}</p>
        </div>
      </div>
    );
  }

  const saldo = parseFloat(data!.saldo_pendiente);

  return (
    <main className="px-6 py-8 space-y-6 max-w-3xl mx-auto">
      {/* Summary card */}
      <div className="bg-gray-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-gray-400 text-sm">Casa</p>
            <p className="text-3xl font-bold text-white mt-1">{data!.numero_casa}</p>
          </div>
          <span className={`mt-1 px-3 py-1 rounded-full text-sm font-semibold ${BADGE[data!.estado_pago] ?? 'bg-gray-600 text-gray-200'}`}>
            {BADGE_LABEL[data!.estado_pago] ?? data!.estado_pago}
          </span>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 gap-4">
          <div>
            <p className="text-gray-400 text-xs">Saldo pendiente</p>
            <p className={`text-xl font-semibold mt-0.5 ${saldo > 0 ? 'text-red-400' : 'text-green-400'}`}>
              Q{saldo.toFixed(2)}
            </p>
          </div>
          {data!.telefono && (
            <div>
              <p className="text-gray-400 text-xs">Teléfono</p>
              <p className="text-white text-sm mt-0.5">{data!.telefono}</p>
            </div>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 border-b border-gray-700 pb-0">
        {(['pagos', 'invitados'] as const).map(t => (
          <button
            key={t}
            onClick={() => handleTabChange(t)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              tab === t
                ? 'bg-gray-800 text-white border border-b-0 border-gray-700'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t === 'pagos' ? 'Mis pagos' : 'Invitados'}
          </button>
        ))}
      </div>

      {/* ── Tab: Pagos ── */}
      {tab === 'pagos' && (
        <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-700">
            <h2 className="text-base font-semibold text-white">Historial de pagos</h2>
          </div>
          {data!.pagos_recientes.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-10">No hay pagos registrados.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Monto</th>
                  <th className="px-4 py-3 font-medium">Método</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {data!.pagos_recientes.map(p => (
                  <tr key={p.id} className="border-b border-gray-700 last:border-0">
                    <td className="px-4 py-3 text-gray-300">
                      {new Date(p.fecha_pago).toLocaleDateString('es-GT')}
                    </td>
                    <td className="px-4 py-3 font-medium text-white">Q{parseFloat(p.monto).toFixed(2)}</td>
                    <td className="px-4 py-3 text-gray-300 capitalize">{p.metodo}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${PAGO_CLASS[p.estado] ?? 'bg-gray-600 text-gray-200'}`}>
                        {PAGO_LABEL[p.estado] ?? p.estado}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Tab: Invitados ── */}
      {tab === 'invitados' && (
        <div className="space-y-8">
          {invLoading ? (
            <p className="text-gray-400 text-sm text-center py-10">Cargando...</p>
          ) : (
            <>
              {/* Preautorizaciones */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-white">Mis preautorizaciones</h2>
                  {!showForm && (
                    <button
                      onClick={() => setShowForm(true)}
                      className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      + Nueva
                    </button>
                  )}
                </div>

                {/* Inline create form */}
                {showForm && (
                  <form onSubmit={handleSave} className="bg-gray-800 rounded-2xl p-6 mb-4 space-y-4 shadow-xl">
                    <h3 className="text-sm font-semibold text-white">Nueva preautorización</h3>

                    {formError && (
                      <div className="bg-red-50 border border-red-300 rounded-lg px-3 py-2 text-red-700 text-sm">
                        {formError}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="sm:col-span-3">
                        <label className="block text-xs text-gray-400 mb-1">Nombre *</label>
                        <input
                          name="nombre_visitante"
                          value={form.nombre_visitante}
                          onChange={handleFormChange}
                          required
                          placeholder="Juan Pérez"
                          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">DPI</label>
                        <input
                          name="numero_dpi"
                          value={form.numero_dpi}
                          onChange={handleFormChange}
                          placeholder="opcional"
                          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Placa</label>
                        <input
                          name="placa"
                          value={form.placa}
                          onChange={handleFormChange}
                          placeholder="opcional"
                          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Fecha inicio *</label>
                        <input
                          name="fecha_inicio"
                          type="date"
                          value={form.fecha_inicio}
                          onChange={handleFormChange}
                          required
                          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    {/* Tipo */}
                    <div className="flex gap-6">
                      {(['permanente', 'temporal'] as const).map(t => (
                        <label key={t} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="tipo"
                            value={t}
                            checked={tipo === t}
                            onChange={() => setTipo(t)}
                            className="accent-blue-500"
                          />
                          <span className="text-sm text-gray-300 capitalize">{t}</span>
                        </label>
                      ))}
                    </div>

                    {tipo === 'temporal' && (
                      <div className="w-full sm:w-48">
                        <label className="block text-xs text-gray-400 mb-1">Fecha fin *</label>
                        <input
                          name="fecha_fin"
                          type="date"
                          value={form.fecha_fin}
                          onChange={handleFormChange}
                          required
                          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    )}

                    <div className="flex gap-3 pt-1">
                      <button
                        type="submit"
                        disabled={saving}
                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
                      >
                        {saving ? 'Guardando...' : 'Guardar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowForm(false); setFormError(null); setForm(EMPTY_FORM); setTipo('permanente'); }}
                        className="bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium px-5 py-2 rounded-lg transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}

                {/* Cards */}
                {preauths.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-8">No hay preautorizaciones activas.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {preauths.map(p => (
                      <div key={p.id} className="bg-gray-800 rounded-xl p-4 shadow border border-gray-700">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-white text-sm">{p.nombre_visitante}</p>
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium shrink-0">
                            Activo
                          </span>
                        </div>
                        <div className="mt-2 space-y-0.5 text-xs text-gray-400">
                          {p.numero_dpi && <p>DPI: {p.numero_dpi}</p>}
                          {p.placa      && <p>Placa: {p.placa}</p>}
                          <p className="text-gray-300 mt-1">
                            {p.fecha_fin
                              ? `${new Date(p.fecha_inicio + 'T00:00:00').toLocaleDateString('es-GT')} – ${new Date(p.fecha_fin + 'T00:00:00').toLocaleDateString('es-GT')}`
                              : 'Permanente'}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDelete(p.id, p.nombre_visitante)}
                          disabled={deletingId === p.id}
                          className="mt-3 text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                        >
                          {deletingId === p.id ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Historial */}
              <section>
                <h2 className="text-base font-semibold text-white mb-4">Historial de visitas recientes</h2>
                {visitas.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-8">No hay visitas registradas.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {visitas.map(v => (
                      <div key={v.id} className="bg-gray-800 rounded-xl p-4 shadow border border-gray-700">
                        <p className="font-semibold text-white text-sm">{v.nombre_visitante}</p>
                        <div className="mt-2 space-y-0.5 text-xs text-gray-400">
                          <p>DPI: {v.numero_dpi}</p>
                          {v.placa && <p>Placa: {v.placa}</p>}
                          <p className="text-gray-300 mt-1">
                            Entrada: {new Date(v.timestamp_entrada).toLocaleString('es-GT', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                          </p>
                          {v.timestamp_salida ? (
                            <p>Salida: {new Date(v.timestamp_salida).toLocaleString('es-GT', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</p>
                          ) : (
                            <span className="inline-block bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full mt-1">
                              Activo
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </main>
  );
}
