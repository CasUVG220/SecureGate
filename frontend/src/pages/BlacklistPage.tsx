import { useEffect, useState } from 'react';
import {
  getBlacklist, addToBlacklist, removeFromBlacklist, buscarVisitantesPorDpi,
  type BlacklistEntry, type BlacklistInput, type VisitanteBasico,
} from '../services/api';
import { Spinner, TableSkeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_FORM: BlacklistInput = {
  visitante_id: '',
  tipo: 'temporal',
  razon: '',
  fecha_fin: today(),
};

export default function BlacklistPage() {
  const showToast = useToast();
  const [entries, setEntries]     = useState<BlacklistEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [showModal, setShowModal] = useState(false);

  const [form, setForm]           = useState<BlacklistInput>(EMPTY_FORM);
  const [dpiQuery, setDpiQuery]   = useState('');
  const [dpiResults, setDpiResults] = useState<VisitanteBasico[]>([]);
  const [dpiLoading, setDpiLoading] = useState(false);
  const [selectedVisitante, setSelectedVisitante] = useState<VisitanteBasico | null>(null);
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const cargar = () => {
    setLoading(true);
    getBlacklist()
      .then(setEntries)
      .catch(() => showToast('Error al cargar blacklist', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, []);

  const handleDpiSearch = async (val: string) => {
    setDpiQuery(val);
    setSelectedVisitante(null);
    setForm(prev => ({ ...prev, visitante_id: '' }));
    if (val.length < 3) { setDpiResults([]); return; }
    setDpiLoading(true);
    try {
      const results = await buscarVisitantesPorDpi(val);
      setDpiResults(results);
    } finally {
      setDpiLoading(false);
    }
  };

  const selectVisitante = (v: VisitanteBasico) => {
    setSelectedVisitante(v);
    setDpiQuery(v.numero_dpi);
    setDpiResults([]);
    setForm(prev => ({ ...prev, visitante_id: v.id }));
  };

  const openModal = () => {
    setForm(EMPTY_FORM);
    setDpiQuery('');
    setDpiResults([]);
    setSelectedVisitante(null);
    setFormError(null);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.visitante_id) { setFormError('Selecciona un visitante por DPI'); return; }
    if (!form.razon.trim()) { setFormError('La razón es requerida'); return; }
    if (form.tipo === 'temporal' && !form.fecha_fin) {
      setFormError('Indica la fecha de vencimiento del ban'); return;
    }
    setSaving(true); setFormError(null);
    try {
      await addToBlacklist({
        visitante_id: form.visitante_id,
        tipo:         form.tipo,
        razon:        form.razon,
        fecha_fin:    form.tipo === 'temporal' ? form.fecha_fin : undefined,
      });
      setShowModal(false);
      cargar();
      showToast('Visitante agregado a la lista negra', 'warning');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al agregar');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (entry: BlacklistEntry) => {
    if (!window.confirm(`¿Remover el ban de "${entry.visitante_nombre}"?`)) return;
    try {
      await removeFromBlacklist(entry.id);
      cargar();
      showToast('Ban removido', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al remover', 'error');
    }
  };

  const filtered = entries.filter(e =>
    `${e.visitante_nombre} ${e.numero_dpi} ${e.razon}`.toLowerCase().includes(search.toLowerCase())
  );

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('es-GT') : '—';

  return (
    <div className="p-4 sm:p-6 text-gray-100 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Lista Negra de Visitantes</h1>
          <p className="text-sm text-gray-400 mt-0.5">Visitantes con acceso bloqueado en esta sucursal</p>
        </div>
        <button
          onClick={openModal}
          className="flex items-center gap-2 bg-red-700 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Agregar ban
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar por nombre, DPI o razón…"
        className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
      />

      {/* Table */}
      <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">Visitante</th>
                <th className="px-4 py-3 font-medium">DPI</th>
                <th className="px-4 py-3 font-medium">Razón</th>
                <th className="px-4 py-3 font-medium text-center">Tipo</th>
                <th className="px-4 py-3 font-medium text-center">Vence</th>
                <th className="px-4 py-3 font-medium text-center">Sucursal</th>
                <th className="px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={4} cols={7} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                    No hay visitantes en lista negra.
                  </td>
                </tr>
              ) : (
                filtered.map(entry => (
                  <tr key={entry.id} className="border-b border-gray-700 last:border-0">
                    <td className="px-4 py-3 font-medium text-white">{entry.visitante_nombre}</td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{entry.numero_dpi}</td>
                    <td className="px-4 py-3 text-gray-300 max-w-[200px] truncate" title={entry.razon}>
                      {entry.razon}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${
                        entry.tipo === 'permanente'
                          ? 'bg-red-900/60 text-red-400'
                          : 'bg-amber-900/50 text-amber-400'
                      }`}>
                        {entry.tipo === 'permanente' ? 'Permanente' : 'Temporal'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-400 text-xs">
                      {entry.tipo === 'permanente' ? '∞' : formatDate(entry.fecha_fin)}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-400 text-xs">{entry.sucursal_nombre}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleRemove(entry)}
                        className="text-green-400 hover:text-green-300 text-xs font-medium transition-colors"
                      >
                        Remover ban
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md p-6 space-y-5">
            <h2 className="text-lg font-bold text-white">Agregar a lista negra</h2>

            {formError && (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* DPI search */}
              <div className="relative">
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Buscar visitante por DPI *
                </label>
                <input
                  type="text"
                  value={dpiQuery}
                  onChange={e => handleDpiSearch(e.target.value)}
                  placeholder="Escribe el número de DPI…"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                {dpiLoading && (
                  <div className="absolute right-3 top-8">
                    <Spinner size={14} />
                  </div>
                )}
                {dpiResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-gray-700 border border-gray-600 rounded-lg shadow-xl max-h-40 overflow-y-auto">
                    {dpiResults.map(v => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => selectVisitante(v)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-600 transition-colors"
                      >
                        <span className="text-white font-medium">{v.nombre}</span>
                        <span className="text-gray-400 text-xs ml-2">{v.numero_dpi}</span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedVisitante && (
                  <p className="mt-1 text-xs text-green-400">
                    Seleccionado: <strong>{selectedVisitante.nombre}</strong>
                  </p>
                )}
              </div>

              {/* Tipo */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Tipo de ban *</label>
                <div className="flex gap-4">
                  {(['temporal', 'permanente'] as const).map(t => (
                    <label key={t} className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                      <input
                        type="radio"
                        name="tipo"
                        value={t}
                        checked={form.tipo === t}
                        onChange={() => setForm(prev => ({ ...prev, tipo: t }))}
                        className="accent-red-500"
                      />
                      {t === 'temporal' ? 'Temporal' : 'Permanente'}
                    </label>
                  ))}
                </div>
              </div>

              {/* Fecha fin (only temporal) */}
              {form.tipo === 'temporal' && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Fecha de vencimiento *</label>
                  <input
                    type="date"
                    value={form.fecha_fin ?? ''}
                    min={today()}
                    onChange={e => setForm(prev => ({ ...prev, fecha_fin: e.target.value }))}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              )}

              {/* Razón */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Razón *</label>
                <textarea
                  value={form.razon}
                  onChange={e => setForm(prev => ({ ...prev, razon: e.target.value }))}
                  rows={3}
                  placeholder="Describe el motivo del ban…"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {saving && <Spinner size={14} />} Agregar ban
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
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
