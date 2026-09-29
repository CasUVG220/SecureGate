import { useEffect, useMemo, useState } from 'react';
import {
  getResidentes, createResidente, updateResidente, deleteResidente,
  type Residente, type ResidenteInput, type ResidenteUpdate,
} from '../services/api';
import {
  Badge, Button, DataTable, EmptyState, ESTADO_PAGO_TONE, Input, Modal, Select, useToast,
  type Column,
} from '../components/ui';
import { Skeleton } from '../components/Skeleton';
import { useTranslation } from '../i18n/useTranslation';

type FormMode = 'none' | 'create' | 'edit';

const EMPTY_CREATE: ResidenteInput = { nombre: '', email: '', password: '', numero_casa: '', telefono: '' };
const EMPTY_UPDATE: ResidenteUpdate = { numero_casa: '', estado_pago: '', telefono: '', saldo_pendiente: 0 };

const ICON_SEARCH = 'M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z';
const ICON_RESIDENTS = 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z';
const ICON_PLUS = 'M12 5v14M5 12h14';
const ICON_EDIT = 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z';
const ICON_TRASH = 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6';

function IconButton({ path, label, tone, onClick }: { path: string; label: string; tone: 'brand' | 'danger'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
        tone === 'danger'
          ? 'text-danger-400 hover:bg-danger-500/12'
          : 'text-brand-400 hover:bg-brand-500/12'
      }`}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={path} />
      </svg>
    </button>
  );
}

export default function ResidentesPage() {
  const showToast = useToast();
  const { t } = useTranslation();

  const BADGE_LABEL: Record<string, string> = {
    al_dia: t('residents.current'), mora: t('residents.inDebt'), pendiente: t('residents.pending'),
  };

  const [residentes, setResidentes] = useState<Residente[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [formMode, setFormMode]     = useState<FormMode>('none');
  const [editTarget, setEditTarget] = useState<Residente | null>(null);
  const [createForm, setCreateForm] = useState<ResidenteInput>(EMPTY_CREATE);
  const [updateForm, setUpdateForm] = useState<ResidenteUpdate>(EMPTY_UPDATE);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);

  const cargar = () => {
    setLoading(true);
    getResidentes()
      .then(setResidentes)
      .catch(() => setError('No se pudo cargar la lista de residentes.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, []);

  const handleCreateChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setCreateForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleUpdateChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setUpdateForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const openEdit = (r: Residente) => {
    setEditTarget(r);
    setUpdateForm({
      numero_casa: r.numero_casa,
      estado_pago: r.estado_pago,
      telefono: r.telefono || '',
      saldo_pendiente: parseFloat(r.saldo_pendiente),
    });
    setFormMode('edit');
    setFormError(null);
  };

  const cancelForm = () => {
    setFormMode('none'); setEditTarget(null);
    setCreateForm(EMPTY_CREATE); setUpdateForm(EMPTY_UPDATE);
    setFormError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setFormError(null);
    try {
      await createResidente(createForm);
      cancelForm(); cargar();
      showToast(t('residents.created'));
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error al crear residente');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setSaving(true); setFormError(null);
    try {
      await updateResidente(editTarget.id, updateForm);
      cancelForm(); cargar();
      showToast(t('residents.updated'));
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error al actualizar residente');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: Residente) => {
    if (!window.confirm(`${t('residents.confirmDelete')} ${r.numero_casa}?`)) return;
    try {
      await deleteResidente(r.id);
      cargar();
      showToast(t('residents.deleted'), 'warning');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error al eliminar residente', 'error');
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return residentes.filter(r =>
      (!filterEstado || r.estado_pago === filterEstado) &&
      (`${r.numero_casa} ${r.nombre} ${r.email}`).toLowerCase().includes(q)
    );
  }, [residentes, filterEstado, search]);

  const filtrando = Boolean(search || filterEstado);

  const columns: Column<Residente>[] = [
    {
      key: 'casa', header: t('residents.house'), primary: true,
      cell: r => <span className="font-bold text-gray-50">{r.numero_casa}</span>,
    },
    { key: 'nombre', header: t('common.name'), cell: r => <span className="font-medium text-gray-100">{r.nombre}</span> },
    { key: 'email',  header: t('common.email'), cell: r => <span className="text-gray-400">{r.email}</span> },
    {
      key: 'estado', header: t('residents.paymentStatus'),
      cell: r => (
        <Badge tone={ESTADO_PAGO_TONE[r.estado_pago] ?? 'neutral'} dot>
          {BADGE_LABEL[r.estado_pago] ?? r.estado_pago}
        </Badge>
      ),
    },
    {
      key: 'saldo', header: t('residents.balance'), align: 'right',
      cell: r => <span className="font-semibold tabular-nums text-gray-200">Q{parseFloat(r.saldo_pendiente).toFixed(2)}</span>,
    },
    { key: 'telefono', header: t('common.phone'), cell: r => <span className="text-gray-400">{r.telefono || '—'}</span> },
    {
      key: 'acciones', header: t('common.actions'), align: 'right', actions: true,
      cell: r => (
        <div className="flex justify-end gap-1">
          <IconButton path={ICON_EDIT} label={t('common.edit')} tone="brand" onClick={() => openEdit(r)} />
          <IconButton path={ICON_TRASH} label={t('common.delete')} tone="danger" onClick={() => handleDelete(r)} />
        </div>
      ),
    },
  ];

  return (
    <div className="sg-page">
      <div className="sg-page-inner space-y-5">
        <header className="sg-panel-heading">
          <div>
            <h1 className="text-2xl font-bold text-gray-50">{t('residents.title')}</h1>
            <div className="mt-1 text-sm text-gray-400">
              {loading
                ? <Skeleton height="0.875rem" width="5rem" />
                : <p>{`${filtered.length} / ${residentes.length}`}</p>}
            </div>
          </div>
          <Button
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d={ICON_PLUS} /></svg>}
            onClick={() => { setFormMode('create'); setFormError(null); }}
          >
            {t('residents.new')}
          </Button>
        </header>

        {error && (
          <p role="alert" className="rounded-xl border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-400">{error}</p>
        )}

        <div className="sg-card flex flex-col gap-3 p-4 sm:flex-row">
          <Input
            wrapperClassName="flex-1"
            icon={ICON_SEARCH}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por casa, nombre o email…"
            aria-label={t('common.search')}
          />
          <Select
            wrapperClassName="sm:w-52"
            value={filterEstado}
            onChange={e => setFilterEstado(e.target.value)}
            aria-label={t('residents.paymentStatus')}
          >
            <option value="">Todos</option>
            <option value="al_dia">{t('residents.current')}</option>
            <option value="mora">{t('residents.inDebt')}</option>
            <option value="pendiente">{t('residents.pending')}</option>
          </Select>
        </div>

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={r => r.id}
          loading={loading}
          caption={t('residents.title')}
          empty={
            filtrando ? (
              <EmptyState
                icon={ICON_SEARCH}
                title={t('empty.residentsFiltered')}
                description={t('empty.residentsFilteredHint')}
                action={
                  <Button variant="secondary" onClick={() => { setSearch(''); setFilterEstado(''); }}>
                    {t('empty.clearFilters')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={ICON_RESIDENTS}
                title={t('residents.noResidents')}
                description={t('empty.residentsHint')}
                action={<Button onClick={() => setFormMode('create')}>{t('empty.addFirst')}</Button>}
              />
            )
          }
        />
      </div>

      {/* Alta */}
      <Modal
        open={formMode === 'create'}
        onClose={cancelForm}
        title={t('residents.createTitle')}
        size="lg"
        dismissible={!saving}
      >
        <form id="residente-create" onSubmit={handleCreate} className="space-y-4">
          {formError && (
            <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-sm text-danger-400">{formError}</p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input name="nombre"      label={t('residents.fullName')} required value={createForm.nombre}       onChange={handleCreateChange} />
            <Input name="email"       label={t('common.email')} type="email" required value={createForm.email} onChange={handleCreateChange} />
            <Input name="password"    label={t('common.password')} type="password" required minLength={8} autoComplete="new-password" hint={t('inv.accept.passwordHint')} value={createForm.password} onChange={handleCreateChange} />
            <Input name="numero_casa" label={t('residents.house')} required value={createForm.numero_casa}     onChange={handleCreateChange} />
            <Input name="telefono"    label={t('common.phone')} value={createForm.telefono ?? ''}              onChange={handleCreateChange} wrapperClassName="sm:col-span-2" />
          </div>
          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={cancelForm} disabled={saving}>{t('common.cancel')}</Button>
            <Button type="submit" loading={saving}>{saving ? t('common.saving') : t('common.save')}</Button>
          </div>
        </form>
      </Modal>

      {/* Edición */}
      <Modal
        open={formMode === 'edit'}
        onClose={cancelForm}
        title={editTarget ? `${t('residents.editTitle')} — ${t('residents.house')} ${editTarget.numero_casa}` : t('residents.editTitle')}
        size="lg"
        dismissible={!saving}
      >
        <form onSubmit={handleUpdate} className="space-y-4">
          {formError && (
            <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-sm text-danger-400">{formError}</p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input name="numero_casa" label={t('residents.house')} required value={updateForm.numero_casa ?? ''} onChange={handleUpdateChange} />
            <Select name="estado_pago" label={t('residents.paymentStatus')} value={updateForm.estado_pago ?? ''} onChange={handleUpdateChange}>
              <option value="al_dia">{t('residents.current')}</option>
              <option value="mora">{t('residents.inDebt')}</option>
              <option value="pendiente">{t('residents.pending')}</option>
            </Select>
            <Input name="telefono" label={t('common.phone')} value={updateForm.telefono ?? ''} onChange={handleUpdateChange} />
            <Input
              name="saldo_pendiente" label={t('residents.pendingBalance')} type="number" min="0" step="0.01"
              value={updateForm.saldo_pendiente ?? 0} onChange={handleUpdateChange} suffix="Q"
            />
          </div>
          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={cancelForm} disabled={saving}>{t('common.cancel')}</Button>
            <Button type="submit" loading={saving}>{saving ? t('common.saving') : t('common.saveChanges')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
