import { useEffect, useRef, useState } from 'react';
import {
  getResidenteMe,
  getMisPreautorizaciones,
  createMisPreautorizacion,
  deleteMisPreautorizacion,
  getMisAccesos,
  getMisPagos,
  crearTransferencia,
  type ResidenteMe,
  type MiPreautorizacion,
  type MiVisita,
  type Pago,
} from '../services/api';
import { Spinner } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n/useTranslation';

const BADGE: Record<string, string> = {
  al_dia:   'bg-green-100 text-green-700',
  mora:     'bg-red-100 text-red-700',
  pendiente:'bg-yellow-100 text-yellow-700',
};

const PAGO_ESTADO_CLASS: Record<string, string> = {
  pendiente: 'bg-yellow-900/40 text-yellow-400 border-yellow-700/40',
  aprobado:  'bg-green-900/40 text-green-400 border-green-700/40',
  rechazado: 'bg-red-900/40 text-red-400 border-red-700/40',
};

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_FORM = { nombre_visitante: '', numero_dpi: '', placa: '' };
const EMPTY_TRF  = { monto: '', referencia: '', banco: '', fecha_transferencia: today() };

export default function ResidentePage() {
  const showToast = useToast();
  const { t } = useTranslation();

  const BADGE_LABEL: Record<string, string> = {
    al_dia: t('residents.current'), mora: t('residents.inDebt'), pendiente: t('residents.pending'),
  };
  const PAGO_METODO_LABEL: Record<string, string> = { efectivo: t('payments.cash'), transferencia: t('payments.transfer') };
  const PAGO_ESTADO_LABEL: Record<string, string> = {
    pendiente: t('payments.pending'), aprobado: t('payments.approved'), rechazado: t('payments.rejected'),
  };

  const [data, setData]         = useState<ResidenteMe | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const [tab, setTab]           = useState<'pagos' | 'invitados'>('pagos');

  // Pagos tab state
  const [misPagos, setMisPagos]           = useState<Pago[]>([]);
  const [pagosLoading, setPagosLoading]   = useState(false);
  const [pagosLoaded, setPagosLoaded]     = useState(false);
  const [showTrf, setShowTrf]             = useState(false);
  const [trfForm, setTrfForm]             = useState(EMPTY_TRF);
  const [imgBase64, setImgBase64]         = useState<string | null>(null);
  const [imgPreview, setImgPreview]       = useState<string | null>(null);
  const [enviando, setEnviando]           = useState(false);
  const [trfError, setTrfError]           = useState<string | null>(null);

  // Invitados tab state
  const [preauths, setPreauths] = useState<MiPreautorizacion[]>([]);
  const [visitas, setVisitas]   = useState<MiVisita[]>([]);
  const [invLoading, setInvLoading] = useState(false);
  const [invLoaded, setInvLoaded]   = useState(false);

  const [showForm, setShowForm]       = useState(false);
  const [form, setForm]               = useState(EMPTY_FORM);
  const formRef                       = useRef<HTMLDivElement>(null);
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadPagos = () => {
    if (pagosLoaded) return;
    setPagosLoading(true);
    getMisPagos()
      .then(p => { setMisPagos(p); setPagosLoaded(true); })
      .catch(() => showToast('No se pudo cargar el historial de pagos.', 'error'))
      .finally(() => setPagosLoading(false));
  };

  const loadInvitados = () => {
    if (invLoaded) return;
    setInvLoading(true);
    Promise.all([getMisPreautorizaciones(), getMisAccesos()])
      .then(([p, v]) => { setPreauths(p); setVisitas(v); setInvLoaded(true); })
      .catch(() => setError('No se pudo cargar la sección de invitados.'))
      .finally(() => setInvLoading(false));
  };

  useEffect(() => {
    getResidenteMe()
      .then(setData)
      .catch(() => setError('No se pudo cargar tu información.'))
      .finally(() => setLoading(false));
    loadPagos();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabChange = (tab2: 'pagos' | 'invitados') => {
    setTab(tab2);
    if (tab2 === 'pagos') loadPagos();
    if (tab2 === 'invitados') loadInvitados();
  };

  const handleTrfChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setTrfForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleImgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setTrfError('La imagen no debe superar 5 MB.'); return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      setImgPreview(dataUrl);
      setImgBase64(dataUrl.replace(/^data:[^;]+;base64,/, ''));
    };
    reader.readAsDataURL(file);
  };

  const resetTrfForm = () => {
    setShowTrf(false);
    setTrfForm(EMPTY_TRF);
    setImgBase64(null);
    setImgPreview(null);
    setTrfError(null);
  };

  const handleEnviarTransferencia = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrfError(null);
    if (!trfForm.monto || !trfForm.referencia || !trfForm.banco || !trfForm.fecha_transferencia) {
      setTrfError('Todos los campos son requeridos.'); return;
    }
    if (Number(trfForm.monto) <= 0) { setTrfError('El monto debe ser mayor a 0.'); return; }
    setEnviando(true);
    try {
      const nuevo = await crearTransferencia({
        monto: Number(trfForm.monto),
        referencia: trfForm.referencia,
        banco: trfForm.banco,
        fecha_transferencia: trfForm.fecha_transferencia,
        comprobante: imgBase64 || undefined,
      });
      setMisPagos(prev => [nuevo, ...prev]);
      resetTrfForm();
      showToast(t('portal.receiptSent'), 'success');
    } catch (err: unknown) {
      setTrfError(err instanceof Error ? err.message : 'Error al enviar');
    } finally {
      setEnviando(false);
    }
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!form.numero_dpi.trim() && !form.placa.trim()) {
      setFormError('Se requiere al menos DPI o placa del visitante.');
      return;
    }
    setSaving(true);
    try {
      const created = await createMisPreautorizacion({
        nombre_visitante: form.nombre_visitante,
        numero_dpi:       form.numero_dpi || undefined,
        placa:            form.placa || undefined,
        fecha_inicio:     today(),
      });
      setPreauths(prev => [created, ...prev].filter(p => p.fecha_fin === null));
      setShowForm(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handlePreautHoy = async (p: MiPreautorizacion) => {
    setFormError(null);
    setSaving(true);
    try {
      await createMisPreautorizacion({
        nombre_visitante: p.nombre_visitante,
        numero_dpi:       p.numero_dpi || undefined,
        placa:            p.placa || undefined,
        fecha_inicio:     today(),
        fecha_fin:        today(),
      });
      showToast('Preautorización de hoy creada', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al preautorizar', 'error');
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
      <div className="flex items-center justify-center py-24">
        <p className="text-gray-400 text-sm">{t('common.loading')}</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="bg-red-900/40 border border-red-700 rounded-xl p-8 text-center max-w-sm">
          <p className="text-red-300 font-semibold">{error}</p>
        </div>
      </div>
    );
  }

  const saldo = parseFloat(data!.saldo_pendiente);

  return (
    <main className="px-6 py-8 space-y-6 max-w-3xl mx-auto text-gray-100">
      {/* Summary card */}
      <div className="bg-gray-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-gray-400 text-sm">{t('portal.house')}</p>
            <p className="text-3xl font-bold text-white mt-1">{data!.numero_casa}</p>
          </div>
          <span className={`mt-1 px-3 py-1 rounded-full text-sm font-semibold ${BADGE[data!.estado_pago] ?? 'bg-gray-600 text-gray-200'}`}>
            {BADGE_LABEL[data!.estado_pago] ?? data!.estado_pago}
          </span>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 gap-4">
          <div>
            <p className="text-gray-400 text-xs">{t('portal.pendingBalance')}</p>
            <p className={`text-xl font-semibold mt-0.5 ${saldo > 0 ? 'text-red-400' : 'text-green-400'}`}>
              Q{saldo.toFixed(2)}
            </p>
          </div>
          {data!.telefono && (
            <div>
              <p className="text-gray-400 text-xs">{t('common.phone')}</p>
              <p className="text-white text-sm mt-0.5">{data!.telefono}</p>
            </div>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex rounded-xl overflow-hidden border border-gray-700">
        {(['pagos', 'invitados'] as const).map(tabKey => (
          <button
            key={tabKey}
            onClick={() => handleTabChange(tabKey)}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
              tab === tabKey
                ? 'bg-emerald-500 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {tabKey === 'pagos' ? t('portal.payments') : t('portal.visitors')}
          </button>
        ))}
      </div>

      {/* ── Tab: Pagos ── */}
      {tab === 'pagos' && (
        <div className="space-y-4">
          {/* Realizar Pago card */}
          <div className="bg-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div>
              <h2 className="text-base font-semibold text-white">{t('portal.makePayment')}</h2>
              <p className="text-sm text-gray-400 mt-0.5">
                {t('portal.pendingBalance')}:{' '}
                <span className={`font-semibold ${parseFloat(data!.saldo_pendiente) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  Q{parseFloat(data!.saldo_pendiente).toFixed(2)}
                </span>
              </p>
            </div>

            {!showTrf ? (
              <div className="space-y-3">
                <button
                  onClick={() => showToast(t('portal.cardComingSoon'), 'warning')}
                  className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-3 rounded-xl transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  {t('portal.payCard')}
                </button>
                <button
                  onClick={() => setShowTrf(true)}
                  className="w-full flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-gray-200 font-semibold py-3 rounded-xl transition-colors border border-gray-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  {t('portal.uploadReceipt')}
                </button>
              </div>
            ) : (
              <form onSubmit={handleEnviarTransferencia} className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">{t('portal.receiptTitle')}</h3>
                  <button type="button" onClick={resetTrfForm}
                    className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
                </div>
                {trfError && (
                  <p className="text-sm text-red-400 bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2">{trfError}</p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">{t('portal.amountLabel')} *</label>
                    <input type="number" name="monto" step="0.01" min="0.01" value={trfForm.monto}
                      onChange={handleTrfChange} placeholder="850.00"
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-400 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">{t('portal.bankLabel')} *</label>
                    <input type="text" name="banco" value={trfForm.banco}
                      onChange={handleTrfChange} placeholder="Banco Industrial"
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-400 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">{t('portal.reference')} *</label>
                    <input type="text" name="referencia" value={trfForm.referencia}
                      onChange={handleTrfChange} placeholder="TRF-789456123"
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-400 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">{t('portal.transferDate')} *</label>
                    <input type="date" name="fecha_transferencia" value={trfForm.fecha_transferencia}
                      onChange={handleTrfChange}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                </div>

                {/* Image upload */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('portal.receiptImage')}</label>
                  <label className="flex items-center gap-2 w-full cursor-pointer bg-gray-700 border border-dashed border-gray-500 hover:border-blue-500 rounded-lg px-3 py-2.5 transition-colors">
                    <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm text-gray-400 truncate">
                      {imgPreview ? t('portal.imageSelected') : t('portal.selectImage')}
                    </span>
                    <input type="file" accept="image/*" onChange={handleImgChange} className="hidden" />
                  </label>
                  {imgPreview && (
                    <div className="mt-2 relative">
                      <img src={imgPreview} alt="Vista previa" className="w-full max-h-40 object-contain rounded-lg border border-gray-600 bg-gray-900" />
                      <button type="button" onClick={() => { setImgBase64(null); setImgPreview(null); }}
                        className="absolute top-1 right-1 bg-gray-900/80 hover:bg-red-900/80 text-gray-300 hover:text-red-300 rounded-full w-6 h-6 flex items-center justify-center text-xs transition-colors">
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 pt-1">
                  <button type="submit" disabled={enviando}
                    className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm">
                    {enviando && <Spinner size={14} />}
                    {enviando ? t('portal.sending') : t('portal.sendReceipt')}
                  </button>
                  <button type="button" onClick={resetTrfForm}
                    className="bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium px-4 py-2.5 rounded-xl transition-colors text-sm">
                    {t('common.cancel')}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Historial de Pagos */}
          <div>
            <h2 className="text-base font-semibold text-white mb-3">{t('portal.payHistory')}</h2>
            {pagosLoading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner size={24} />
              </div>
            ) : misPagos.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">{t('portal.noPayments')}</p>
            ) : (
              <div className="space-y-3">
                {misPagos.map(p => (
                  <div key={p.id} className="bg-gray-800 rounded-xl p-4 shadow border border-gray-700 flex items-center gap-4">
                    <div className="w-10 h-10 bg-emerald-900/40 rounded-full flex items-center justify-center border border-emerald-700/40 shrink-0">
                      <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-white font-semibold text-sm">Q{parseFloat(p.monto).toFixed(2)}</p>
                        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${PAGO_ESTADO_CLASS[p.estado] ?? 'bg-gray-600 text-gray-200 border-gray-500'}`}>
                          {PAGO_ESTADO_LABEL[p.estado] ?? p.estado}
                        </span>
                      </div>
                      <p className="text-gray-400 text-xs mt-0.5">
                        {new Date(p.fecha_pago).toLocaleDateString('es-GT')} | {PAGO_METODO_LABEL[p.metodo] ?? p.metodo}
                      </p>
                      {p.referencia && (
                        <p className="text-gray-500 text-xs mt-0.5 font-mono">{p.referencia}</p>
                      )}
                      {p.estado === 'rechazado' && p.comentario_rechazo && (
                        <p className="text-xs text-red-400/80 italic mt-1">Motivo: "{p.comentario_rechazo}"</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Invitados ── */}
      {tab === 'invitados' && (
        <div className="space-y-8">
          {invLoading ? (
            <p className="text-gray-400 text-sm text-center py-10">{t('common.loading')}</p>
          ) : (
            <>
              {/* Visitantes guardados */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-white">Visitantes guardados</h2>
                  {!showForm && (
                    <button
                      onClick={() => setShowForm(true)}
                      className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      Guardar visitante
                    </button>
                  )}
                </div>

                {/* Inline create form */}
                {showForm && (
                  <div ref={formRef}>
                    <form onSubmit={handleSave} className="bg-gray-800 rounded-2xl p-6 mb-4 space-y-4 shadow-xl">
                      <h3 className="text-sm font-semibold text-white">Guardar datos del visitante</h3>
                      <p className="text-xs text-gray-400">Guarda los datos para preautorizar con un clic en cualquier momento.</p>

                      {formError && (
                        <div className="bg-red-50 border border-red-300 rounded-lg px-3 py-2 text-red-700 text-sm">
                          {formError}
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="sm:col-span-3">
                          <label className="block text-xs text-gray-400 mb-1">{t('portal.visitorName')} *</label>
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
                          <label className="block text-xs text-gray-400 mb-1">
                            {t('portal.dpi')}
                            <span className="ml-1 text-gray-500">(requerido si no hay placa)</span>
                          </label>
                          <input
                            name="numero_dpi"
                            value={form.numero_dpi}
                            onChange={handleFormChange}
                            placeholder="1234567890101"
                            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            {t('portal.plate')}
                            <span className="ml-1 text-gray-500">(requerido si no hay DPI)</span>
                          </label>
                          <input
                            name="placa"
                            value={form.placa}
                            onChange={handleFormChange}
                            placeholder="P-123ABC"
                            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm focus:outline-none focus:border-blue-500 uppercase"
                          />
                        </div>
                      </div>

                      <div className="flex gap-3 pt-1">
                        <button
                          type="submit"
                          disabled={saving}
                          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
                        >
                          {saving ? t('common.saving') : 'Guardar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowForm(false); setFormError(null); setForm(EMPTY_FORM); }}
                          className="bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium px-5 py-2 rounded-lg transition-colors"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* Cards — only show saved data (fecha_fin === null) */}
                {preauths.filter(p => p.fecha_fin === null).length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-8">No hay visitantes guardados.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {preauths.filter(p => p.fecha_fin === null).map(p => (
                      <div key={p.id} className="bg-gray-800 rounded-xl p-4 shadow border border-gray-700">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-white text-sm">{p.nombre_visitante}</p>
                          <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full font-medium shrink-0">
                            Guardado
                          </span>
                        </div>
                        <div className="mt-2 space-y-0.5 text-xs text-gray-400">
                          {p.numero_dpi && <p>{t('portal.dpi')}: {p.numero_dpi}</p>}
                          {p.placa      && <p>{t('portal.plate')}: {p.placa}</p>}
                        </div>
                        <div className="mt-3 flex items-center gap-3">
                          <button
                            onClick={() => handlePreautHoy(p)}
                            disabled={saving}
                            className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium px-3 py-1 rounded-lg transition-colors"
                          >
                            Preautorizar hoy
                          </button>
                          <button
                            onClick={() => handleDelete(p.id, p.nombre_visitante)}
                            disabled={deletingId === p.id}
                            className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                          >
                            {deletingId === p.id ? t('portal.deleting') : t('common.delete')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Historial */}
              <section>
                <h2 className="text-base font-semibold text-white mb-4">{t('portal.visitHistory')}</h2>
                {visitas.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-8">{t('portal.noVisits')}</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {visitas.map(v => (
                      <div key={v.id} className="bg-gray-800 rounded-xl p-4 shadow border border-gray-700">
                        <p className="font-semibold text-white text-sm">{v.nombre_visitante}</p>
                        <div className="mt-2 space-y-0.5 text-xs text-gray-400">
                          <p>{t('portal.dpi')}: {v.numero_dpi}</p>
                          {v.placa && <p>{t('portal.plate')}: {v.placa}</p>}
                          <p className="text-gray-300 mt-1">
                            {t('portal.entry')}: {new Date(v.timestamp_entrada).toLocaleString('es-GT', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                          </p>
                          {v.timestamp_salida ? (
                            <p>{t('portal.exit')}: {new Date(v.timestamp_salida).toLocaleString('es-GT', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</p>
                          ) : (
                            <span className="inline-block bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full mt-1">
                              {t('portal.active')}
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
