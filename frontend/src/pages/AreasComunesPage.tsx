import { useEffect, useState } from 'react';
import { rellenar } from '../components/charts/format';
import {
  getAreas, createArea, updateArea, deleteArea,
  type AreaComun, type TarifaTipo,
} from '../services/api';
import { GridSkeleton, Spinner } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { Button, Modal, ROW_ICON, RowActions, useConfirmacion } from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';
import { archivoADataUri, esImagenValida, ImagenError } from '../utils/imagen';

const TARIFAS: { value: TarifaTipo; labelKey: string }[] = [
  { value: 'gratis',   labelKey: 'reservas.fareFree' },
  { value: 'por_hora', labelKey: 'reservas.farePerHour' },
  { value: 'unica',    labelKey: 'reservas.fareFlat' },
];

/** El select mapea el tri-estado de requiere_aprobacion a tres opciones. */
const APROBACION = [
  { value: 'global', labelKey: 'reservas.approvalGlobal' },
  { value: 'si',     labelKey: 'reservas.approvalAlways' },
  { value: 'no',     labelKey: 'reservas.approvalNever' },
];

const aprobacionAValor = (v: boolean | null): string =>
  v === null || v === undefined ? 'global' : v ? 'si' : 'no';
const valorAAprobacion = (v: string): boolean | null =>
  v === 'global' ? null : v === 'si';

const EMPTY_FORM = {
  nombre: '',
  descripcion: '',
  imagen_url: '',
  tarifa_tipo: 'gratis' as TarifaTipo,
  tarifa_monto: '',
  aprobacion: 'global',
  activa: true,
};

