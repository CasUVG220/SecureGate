import { useEffect, useState } from 'react';
import {
  getBlacklist, createBlacklist, deleteBlacklist, buscarVisitantesPorDpi,
  type Blacklist, type BlacklistInput, type BlacklistDuracion, type VisitanteBasico,
} from '../services/api';
import { Badge, Button, DataTable, EmptyState, Input, Spinner, useToast, type Column } from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';

const DURACION_VALUES: { value: BlacklistDuracion; labelKey: string }[] = [
  { value: 'temporal_dias', labelKey: 'blacklist.durTemporal' },
  { value: '30_dias',       labelKey: 'blacklist.dur30' },
  { value: 'indefinido',    labelKey: 'blacklist.durIndefinido' },
];

const ICON_SEARCH = 'M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z';
const ICON_SHIELD = 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 8v4M12 16h.01';

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

  const columns: Column<Blacklist>[] = [
    { key: 'visitante', header: t('blacklist.colVisitor'), primary: true, className: 'font-semibold text-gray-50', cell: e => e.visitante_nombre },
    { key: 'dpi', header: t('blacklist.colDpi'), className: 'font-mono text-xs text-gray-400', cell: e => e.numero_dpi },
    {
      key: 'razon', header: t('blacklist.colReason'), className: 'text-gray-200',
      cell: e => <span className="block max-w-52 truncate" title={e.razon}>{e.razon}</span>,
    },
    {
      key: 'tipo', header: t('blacklist.colType'), align: 'center',
      cell: e => <Badge tone={e.fecha_fin === null ? 'danger' : 'warning'}>{banType(e)}</Badge>,
    },
    {
      key: 'vence', header: t('blacklist.colExpires'), align: 'center', className: 'text-xs text-gray-400',
      cell: e => (e.fecha_fin === null ? '\u221e' : formatDate(e.fecha_fin)),
    },
    { key: 'sucursal', header: t('blacklist.colBranch'), align: 'center', className: 'text-xs text-gray-400', cell: e => e.sucursal_nombre },
    {
      key: 'acciones', header: t('common.actions'), align: 'right', actions: true,
      cell: e => (
        <Button size="sm" variant="ghost" onClick={() => handleRemove(e)} className="text-success-400 hover:bg-success-500/12 hover:text-success-400">
          {t('blacklist.remove')}
        </Button>
      ),
    },
  ];

  return (
    <div className="sg-page">
      <div className="sg-page-inner space-y-5">
        <header className="sg-panel-heading">
          <div>
            <h1 className="text-2xl font-bold text-gray-50">{t('blacklist.title')}</h1>
            <p className="mt-1 text-sm text-gray-400">{t('blacklist.subtitle')}</p>
          </div>
          <Button
            variant="danger"
            onClick={openModal}
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={ICON_SHIELD} />
              </svg>
            }
          >
            {t('blacklist.add')}
          </Button>
        </header>

        <Input
          wrapperClassName="max-w-sm"
          icon={ICON_SEARCH}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('blacklist.searchPlaceholder')}
          aria-label={t('common.search')}
        />

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={e => e.id}
          loading={loading}
          caption={t('blacklist.title')}
          empty={
            search ? (
              <EmptyState icon={ICON_SEARCH} title={t('blacklist.empty')} />
            ) : (
              <EmptyState
                icon={ICON_SHIELD}
                title={t('empty.blacklist')}
                description={t('empty.blacklistHint')}
                action={<Button variant="danger" onClick={openModal}>{t('blacklist.add')}</Button>}
              />
            )
          }
        />
      </div>

      {/* Modal */}
      {showModal && (
        <div className="sg-drawer-backdrop fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="sg-card w-full rounded-t-3xl p-5 sm:max-w-md sm:rounded-2xl sm:p-6">
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
                  className="sg-input"
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
                  className="sg-input"
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
                    className="sg-input"
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
                  className="sg-input resize-none"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="sg-btn sg-btn-danger flex-1 text-sm"
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
