import { useEffect, useState } from 'react';
import {
  getAnuncios, createAnuncio, updateAnuncio, deleteAnuncio,
  decodeTokenPayload,
  type Anuncio, type AnuncioPrioridad,
} from '../services/api';
import { TableSkeleton, Spinner } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n/useTranslation';

const PRIORIDADES: { value: AnuncioPrioridad; labelKey: string }[] = [
  { value: 'normal',     labelKey: 'announce.prioNormal' },
  { value: 'importante', labelKey: 'announce.prioImportante' },
  { value: 'urgente',    labelKey: 'announce.prioUrgente' },
];

const PRIORIDAD_BADGE: Record<AnuncioPrioridad, string> = {
  normal:     'bg-gray-700 text-gray-300',
  importante: 'bg-amber-900/50 text-amber-400',
  urgente:    'bg-red-900/60 text-red-400',
};

const EMPTY_FORM = {
  titulo: '',
  contenido: '',
  prioridad: 'normal' as AnuncioPrioridad,
  vigente_desde: '',
  vigente_hasta: '',
};

export default function AnunciosPage() {
  const showToast = useToast();
  const { t } = useTranslation();

  const sucursalId = (() => {
    const token = localStorage.getItem('token');
    if (!token) return null;
    return (decodeTokenPayload(token)?.sucursal_id as string) ?? null;
  })();

  const [anuncios, setAnuncios]   = useState<Anuncio[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [search, setSearch]       = useState('');

  const [showModal, setShowModal]   = useState(false);
  const [editTarget, setEditTarget] = useState<Anuncio | null>(null);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    getAnuncios()
      .then(setAnuncios)
      .catch(() => setError('No se pudo cargar los anuncios.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditTarget(null); setForm(EMPTY_FORM); setFormError(null); setShowModal(true); };
  const openEdit   = (a: Anuncio) => {
    setEditTarget(a);
    setForm({
      titulo: a.titulo,
      contenido: a.contenido,
      prioridad: a.prioridad,
      vigente_desde: a.vigente_desde ? a.vigente_desde.slice(0, 10) : '',
      vigente_hasta: a.vigente_hasta ? a.vigente_hasta.slice(0, 10) : '',
    });
    setFormError(null);
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditTarget(null); };

  const handleSave = async () => {
    if (!form.titulo.trim())    { setFormError(t('announce.titleRequired')); return; }
    if (!form.contenido.trim()) { setFormError(t('announce.contentRequired')); return; }
    setFormError(null); setSaving(true);
    const payload = {
      titulo:        form.titulo.trim(),
      contenido:     form.contenido.trim(),
      prioridad:     form.prioridad,
      vigente_desde: form.vigente_desde || undefined,
      vigente_hasta: form.vigente_hasta || null,
    };
    try {
      if (editTarget) {
        const updated = await updateAnuncio(editTarget.id, payload);
        setAnuncios(prev => prev.map(a => a.id === updated.id
          ? { ...updated, sucursal_nombre: a.sucursal_nombre, creado_por_nombre: a.creado_por_nombre, total_lecturas: a.total_lecturas }
          : a));
        showToast(t('announce.updated'));
      } else {
        const created = await createAnuncio({ ...payload, sucursal_id: sucursalId ?? undefined });
        setAnuncios(prev => [created, ...prev]);
        showToast(t('announce.created'));
      }
      closeModal();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (a: Anuncio) => {
    if (!window.confirm(`${t('announce.confirmDelete')} "${a.titulo}"?`)) return;
    try {
      await deleteAnuncio(a.id);
      setAnuncios(prev => prev.filter(x => x.id !== a.id));
      showToast(t('announce.deleted'), 'warning');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('es-GT') : null;

  const vigencia = (a: Anuncio): string => {
    const desde = fmtDate(a.vigente_desde) ?? '—';
    const hasta = a.vigente_hasta ? fmtDate(a.vigente_hasta) : t('announce.indefinite');
    return `${desde} → ${hasta}`;
  };

  const filtered = anuncios.filter(a =>
    `${a.titulo} ${a.contenido}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 text-gray-100 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">{t('announce.title')}</h1>
          <p className="text-sm text-gray-400 mt-0.5">{t('announce.subtitle')}</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors"
        >
          {t('announce.new')}
        </button>
      </div>

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={t('announce.searchPlaceholder')}
        className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
      />

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">{t('announce.colTitle')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('announce.colPriority')}</th>
                <th className="px-4 py-3 font-medium">{t('announce.colValidity')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('announce.colReads')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={4} cols={5} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-500">{t('announce.empty')}</td>
                </tr>
              ) : (
                filtered.map(a => (
                  <tr key={a.id} className="border-b border-gray-700 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{a.titulo}</p>
                      <p className="text-gray-500 text-xs mt-0.5 max-w-[320px] truncate" title={a.contenido}>{a.contenido}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORIDAD_BADGE[a.prioridad]}`}>
                        {t(PRIORIDADES.find(p => p.value === a.prioridad)?.labelKey ?? 'announce.prioNormal')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{vigencia(a)}</td>
                    <td className="px-4 py-3 text-center text-gray-300 text-xs">{a.total_lecturas ?? 0}</td>
                    <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                      <button onClick={() => openEdit(a)} className="text-blue-400 hover:text-blue-300 transition-colors">{t('common.edit')}</button>
                      <button onClick={() => handleDelete(a)} className="text-red-400 hover:text-red-300 transition-colors">{t('common.delete')}</button>
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {editTarget ? t('announce.editTitle') : t('announce.createTitle')}
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
            </div>

            {formError && (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">{formError}</div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">{t('announce.titleLabel')} *</label>
              <input
                type="text"
                value={form.titulo}
                onChange={e => setForm(p => ({ ...p, titulo: e.target.value }))}
                placeholder={t('announce.titlePlaceholder')}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">{t('announce.contentLabel')} *</label>
              <textarea
                value={form.contenido}
                onChange={e => setForm(p => ({ ...p, contenido: e.target.value }))}
                rows={4}
                placeholder={t('announce.contentPlaceholder')}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">{t('announce.priorityLabel')}</label>
              <div className="flex gap-2">
                {PRIORIDADES.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, prioridad: p.value }))}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors border ${
                      form.prioridad === p.value
                        ? `${PRIORIDAD_BADGE[p.value]} border-current`
                        : 'bg-gray-700 text-gray-400 border-gray-600 hover:text-gray-200'
                    }`}
                  >
                    {t(p.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">{t('announce.validFrom')}</label>
                <input
                  type="date"
                  value={form.vigente_desde}
                  onChange={e => setForm(p => ({ ...p, vigente_desde: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">{t('announce.validUntil')}</label>
                <input
                  type="date"
                  value={form.vigente_hasta}
                  min={form.vigente_desde || undefined}
                  onChange={e => setForm(p => ({ ...p, vigente_hasta: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {saving && <Spinner size={14} />}
                {saving ? t('common.saving') : t('common.save')}
              </button>
              <button
                onClick={closeModal}
                className="bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium px-4 py-2 rounded-xl transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
