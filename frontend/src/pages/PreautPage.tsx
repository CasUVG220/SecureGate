import { useEffect, useState } from 'react';
import {
  getPreautorizaciones, createPreautorizacion, deletePreautorizacion, getResidentes,
  type Preautorizacion, type Residente,
} from '../services/api';
import { TableSkeleton, Spinner } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n/useTranslation';

const today = () => new Date().toISOString().slice(0, 10);
const EMPTY_FORM = { residente_id: '', nombre_visitante: '', numero_dpi: '', placa: '', fecha_inicio: '', fecha_fin: '' };

export default function PreautPage() {
  const showToast = useToast();
  const { t } = useTranslation();
  const [preauths, setPreauths]     = useState<Preautorizacion[]>([]);
  const [residentes, setResidentes] = useState<Residente[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [showModal, setShowModal]   = useState(false);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const cargar = () => {
    setLoading(true);
    getPreautorizaciones()
      .then(setPreauths)
      .catch(() => setError('No se pudo cargar la lista de preautorizaciones.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    cargar();
    getResidentes().then(setResidentes).catch(() => {});
  }, []);

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.residente_id || !form.nombre_visitante || !form.fecha_inicio) {
      setFormError('Residente, nombre del visitante y fecha de inicio son obligatorios.');
      return;
    }
    if (!form.numero_dpi && !form.placa) {
      setFormError('Se requiere al menos DPI o placa del visitante.');
      return;
    }
    setSaving(true); setFormError(null);
    try {
      await createPreautorizacion({
        residente_id:     form.residente_id,
        nombre_visitante: form.nombre_visitante,
        numero_dpi:       form.numero_dpi   || undefined,
        placa:            form.placa        || undefined,
        fecha_inicio:     form.fecha_inicio,
        fecha_fin:        form.fecha_fin    || undefined,
      });
      setShowModal(false);
      cargar();
      showToast(t('preauth.created'));
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error al crear preautorización');
    } finally {
      setSaving(false);
    }
  };

  const handleEliminar = async (id: string) => {
    if (!window.confirm(t('preauth.confirmDelete'))) return;
    setDeletingId(id);
    try {
      await deletePreautorizacion(id);
      cargar();
      showToast(t('preauth.deleted'), 'warning');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error al eliminar', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handlePreautHoy = (p: Preautorizacion) => {
    setForm({
      residente_id:     p.residente_id,
      nombre_visitante: p.nombre_visitante,
      numero_dpi:       p.numero_dpi || '',
      placa:            p.placa || '',
      fecha_inicio:     today(),
      fecha_fin:        today(),
    });
    setFormError(null);
    setShowModal(true);
  };

  const formatFecha = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('es-GT') : '—';

  return (
    <div className="p-6 text-gray-100 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">{t('preauth.title')}</h1>
        <button
          onClick={() => { setForm(EMPTY_FORM); setFormError(null); setShowModal(true); }}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          {t('preauth.new')}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        {!loading && preauths.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-12">{t('preauth.noPreauths')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">{t('residents.house')}</th>
                <th className="px-4 py-3 font-medium">{t('preauth.visitorName')}</th>
                <th className="px-4 py-3 font-medium">{t('gate.dpi')}</th>
                <th className="px-4 py-3 font-medium">{t('preauth.from')}</th>
                <th className="px-4 py-3 font-medium">{t('preauth.until')}</th>
                <th className="px-4 py-3 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={5} cols={6} />
              ) : (
                preauths.map(p => (
                  <tr key={p.id} className="border-b border-gray-700 last:border-0">
                    <td className="px-4 py-3 font-medium">{p.numero_casa}</td>
                    <td className="px-4 py-3">{p.nombre_visitante}</td>
                    <td className="px-4 py-3 text-gray-400">{p.numero_dpi ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-300">{formatFecha(p.fecha_inicio)}</td>
                    <td className="px-4 py-3 text-gray-300">{formatFecha(p.fecha_fin)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button onClick={() => handlePreautHoy(p)}
                          className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors whitespace-nowrap">
                          Preautorizar hoy
                        </button>
                        <button onClick={() => handleEliminar(p.id)} disabled={deletingId === p.id}
                          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 font-medium transition-colors flex items-center gap-1">
                          {deletingId === p.id && <Spinner size={12} />}
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-gray-800 rounded-2xl p-8 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-6">{t('preauth.modalTitle')}</h2>
            {formError && (
              <div className="mb-4 bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{formError}</div>
            )}
            <form onSubmit={handleCrear} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">{t('common.name')} *</label>
                <select name="residente_id" value={form.residente_id} onChange={handleFormChange} required
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors">
                  <option value="">{t('preauth.selectResident')}</option>
                  {residentes.map(r => (
                    <option key={r.id} value={r.id}>Casa {r.numero_casa} — {r.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">{t('preauth.visitorNameLabel')} *</label>
                <input name="nombre_visitante" value={form.nombre_visitante} onChange={handleFormChange} required placeholder="Juan Pérez"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">DPI <span className="text-gray-500 text-xs">(o placa)</span></label>
                  <input name="numero_dpi" value={form.numero_dpi} onChange={handleFormChange} placeholder="1234567890101"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors" />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">{t('gate.plate')} <span className="text-gray-500 text-xs">(o DPI)</span></label>
                  <input name="placa" value={form.placa} onChange={handleFormChange} placeholder="P-123ABC"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">{t('preauth.fromRequired')} *</label>
                  <input type="date" name="fecha_inicio" value={form.fecha_inicio} onChange={handleFormChange} required
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors" />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">{t('preauth.untilOptional')}</label>
                  <input type="date" name="fecha_fin" value={form.fecha_fin} onChange={handleFormChange}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2">
                  {saving && <Spinner />}
                  {saving ? t('common.saving') : t('common.save')}
                </button>
                <button type="button" onClick={() => setShowModal(false)} disabled={saving}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors">
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
