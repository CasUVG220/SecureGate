import { useEffect, useState } from 'react';
import {
  getAnuncios, createAnuncio, updateAnuncio, deleteAnuncio,
  decodeTokenPayload,
  type Anuncio, type AnuncioPrioridad,
} from '../services/api';
import { Badge, Button, DataTable, EmptyState, Input, Modal, Textarea, useToast, type Column } from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';

const PRIORIDADES: { value: AnuncioPrioridad; labelKey: string }[] = [
  { value: 'normal',     labelKey: 'announce.prioNormal' },
  { value: 'importante', labelKey: 'announce.prioImportante' },
  { value: 'urgente',    labelKey: 'announce.prioUrgente' },
];

const PRIORIDAD_TONE: Record<AnuncioPrioridad, 'neutral' | 'warning' | 'danger'> = {
  normal: 'neutral', importante: 'warning', urgente: 'danger',
};

/** Clases del botón de prioridad seleccionado en el formulario. */
const PRIORIDAD_SELECTED: Record<AnuncioPrioridad, string> = {
  normal:     'border-gray-500 bg-gray-500/15 text-gray-100',
  importante: 'border-warning-500/40 bg-warning-500/12 text-warning-400',
  urgente:    'border-danger-500/40 bg-danger-500/12 text-danger-400',
};

const ICON_ANNOUNCE = 'M3 11l18-5v12L3 14v-3zM11.6 16.8a3 3 0 11-5.8-1.6';
const ICON_SEARCH = 'M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z';

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

  const columns: Column<Anuncio>[] = [
    {
      key: 'titulo', header: t('announce.colTitle'), primary: true,
      cell: a => (
        <div className="min-w-0">
          <p className="font-semibold text-gray-50">{a.titulo}</p>
          <p className="mt-0.5 max-w-80 truncate text-xs text-gray-400" title={a.contenido}>{a.contenido}</p>
        </div>
      ),
    },
    {
      key: 'prioridad', header: t('announce.colPriority'), align: 'center',
      cell: a => (
        <Badge tone={PRIORIDAD_TONE[a.prioridad]}>
          {t(PRIORIDADES.find(pr => pr.value === a.prioridad)?.labelKey ?? 'announce.prioNormal')}
        </Badge>
      ),
    },
    { key: 'vigencia', header: t('announce.colValidity'), className: 'whitespace-nowrap text-xs text-gray-400', cell: a => vigencia(a) },
    { key: 'lecturas', header: t('announce.colReads'), align: 'center', className: 'text-gray-300', cell: a => a.total_lecturas ?? 0 },
    {
      key: 'acciones', header: t('common.actions'), align: 'right', actions: true,
      cell: a => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => openEdit(a)}>{t('common.edit')}</Button>
          <Button size="sm" variant="ghost" onClick={() => handleDelete(a)} className="text-danger-400 hover:bg-danger-500/12 hover:text-danger-400">
            {t('common.delete')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="sg-page">
      <div className="sg-page-inner space-y-5">
        <header className="sg-panel-heading">
          <div>
            <h1 className="text-2xl font-bold text-gray-50">{t('announce.title')}</h1>
            <p className="mt-1 text-sm text-gray-400">{t('announce.subtitle')}</p>
          </div>
          <Button onClick={openCreate}>{t('announce.new')}</Button>
        </header>

        <Input
          wrapperClassName="max-w-sm"
          icon={ICON_SEARCH}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('announce.searchPlaceholder')}
          aria-label={t('common.search')}
        />

        {error && (
          <p role="alert" className="rounded-xl border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-400">{error}</p>
        )}

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={a => a.id}
          loading={loading}
          caption={t('announce.title')}
          empty={
            search ? (
              <EmptyState icon={ICON_SEARCH} title={t('announce.empty')} />
            ) : (
              <EmptyState
                icon={ICON_ANNOUNCE}
                title={t('empty.announcements')}
                description={t('empty.announcementsHint')}
                action={<Button onClick={openCreate}>{t('empty.addFirst')}</Button>}
              />
            )
          }
        />
      </div>

      <Modal
        open={showModal}
        onClose={closeModal}
        title={editTarget ? t('announce.editTitle') : t('announce.createTitle')}
        size="lg"
        dismissible={!saving}
      >
        <div className="space-y-4">
          {formError && (
            <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-sm text-danger-400">{formError}</p>
          )}

          <Input
            label={t('announce.titleLabel')}
            required
            value={form.titulo}
            onChange={e => setForm(prev => ({ ...prev, titulo: e.target.value }))}
            placeholder={t('announce.titlePlaceholder')}
          />

          <Textarea
            label={t('announce.contentLabel')}
            required
            rows={4}
            value={form.contenido}
            onChange={e => setForm(prev => ({ ...prev, contenido: e.target.value }))}
            placeholder={t('announce.contentPlaceholder')}
          />

          <div>
            <p className="mb-1.5 text-xs font-semibold text-gray-300">{t('announce.priorityLabel')}</p>
            <div className="flex gap-2" role="radiogroup" aria-label={t('announce.priorityLabel')}>
              {PRIORIDADES.map(pr => (
                <button
                  key={pr.value}
                  type="button"
                  role="radio"
                  aria-checked={form.prioridad === pr.value}
                  onClick={() => setForm(f => ({ ...f, prioridad: pr.value }))}
                  className={`min-h-control flex-1 rounded-lg border px-3 text-xs font-bold transition-colors ${
                    form.prioridad === pr.value
                      ? PRIORIDAD_SELECTED[pr.value]
                      : 'border-gray-600 bg-gray-800 text-gray-400 hover:text-gray-100'
                  }`}
                >
                  {t(pr.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              type="date"
              label={t('announce.validFrom')}
              value={form.vigente_desde}
              onChange={e => setForm(prev => ({ ...prev, vigente_desde: e.target.value }))}
            />
            <Input
              type="date"
              label={t('announce.validUntil')}
              min={form.vigente_desde || undefined}
              value={form.vigente_hasta}
              onChange={e => setForm(prev => ({ ...prev, vigente_hasta: e.target.value }))}
            />
          </div>

          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={closeModal} disabled={saving}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} loading={saving}>{saving ? t('common.saving') : t('common.save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
