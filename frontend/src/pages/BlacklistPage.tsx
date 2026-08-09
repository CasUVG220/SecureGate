import { useEffect, useState } from 'react';
import {
  getBlacklist, createBlacklist, deleteBlacklist, buscarVisitantesPorDpi,
  type Blacklist, type BlacklistInput, type BlacklistDuracion, type VisitanteBasico,
} from '../services/api';
import { Spinner, TableSkeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n/useTranslation';

const DURACION_VALUES: { value: BlacklistDuracion; labelKey: string }[] = [
  { value: 'temporal_dias', labelKey: 'blacklist.durTemporal' },
  { value: '30_dias',       labelKey: 'blacklist.dur30' },
  { value: 'indefinido',    labelKey: 'blacklist.durIndefinido' },
];

const EMPTY_FORM: BlacklistInput = {
  visitante_id: '',
  razon: '',
  duracion: 'temporal_dias',
  dias: 7,
};

export default function BlacklistPage() {
  const showToast = useToast();
  const { t } = useTranslation();

  const [entries, setEntries]     = useState<Blacklist[]>([]);
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
      .catch(() => showToast(t('blacklist.errorLoad'), 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!form.visitante_id) { setFormError(t('blacklist.selectVisitor')); return; }
    if (!form.razon.trim()) { setFormError(t('blacklist.reasonRequired')); return; }
    if (form.duracion === 'temporal_dias' && (!form.dias || form.dias < 1)) {
      setFormError(t('blacklist.daysRequired')); return;
    }
    setSaving(true); setFormError(null);
    try {
      await createBlacklist({
        visitante_id: form.visitante_id,
        razon:        form.razon,
        duracion:     form.duracion,
        dias:         form.duracion === 'temporal_dias' ? form.dias : undefined,
      });
      setShowModal(false);
      cargar();
      showToast(t('blacklist.added'), 'warning');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (entry: Blacklist) => {
    if (!window.confirm(`${t('blacklist.removeConfirm')} "${entry.visitante_nombre}"?`)) return;
    try {
      await deleteBlacklist(entry.id);
      cargar();
      showToast(t('blacklist.removed'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const filtered = entries.filter(e =>
    `${e.visitante_nombre} ${e.numero_dpi} ${e.razon}`.toLowerCase().includes(search.toLowerCase())
  );

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('es-GT') : '—';

  // Tipo de ban derivado de fecha_fin: Permanente / 30 días / Temporal
  const banType = (e: Blacklist): string => {
    if (e.fecha_fin === null) return t('blacklist.permanent');
    const dias = Math.round(
      (new Date(e.fecha_fin).getTime() - new Date(e.fecha_inicio).getTime()) / 86_400_000
    );
    return dias === 30 ? t('blacklist.dur30') : t('blacklist.temporal');
  };

  return (
    <div className="p-4 sm:p-6 text-gray-100 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">{t('blacklist.title')}</h1>
          <p className="text-sm text-gray-400 mt-0.5">{t('blacklist.subtitle')}</p>
        </div>
        <button
          onClick={openModal}
          className="flex items-center gap-2 bg-red-700 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {t('blacklist.add')}
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={t('blacklist.searchPlaceholder')}
        className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
      />

      {/* Table */}
      <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">{t('blacklist.colVisitor')}</th>
                <th className="px-4 py-3 font-medium">{t('blacklist.colDpi')}</th>
                <th className="px-4 py-3 font-medium">{t('blacklist.colReason')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('blacklist.colType')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('blacklist.colExpires')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('blacklist.colBranch')}</th>
                <th className="px-4 py-3 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={4} cols={7} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                    {t('blacklist.empty')}
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
                        entry.fecha_fin === null
                          ? 'bg-red-900/60 text-red-400'
                          : 'bg-amber-900/50 text-amber-400'
                      }`}>
                        {banType(entry)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-400 text-xs">
                      {entry.fecha_fin === null ? '∞' : formatDate(entry.fecha_fin)}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-400 text-xs">{entry.sucursal_nombre}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleRemove(entry)}
                        className="text-green-400 hover:text-green-300 text-xs font-medium transition-colors"
                      >
                        {t('blacklist.remove')}
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
            <h2 className="text-lg font-bold text-white">{t('blacklist.modalTitle')}</h2>

            {formError && (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* DPI search */}
              <div className="relative">
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  {t('blacklist.searchByDpi')} *
                </label>
                <input
                  type="text"
                  value={dpiQuery}
                  onChange={e => handleDpiSearch(e.target.value)}
                  placeholder={t('blacklist.dpiPlaceholder')}
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
                    {t('blacklist.selected')}: <strong>{selectedVisitante.nombre}</strong>
                  </p>
                )}
              </div>

              {/* Duración */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">{t('blacklist.duration')} *</label>
                <select
                  value={form.duracion}
                  onChange={e => setForm(prev => ({ ...prev, duracion: e.target.value as BlacklistDuracion }))}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {DURACION_VALUES.map(d => (
                    <option key={d.value} value={d.value}>{t(d.labelKey)}</option>
                  ))}
                </select>
              </div>

              {/* Días (only temporal_dias) */}
              {form.duracion === 'temporal_dias' && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">{t('blacklist.days')} *</label>
                  <input
                    type="number"
                    min={1}
                    value={form.dias ?? ''}
                    onChange={e => setForm(prev => ({ ...prev, dias: e.target.value ? parseInt(e.target.value, 10) : undefined }))}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              )}

              {/* Razón */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">{t('blacklist.reason')} *</label>
                <textarea
                  value={form.razon}
                  onChange={e => setForm(prev => ({ ...prev, razon: e.target.value }))}
                  rows={3}
                  placeholder={t('blacklist.reasonPlaceholder')}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {saving && <Spinner size={14} />} {t('blacklist.add')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                >
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
