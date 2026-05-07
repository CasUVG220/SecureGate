import { useEffect, useState } from 'react';
import {
  getPendientesVerificacion,
  aprobarPago,
  rechazarPago,
  type PagoVerificacion,
} from '../services/api';
import { Spinner } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n/useTranslation';

export default function VerificacionPage() {
  const showToast = useToast();
  const { t } = useTranslation();
  const [cola, setCola]               = useState<PagoVerificacion[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState(0);
  const [comentario, setComentario]   = useState('');
  const [aprobando, setAprobando]     = useState(false);
  const [rechazando, setRechazando]   = useState(false);

  const load = () => {
    setLoading(true);
    getPendientesVerificacion()
      .then(data => { setCola(data); setSelected(0); })
      .catch(() => showToast('No se pudo cargar la cola de verificación.', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const current = cola[selected] ?? null;

  const handleAprobar = async () => {
    if (!current) return;
    setAprobando(true);
    try {
      await aprobarPago(current.id);
      showToast(t('verification.approvedMsg'), 'success');
      setCola(prev => prev.filter(p => p.id !== current.id));
      setSelected(0);
      setComentario('');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error al aprobar', 'error');
    } finally {
      setAprobando(false);
    }
  };

  const handleRechazar = async () => {
    if (!current) return;
    if (!comentario.trim()) {
      showToast(t('verification.commentRequired'), 'warning');
      return;
    }
    setRechazando(true);
    try {
      await rechazarPago(current.id, comentario.trim());
      showToast(t('verification.rejectedMsg'), 'warning');
      setCola(prev => prev.filter(p => p.id !== current.id));
      setSelected(0);
      setComentario('');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error al rechazar', 'error');
    } finally {
      setRechazando(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={32} />
      </div>
    );
  }

  if (cola.length === 0) {
    return (
      <div className="p-6 text-gray-100 max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-white">{t('verification.title')}</h1>
            <p className="text-sm text-gray-400 mt-0.5">{t('verification.subtitle')}</p>
          </div>
        </div>
        <div className="bg-gray-800 rounded-2xl p-12 text-center shadow-xl">
          <p className="text-gray-400 text-sm">{t('verification.noPending')}</p>
          <button onClick={load} className="mt-4 text-blue-400 hover:text-blue-300 text-sm transition-colors">
            {t('common.refresh')}
          </button>
        </div>
      </div>
    );
  }

  const monto   = current ? parseFloat(current.monto) : 0;
  const saldo   = current ? parseFloat(current.saldo_pendiente) : 0;
  const cubre   = monto >= saldo;

  const fmtFecha = (s: string | null) =>
    s ? new Date(s).toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

  return (
    <div className="p-6 text-gray-100 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">{t('verification.title')}</h1>
          <p className="text-sm text-gray-400 mt-0.5">{t('verification.subtitle')}</p>
        </div>
        <span className="flex items-center gap-2 bg-amber-500/20 border border-amber-500/40 text-amber-400 text-sm font-semibold px-4 py-1.5 rounded-full">
          ⏱ {cola.length} {cola.length !== 1 ? t('verification.pendingPlural') : t('verification.pending')}
        </span>
      </div>

      {/* Main content — two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left — Comprobante */}
        <div className="space-y-4">
          <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
            {/* Navigation */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {t('verification.receipt')}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelected(i => Math.max(0, i - 1))}
                  disabled={selected === 0}
                  className="text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
                >
                  ‹
                </button>
                <span className="text-xs text-gray-400">{selected + 1} / {cola.length}</span>
                <button
                  onClick={() => setSelected(i => Math.min(cola.length - 1, i + 1))}
                  disabled={selected === cola.length - 1}
                  className="text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
                >
                  ›
                </button>
              </div>
            </div>

            {/* Comprobante — image or metadata card */}
            <div className="p-4">
              {current?.comprobante ? (
                <div className="space-y-3">
                  <img
                    src={`data:image/jpeg;base64,${current.comprobante}`}
                    alt="Comprobante"
                    className="w-full rounded-xl border border-gray-600 bg-gray-900 object-contain max-h-72"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div className="space-y-1.5 text-sm px-1">
                    <div className="flex justify-between">
                      <span className="text-gray-400">{t('verification.bank')}:</span>
                      <span className="text-white font-medium">{current.banco ?? '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">{t('verification.reference')}:</span>
                      <span className="text-white font-mono text-xs">{current.referencia ?? '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">{t('common.amount')}:</span>
                      <span className="text-emerald-400 font-bold">Q{monto.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="border-2 border-dashed border-gray-600 rounded-xl p-6 bg-gray-900/40 space-y-4">
                  <div className="flex flex-col items-center text-center gap-2">
                    <div className="w-14 h-14 bg-emerald-900/40 rounded-full flex items-center justify-center border border-emerald-700/40">
                      <svg className="w-7 h-7 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-white font-semibold text-sm">{t('portal.receiptTitle')}</p>
                      <p className="text-gray-400 text-xs">{current?.banco ?? '—'}</p>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm border-t border-gray-700 pt-4">
                    <div className="flex justify-between">
                      <span className="text-gray-400">{t('verification.reference')}:</span>
                      <span className="text-white font-medium">{current?.referencia ?? '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">{t('common.date')}:</span>
                      <span className="text-white">{fmtFecha(current?.fecha_transferencia ?? null)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">{t('common.amount')}:</span>
                      <span className="text-emerald-400 font-bold">Q{monto.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="text-center pt-2">
                    <span className="text-xs text-gray-500 tracking-widest font-medium border border-gray-600 px-3 py-1 rounded">
                      {t('verification.noImage')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right — Details + Actions */}
        <div className="space-y-4">
          {/* Resident info */}
          <div className="bg-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div>
              <p className="text-xs text-gray-400 mb-2">Residente</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">{current?.residente_nombre}</p>
                  <p className="text-gray-400 text-xs">{current?.residente_email}</p>
                </div>
              </div>
              <div className="flex items-center justify-between mt-3 text-sm">
                <div className="flex items-center gap-2 text-gray-300">
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  {current?.numero_casa}
                </div>
                {current?.residente_telefono && (
                  <span className="text-gray-400">{current.residente_telefono}</span>
                )}
              </div>
            </div>

            {/* Montos */}
            <div className="grid grid-cols-2 gap-4 border-t border-gray-700 pt-4">
              <div>
                <p className="text-xs text-gray-400 mb-1">{t('verification.reportedAmount')}</p>
                <p className="text-2xl font-bold text-emerald-400">Q{monto.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">{t('verification.currentBalance')}</p>
                <p className={`text-2xl font-bold ${saldo > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  Q{saldo.toFixed(2)}
                </p>
              </div>
            </div>

            {/* Transfer details */}
            <div className="space-y-2 text-sm border-t border-gray-700 pt-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {t('verification.transferDate')}
                </span>
                <span className="text-white font-medium">{fmtFecha(current?.fecha_transferencia ?? null)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                  </svg>
                  {t('verification.reference')}
                </span>
                <span className="text-white font-mono text-xs">{current?.referencia ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                  </svg>
                  {t('verification.bank')}
                </span>
                <span className="text-white font-medium">{current?.banco ?? '—'}</span>
              </div>
            </div>

            {/* Coverage badge */}
            {cubre ? (
              <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-900/30 border border-emerald-700/40 rounded-xl px-4 py-2.5">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {t('verification.coversSaldo')}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-amber-400 text-sm bg-amber-900/30 border border-amber-700/40 rounded-xl px-4 py-2.5">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {t('verification.doesntCover')}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="bg-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-300 mb-2">
                <input
                  type="checkbox"
                  readOnly
                  checked={!!comentario}
                  className="accent-blue-500"
                />
                {t('verification.commentLabel')}
              </label>
              <textarea
                value={comentario}
                onChange={e => setComentario(e.target.value)}
                rows={3}
                placeholder={t('verification.commentPlaceholder')}
                className="w-full bg-gray-700 border border-gray-600 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleAprobar}
                disabled={aprobando || rechazando}
                className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition-colors"
              >
                {aprobando
                  ? <Spinner size={16} />
                  : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                }
                {aprobando ? t('verification.approving') : t('verification.approveBtn')}
              </button>
              <button
                onClick={handleRechazar}
                disabled={aprobando || rechazando}
                className="flex items-center justify-center gap-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition-colors"
              >
                {rechazando
                  ? <Spinner size={16} />
                  : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                }
                {rechazando ? t('verification.rejecting') : t('verification.rejectBtn')}
              </button>
            </div>
            <p className="text-center text-xs text-gray-500">
              {t('verification.updateNote')}
            </p>
          </div>
        </div>
      </div>

      {/* Verification queue */}
      <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-700">
          <h3 className="text-sm font-bold text-white">{t('verification.queue')}</h3>
        </div>
        <div className="flex gap-3 p-4 overflow-x-auto">
          {cola.map((p, i) => (
            <button
              key={p.id}
              onClick={() => { setSelected(i); setComentario(''); }}
              className={`shrink-0 w-48 rounded-xl p-3 text-left transition-colors border ${
                i === selected
                  ? 'border-blue-500 bg-blue-900/30'
                  : 'border-gray-700 bg-gray-700/40 hover:bg-gray-700/60'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 bg-gray-600 rounded-full flex items-center justify-center shrink-0">
                  <svg className="w-3 h-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-white text-xs font-medium truncate">{p.residente_nombre.split(' ').slice(0, 2).join(' ')}...</p>
                  <p className="text-gray-400 text-xs">{p.numero_casa}</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-emerald-400 text-sm font-bold">Q{parseFloat(p.monto).toFixed(2)}</span>
                <span className="text-gray-500 text-xs">
                  {new Date(p.fecha_pago).toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