export default function AreasComunesPage() {
  const { t } = useTranslation();
  const { confirmar, dialogo } = useConfirmacion();
  const showToast = useToast();

  const [areas, setAreas] = useState<AreaComun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<AreaComun | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);

  const load = () => {
    setLoading(true);
    getAreas()
      .then(setAreas)
      .catch(() => setError('No se pudo cargar las áreas comunes.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowModal(true);
  };

  const openEdit = (a: AreaComun) => {
    setEditTarget(a);
    setForm({
      nombre: a.nombre,
      descripcion: a.descripcion ?? '',
      imagen_url: a.imagen_url ?? '',
      tarifa_tipo: a.tarifa_tipo,
      tarifa_monto: a.tarifa_tipo === 'gratis' ? '' : String(parseFloat(a.tarifa_monto)),
      aprobacion: aprobacionAValor(a.requiere_aprobacion),
      activa: a.activa,
    });
    setFormError(null);
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditTarget(null); };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubiendo(true);
    setFormError(null);
    try {
      const dataUri = await archivoADataUri(file);
      setForm(prev => ({ ...prev, imagen_url: dataUri }));
    } catch (err) {
      setFormError(err instanceof ImagenError ? err.message : 'No se pudo procesar la imagen.');
    } finally {
      setSubiendo(false);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    if (!form.nombre.trim()) {
      setFormError('El nombre es obligatorio.');
      return;
    }
    const monto = form.tarifa_tipo === 'gratis' ? 0 : Number(form.tarifa_monto);
    if (form.tarifa_tipo !== 'gratis' && (!Number.isFinite(monto) || monto <= 0)) {
      setFormError('El monto debe ser mayor a 0 cuando la tarifa no es gratis.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        nombre: form.nombre.trim(),
        descripcion: form.descripcion.trim() || null,
        imagen_url: form.imagen_url.trim() || null,
        tarifa_tipo: form.tarifa_tipo,
        tarifa_monto: monto,
        requiere_aprobacion: valorAAprobacion(form.aprobacion),
        activa: form.activa,
      };
      if (editTarget) {
        const updated = await updateArea(editTarget.id, payload);
        setAreas(prev => prev.map(a => (a.id === updated.id ? updated : a)));
        showToast(t('reservas.areaUpdated'));
      } else {
        const created = await createArea(payload);
        setAreas(prev => [created, ...prev]);
        showToast(t('reservas.areaCreated'));
      }
      closeModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (a: AreaComun) => {
    const ok = await confirmar({
      title: rellenar(t('confirm.deleteArea.title'), { nombre: a.nombre }),
      message: t('confirm.deleteArea.message'),
      confirmLabel: t('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteArea(a.id);
      setAreas(prev => prev.map(x => (x.id === a.id ? { ...x, activa: false } : x)));
      showToast(t('reservas.areaDeleted'), 'warning');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const tarifaTexto = (a: AreaComun) => {
    if (a.tarifa_tipo === 'gratis') return t('reservas.fareFree');
    const monto = `Q${parseFloat(a.tarifa_monto).toFixed(2)}`;
    return a.tarifa_tipo === 'por_hora' ? `${monto} / h` : monto;
  };

  return (
    <div className="sg-page-inner space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">{t('reservas.areasTitle')}</h2>
          <p className="text-sm text-gray-400 mt-0.5">{t('reservas.areasSubtitle')}</p>
        </div>
        <button
          onClick={openCreate}
          className="sg-btn sg-btn-primary text-sm"
        >
          {t('reservas.newArea')}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <GridSkeleton count={6} media />
      ) : areas.length === 0 ? (
        <div className="sg-card px-4 py-10 text-center text-gray-500">
          {t('reservas.areasEmpty')}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map(a => (
            <div
              key={a.id}
              className={`sg-card overflow-hidden border border-gray-700 ${
                a.activa ? '' : 'opacity-60'
              }`}
            >
              {esImagenValida(a.imagen_url) ? (
                <img
                  src={a.imagen_url as string}
                  alt={a.nombre}
                  className="w-full h-36 object-cover bg-gray-900"
                />
              ) : (
                <div className="w-full h-36 flex items-center justify-center bg-gray-900 text-gray-600 text-sm">
                  {t('reservas.noImage')}
                </div>
              )}
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-white">{a.nombre}</h3>
                  {!a.activa && (
                    <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">
                      {t('reservas.inactive')}
                    </span>
                  )}
                </div>
                {a.descripcion && (
                  <p className="text-sm text-gray-400 line-clamp-2">{a.descripcion}</p>
                )}
                <p className="text-sm font-medium text-emerald-400">{tarifaTexto(a)}</p>
                {a.requiere_aprobacion !== null && (
                  <p className="text-xs text-gray-500">
                    {a.requiere_aprobacion
                      ? t('reservas.approvalAlways')
                      : t('reservas.approvalNever')}
                  </p>
                )}
                <div className="pt-1">
                  <RowActions
                    align="start"
                    inline={a.activa ? 2 : 1}
                    menuLabel={`${t('common.actions')}: ${a.nombre}`}
                    actions={[
                      { id: 'editar', label: t('common.edit'), icon: ROW_ICON.edit, tone: 'primary', onClick: () => openEdit(a) },
                      ...(a.activa
                        ? [{ id: 'eliminar', label: t('common.delete'), icon: ROW_ICON.trash, tone: 'danger' as const, onClick: () => handleDelete(a) }]
                        : []),
                    ]}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal propio: el formulario es largo y «Guardar» queda fijo al pie (footer), a la vista. */}
      <Modal
        open={showModal}
        onClose={closeModal}
        dismissible={!saving}
        size="md"
        title={editTarget ? t('reservas.editArea') : t('reservas.createArea')}
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={saving}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} loading={saving}>{saving ? t('common.saving') : t('common.save')}</Button>
          </>
        }
      >
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">
                {formError}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                {t('reservas.areaName')} *
              </label>
              <input
                name="nombre"
                value={form.nombre}
                onChange={e => setForm(prev => ({ ...prev, nombre: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                {t('reservas.areaDesc')}
              </label>
              <textarea
                name="descripcion"
                rows={2}
                value={form.descripcion}
                onChange={e => setForm(prev => ({ ...prev, descripcion: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                {t('reservas.areaImage')}
              </label>
              <input
                name="imagen_url"
                placeholder={t('reservas.imageUrl')}
                value={form.imagen_url.startsWith('data:') ? '' : form.imagen_url}
                onChange={e => setForm(prev => ({ ...prev, imagen_url: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-2"
              />
              <label className="flex items-center gap-2 w-full cursor-pointer bg-gray-700 border border-dashed border-gray-500 hover:border-blue-500 rounded-lg px-3 py-2.5 transition-colors text-sm text-gray-300">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleFile}
                />
                {subiendo ? <Spinner size={14} /> : null}
                {subiendo ? t('common.loading') : t('reservas.uploadImage')}
              </label>
              <p className="text-xs text-gray-500 mt-1">{t('reservas.areaImageHelp')}</p>
              {esImagenValida(form.imagen_url) && (
                <div className="mt-2 space-y-1">
                  <img
                    src={form.imagen_url}
                    alt=""
                    className="w-full max-h-40 object-contain rounded-lg border border-gray-600 bg-gray-900"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger-400 hover:bg-danger-500/12 hover:text-danger-400"
                    onClick={() => setForm(prev => ({ ...prev, imagen_url: '' }))}
                  >
                    {t('reservas.removeImage')}
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  {t('reservas.fareType')}
                </label>
                <select
                  name="tarifa_tipo"
                  value={form.tarifa_tipo}
                  onChange={e =>
                    setForm(prev => ({ ...prev, tarifa_tipo: e.target.value as TarifaTipo }))
                  }
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 appearance-none"
                >
                  {TARIFAS.map(tf => (
                    <option key={tf.value} value={tf.value}>{t(tf.labelKey)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  {t('reservas.fareAmount')}
                </label>
                <input
                  name="tarifa_monto"
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={form.tarifa_tipo === 'gratis'}
                  value={form.tarifa_tipo === 'gratis' ? '' : form.tarifa_monto}
                  onChange={e => setForm(prev => ({ ...prev, tarifa_monto: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-40"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                {t('reservas.approvalOverride')}
              </label>
              <select
                name="aprobacion"
                value={form.aprobacion}
                onChange={e => setForm(prev => ({ ...prev, aprobacion: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 appearance-none"
              >
                {APROBACION.map(o => (
                  <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={form.activa}
                onChange={e => setForm(prev => ({ ...prev, activa: e.target.checked }))}
              />
              {t('reservas.areaActive')}
            </label>

          </div>
      </Modal>
      {dialogo}
    </div>
  );
}
