import { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import {
  getResidentes,
  registrarAcceso,
  decodeTokenPayload,
  scanDPI,
  scanPlaca,
  buscarPreautorizacion,
  buscarVisitantesFrecuentes,
  verificarInvitacionQr,
  getConfigQr,
  BlacklistDenialError,
  type Residente,
  type VisitanteFrecuente,
  type InvitacionQrVerificada,
  type ConfigQr,
  type AccesoPayload,
} from '../services/api';
import { useTranslation } from '../i18n/useTranslation';
import { Button, ErrorState } from '../components/ui';
import { idDeCodigoManual } from '../utils/qr';
import { formatearPlaca, normalizarPlaca, placaParaInput } from '../utils/placa';
import PlacaInput from '../components/PlacaInput';
import { formatearFecha, formatearHora } from '../utils/fecha';

const QR_PREFIX = 'SGQR:';

interface UltimoIngreso {
  id: string;
  hora: string;
  visitante: string;
  placa: string;
  unidad: string;
  estado: 'Autorizado' | 'Denegado';
}

const EMPTY_FORM = {
  nombre_visitante: '',
  numero_dpi: '',
  residente_id: '',
  placa: '',
  invitacion_qr_id: '',
};

export default function GaritaPage() {
  const { t } = useTranslation();
  const [form, setForm]               = useState(EMPTY_FORM);
  const [residentes, setResidentes]   = useState<Residente[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [sinSesion, setSinSesion]     = useState(false);
  const [dpiOcr, setDpiOcr]           = useState(false);
  const [placaOcr, setPlacaOcr]       = useState(false);
  const [ocringDpi, setOcringDpi]     = useState(false);
  const [ocringPlaca, setOcringPlaca] = useState(false);
  const [ocrDpiMsg, setOcrDpiMsg]     = useState<string | null>(null);
  const [ocrPlacaMsg, setOcrPlacaMsg] = useState<string | null>(null);
  const [ultimosIngresos, setUltimosIngresos] = useState<UltimoIngreso[]>([]);
  const [preautorizado, setPreautorizado] = useState(false);
  const [casaSearch, setCasaSearch]   = useState('');
  const [casaOpen, setCasaOpen]       = useState(false);
  const [blacklistBlock, setBlacklistBlock] = useState<{
    razon: string; fecha_fin: string | null; motivo: 'dpi' | 'placa';
  } | null>(null);
  const [dpiHistorial, setDpiHistorial]     = useState(false);
  const [dpiSugerencias, setDpiSugerencias] = useState<VisitanteFrecuente[]>([]);
  const [dpiDropdownOpen, setDpiDropdownOpen] = useState(false);
  const [cargoAlert, setCargoAlert]         = useState<{
    monto: string; nombre: string; frecuencia: string; saldo: string;
  } | null>(null);
  const [extraMoraAlert, setExtraMoraAlert] = useState<{ monto: string } | null>(null);
  const [qrScanning, setQrScanning]   = useState(true);
  const [qrChecking, setQrChecking]   = useState(false);
  const [qrInvitacion, setQrInvitacion] = useState<InvitacionQrVerificada | null>(null);
  const [qrError, setQrError]         = useState<string | null>(null);
  const [configQr, setConfigQr]       = useState<ConfigQr | null>(null);

  const dpiVideoRef   = useRef<HTMLVideoElement>(null);
  const placaVideoRef = useRef<HTMLVideoElement>(null);
  const placaInputRef = useRef<HTMLInputElement>(null);
  const qrVideoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const qrCanvasRef   = useRef<HTMLCanvasElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);

  const hasCamera = !!(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setSinSesion(true); return; }
    getResidentes()
      .then(setResidentes)
      .catch(() => setError('No se pudo cargar la lista de residentes.'));
    getConfigQr().then(setConfigQr).catch(() => {});

    if (!hasCamera) return;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        streamRef.current = stream;
        if (dpiVideoRef.current)   dpiVideoRef.current.srcObject = stream;
        if (placaVideoRef.current) placaVideoRef.current.srcObject = stream;
        if (qrVideoRef.current)    qrVideoRef.current.srcObject = stream;
      } catch (err) {
        console.warn('Cámara no disponible:', err);
      }
    })();

    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, [hasCamera]);

  /**
   * Envía el registro de acceso con datos explícitos (no lee `form`) —
   * necesario para la autorización automática por QR, donde `handleQrDecoded`
   * no puede confiar en que `setForm` ya se haya aplicado (batching de React)
   * en el mismo tick en el que decide auto-enviar. El botón "Autorizar"
   * simplemente llama esto con el `form` actual.
   */
  const autorizarConDatos = useCallback(async (
    datos: Pick<AccesoPayload, 'nombre_visitante' | 'numero_dpi' | 'residente_id' | 'placa' | 'invitacion_qr_id'>
  ) => {
    if (!datos.nombre_visitante || !datos.numero_dpi || !datos.residente_id) {
      setError('Nombre, DPI y casa destino son requeridos.');
      return;
    }
    setError(null);
    const token = localStorage.getItem('token');
    if (!token) { setSinSesion(true); return; }
    const payload = decodeTokenPayload(token);
    if (!payload?.id) { setError('Token inválido.'); return; }
    setLoading(true);
    try {
      const result = await registrarAcceso({
        nombre_visitante: datos.nombre_visitante,
        numero_dpi:       datos.numero_dpi,
        residente_id:     datos.residente_id,
        agente_id:        payload.id as string,
        placa:            normalizarPlaca(datos.placa) || undefined,
        invitacion_qr_id: datos.invitacion_qr_id || undefined,
      });
      const residente = residentes.find(r => r.id === datos.residente_id);
      setUltimosIngresos(prev => [{
        id:        crypto.randomUUID(),
        hora:      formatearHora(new Date(), true),
        visitante: datos.nombre_visitante,
        placa:     formatearPlaca(datos.placa) || '—',
        unidad:    residente ? `Casa ${residente.numero_casa}` : '—',
        estado:    'Autorizado' as const,
      }, ...prev].slice(0, 10));
      const cg = result.cargo_generado;
      const extraMora = result.cargo_extra_mora;
      resetForm();
      if (cg) {
        const frecLabel = cg.frecuencia === 'unica_vez' ? 'única vez'
          : cg.frecuencia === 'quincenal' ? 'quincenal' : 'mensual';
        setCargoAlert({
          monto:     parseFloat(cg.monto).toFixed(2),
          nombre:    cg.nombre,
          frecuencia: frecLabel,
          saldo:     result.saldo_pendiente_actualizado.toFixed(2),
        });
      }
      if (extraMora != null && extraMora > 0) {
        setExtraMoraAlert({ monto: extraMora.toFixed(2) });
      }
    } catch (err: unknown) {
      if (err instanceof BlacklistDenialError) {
        setBlacklistBlock({ razon: err.razon, fecha_fin: err.fecha_fin, motivo: err.motivo });
      } else {
        setError(err instanceof Error ? err.message : 'Error al registrar');
      }
    } finally {
      setLoading(false);
    }
  }, [residentes]);

  const handleQrDecoded = useCallback(async (id: string) => {
    setQrChecking(true);
    setQrError(null);
    try {
      const inv = await verificarInvitacionQr(id);
      setQrInvitacion(inv);
      setForm(prev => ({
        ...prev,
        invitacion_qr_id: inv.id,
        residente_id: inv.residente_id,
        ...(inv.tipo === 'individual'
          ? { nombre_visitante: inv.nombre_visitante ?? prev.nombre_visitante, numero_dpi: inv.numero_dpi ?? prev.numero_dpi }
          : {}),
        ...(inv.placa ? { placa: placaParaInput(inv.placa) } : {}),
      }));

      // Autorización automática: sólo para QR individuales completos (nombre
      // + DPI ya en la invitación) — un QR grupal siempre necesita que el
      // agente identifique a la persona que tiene enfrente. Si la sucursal
      // exige placa, sólo se auto-autoriza si la invitación ya trae una
      // registrada (si no, el agente debe escanearla/escribirla primero).
      const puedeAutoAutorizar =
        configQr?.autorizacion_automatica &&
        inv.tipo === 'individual' && inv.nombre_visitante && inv.numero_dpi &&
        (!configQr.requiere_placa || !!inv.placa);
      if (puedeAutoAutorizar) {
        autorizarConDatos({
          nombre_visitante: inv.nombre_visitante!,
          numero_dpi: inv.numero_dpi!,
          residente_id: inv.residente_id,
          placa: inv.placa ?? undefined,
          invitacion_qr_id: inv.id,
        });
      }
    } catch (err) {
      setQrError(err instanceof Error ? err.message : t('gate.qrInvalidPrefix'));
      setTimeout(() => setQrScanning(true), 2500);
    } finally {
      setQrChecking(false);
    }
  }, [t, configQr, autorizarConDatos]);

  // Escaneo continuo: mientras no haya una invitación resuelta, muestrea la
  // cámara cada ~350ms buscando un QR de SecureGate (prefijo SGQR:).
  useEffect(() => {
    if (!hasCamera || !qrScanning || qrInvitacion || qrChecking) return;
    const interval = setInterval(() => {
      const video  = qrVideoRef.current;
      const canvas = qrCanvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width  = video.videoWidth  || 640;
      canvas.height = video.videoHeight || 480;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code?.data?.startsWith(QR_PREFIX)) {
        setQrScanning(false);
        handleQrDecoded(code.data.slice(QR_PREFIX.length));
      }
    }, 350);
    return () => clearInterval(interval);
  }, [hasCamera, qrScanning, qrInvitacion, qrChecking, handleQrDecoded]);

  /** Sin cámara (o con el QR dañado) el agente escribe o pega el código de la invitación. */
  const [qrManual, setQrManual] = useState('');
  const handleQrManual = (e: React.FormEvent) => {
    e.preventDefault();
    const id = idDeCodigoManual(qrManual);
    if (!id) { setQrError(t('gate.qrManualInvalid')); return; }
    setQrManual('');
    void handleQrDecoded(id);
  };

  const handleQrRescan = () => {
    setQrInvitacion(null);
    setQrError(null);
    setForm(prev => ({ ...prev, invitacion_qr_id: '' }));
    setQrScanning(true);
  };

  const captureFrame = (videoRef: React.RefObject<HTMLVideoElement | null>): string | null => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9).replace(/^data:image\/jpeg;base64,/, '');
  };

  const handleCaptureDpi = async () => {
    const base64 = captureFrame(dpiVideoRef);
    if (!base64) return;
    setOcringDpi(true);
    setOcrDpiMsg(null);
    try {
      const res = await scanDPI(base64);
      if (res.nombre || res.numero_dpi) {
        setForm(prev => ({
          ...prev,
          nombre_visitante: res.nombre || prev.nombre_visitante,
          numero_dpi:       res.numero_dpi || prev.numero_dpi,
        }));
        setDpiOcr(true);
        setDpiHistorial(false);
        setDpiDropdownOpen(false);
        if (res.numero_dpi) {
          const match = await buscarPreautorizacion({ dpi: res.numero_dpi });
          if (match) {
            setForm(prev => ({
              ...prev,
              nombre_visitante: match.nombre_visitante || prev.nombre_visitante,
              numero_dpi:       match.numero_dpi || prev.numero_dpi,
              placa:            match.placa ? placaParaInput(match.placa) : prev.placa,
              residente_id:     match.residente_id,
            }));
            setPreautorizado(true);
          }
        }
      } else {
        setOcrDpiMsg(t('gate.dpiReadFail'));
      }
    } catch {
      setOcrDpiMsg(t('gate.imageError'));
    } finally {
      setOcringDpi(false);
    }
  };

  const handleCapturePlaca = async () => {
    const base64 = captureFrame(placaVideoRef);
    if (!base64) return;
    setOcringPlaca(true);
    setOcrPlacaMsg(null);
    try {
      const res = await scanPlaca(base64);
      if (res.placa) {
        setForm(prev => ({ ...prev, placa: placaParaInput(res.placa) }));
        setPlacaOcr(true);
        const match = await buscarPreautorizacion({ placa: res.placa });
        if (match) {
          setForm(prev => ({
            ...prev,
            nombre_visitante: match.nombre_visitante || prev.nombre_visitante,
            numero_dpi:       match.numero_dpi || prev.numero_dpi,
            placa:            match.placa ? placaParaInput(match.placa) : prev.placa,
            residente_id:     match.residente_id,
          }));
          setPreautorizado(true);
        }
      } else {
        setOcrPlacaMsg(t('gate.plateReadFail'));
      }
    } catch {
      setOcrPlacaMsg(t('gate.imageError'));
    } finally {
      setOcringPlaca(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleDpiChange = useCallback(async (val: string) => {
    setForm(prev => ({ ...prev, numero_dpi: val }));
    setDpiHistorial(false);
    if (val.length < 4) { setDpiSugerencias([]); setDpiDropdownOpen(false); return; }
    const sugs = await buscarVisitantesFrecuentes(val, form.residente_id || undefined);
    setDpiSugerencias(sugs);
    setDpiDropdownOpen(sugs.length > 0);
  }, [form.residente_id]);

  const selectSugerencia = (v: VisitanteFrecuente) => {
    setForm(prev => ({
      ...prev,
      nombre_visitante: v.nombre,
      numero_dpi:       v.numero_dpi,
      placa:            v.placa ? placaParaInput(v.placa) : prev.placa,
    }));
    setDpiHistorial(true);
    setDpiSugerencias([]);
    setDpiDropdownOpen(false);
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setCasaSearch('');
    setDpiOcr(false);
    setPlacaOcr(false);
    setPreautorizado(false);
    setError(null);
    setOcrDpiMsg(null);
    setOcrPlacaMsg(null);
    setBlacklistBlock(null);
    setDpiHistorial(false);
    setDpiSugerencias([]);
    setDpiDropdownOpen(false);
    setCargoAlert(null);
    setExtraMoraAlert(null);
    setQrInvitacion(null);
    setQrError(null);
    setQrScanning(true);
  };

  const diasDesde = (ts: string | null): string => {
    if (!ts) return 'sin visitas';
    const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000);
    return d === 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`;
  };

  const handleAutorizar = () => autorizarConDatos(form);

  const handleDenegar = () => {
    const residente = residentes.find(r => r.id === form.residente_id);
    setUltimosIngresos(prev => [{
      id:        crypto.randomUUID(),
      hora:      formatearHora(new Date(), true),
      visitante: form.nombre_visitante || 'Desconocido',
      placa:     formatearPlaca(form.placa) || '—',
      unidad:    residente ? `Casa ${residente.numero_casa}` : '—',
      estado:    'Denegado' as const,
    }, ...prev].slice(0, 10));
    resetForm();
  };

  const selectedResidente = residentes.find(r => r.id === form.residente_id);
  const filteredResidentes = casaSearch
    ? residentes.filter(r =>
        r.numero_casa.toLowerCase().includes(casaSearch.toLowerCase()) ||
        r.nombre.toLowerCase().includes(casaSearch.toLowerCase())
      )
    : residentes;

  if (sinSesion) {
    return (
      <ErrorState title={t('gate.noSession')} description={t('gate.noSessionDesc')} />
    );
  }

  return (
    <div className="flex min-h-full flex-col text-gray-100 lg:flex-row">
      <canvas ref={canvasRef} className="hidden" />

      {/* Blocking blacklist modal — must be dismissed before continuing */}
      {blacklistBlock && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="sg-card w-full max-w-md rounded-3xl border-2 border-red-600 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-red-950 flex items-center justify-center shrink-0">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
                  <circle cx="12" cy="12" r="10" /><line x1="4.9" y1="4.9" x2="19.1" y2="19.1" />
                </svg>
              </div>
              <h2 className="text-red-300 font-bold text-lg uppercase tracking-wide">
                {t('blacklist.blockedTitle')}
              </h2>
            </div>
            <p className="text-red-200 text-sm">
              {t(blacklistBlock.motivo === 'placa' ? 'blacklist.blockedByPlate' : 'blacklist.blockedAlert')}
            </p>
            <div className="bg-red-950/60 border border-red-800 rounded-xl px-4 py-3 space-y-1">
              <p className="text-red-200 text-sm">
                <span className="font-semibold">{t('blacklist.reason')}:</span> {blacklistBlock.razon}
              </p>
              <p className="text-red-300 text-sm">
                {blacklistBlock.fecha_fin
                  ? `${t('blacklist.expiresOn')} ${formatearFecha(blacklistBlock.fecha_fin)}`
                  : t('blacklist.permanent')}
              </p>
            </div>
            <button
              onClick={resetForm}
              className="w-full bg-red-700 hover:bg-red-600 text-white font-semibold py-2.5 rounded-xl transition-colors"
            >
              {t('blacklist.close')}
            </button>
          </div>
        </div>
      )}

      {/* Camera column — top on mobile, left on desktop */}
          <div className="w-full space-y-3 border-b border-gray-700 p-4 lg:min-h-0 lg:w-1/2 lg:border-b-0 lg:border-r">

        {!hasCamera ? (
          /* No camera available — HTTPS required */
          <div className="sg-card flex min-h-64 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
            <p className="text-gray-400 text-sm font-medium">{t('gate.cameraUnavailable')}</p>
            <p className="text-gray-500 text-xs">{t('gate.httpsRequired')}</p>
            <p className="text-gray-300 text-sm">{t('gate.noCameraHint')}</p>

            <Button
              variant="secondary"
              onClick={() => { placaInputRef.current?.focus(); placaInputRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); }}
            >
              {t('gate.writePlate')}
            </Button>

            {/* Código de la invitación QR escrito a mano */}
            <form onSubmit={handleQrManual} aria-label={t('gate.qrManualTitle')} className="w-full max-w-sm space-y-2 border-t border-gray-700 pt-4 text-left">
              <label htmlFor="qr-manual" className="block text-xs font-semibold text-gray-300">{t('gate.qrManualTitle')}</label>
              <input
                id="qr-manual"
                value={qrManual}
                onChange={e => { setQrManual(e.target.value); setQrError(null); }}
                placeholder={t('gate.qrManualPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className="sg-input font-mono"
              />
              <Button type="submit" variant="secondary" fullWidth loading={qrChecking} disabled={!qrManual.trim()}>
                {t('gate.qrManualVerify')}
              </Button>
              {qrInvitacion ? (
                <p role="status" className="text-xs text-emerald-400">
                  {t('gate.qrValid')} · {qrInvitacion.etiqueta || qrInvitacion.nombre_visitante || qrInvitacion.residente_nombre}
                </p>
              ) : qrError ? (
                <p role="alert" className="text-xs text-red-400">{qrError}</p>
              ) : null}
            </form>
          </div>
        ) : (
          <>
            {/* DPI scanner */}
            <div className="sg-card flex min-h-64 flex-1 flex-col overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-700 shrink-0">
                <span className="text-sm font-semibold text-gray-200">{t('gate.dpiScanner')}</span>
                {dpiOcr && (
                  <span className="text-xs bg-emerald-700 text-white px-2 py-0.5 rounded-full font-medium">OCR</span>
                )}
              </div>
              <div className="flex-1 bg-gray-900 min-h-0 overflow-hidden">
                <video ref={dpiVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              </div>
              {ocrDpiMsg && (
                <p className="px-4 py-1 text-xs text-red-400 border-t border-gray-700 shrink-0">{ocrDpiMsg}</p>
              )}
              <div className="p-3 border-t border-gray-700 shrink-0">
                <button
                  onClick={handleCaptureDpi}
                  disabled={ocringDpi}
                  className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold py-2 rounded-xl transition-colors text-sm"
                >
                  {ocringDpi ? t('common.processing') : t('gate.scanDocument')}
                </button>
              </div>
            </div>

            {/* Plate scanner */}
            <div className="sg-card flex min-h-64 flex-1 flex-col overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-700 shrink-0">
                <span className="text-sm font-semibold text-gray-200">{t('gate.plateScanner')}</span>
                {placaOcr && (
                  <span className="text-xs bg-emerald-700 text-white px-2 py-0.5 rounded-full font-medium">OCR</span>
                )}
              </div>
              <div className="flex-1 bg-gray-900 min-h-0 overflow-hidden">
                <video ref={placaVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              </div>
              {ocrPlacaMsg && (
                <p className="px-4 py-1 text-xs text-red-400 border-t border-gray-700 shrink-0">{ocrPlacaMsg}</p>
              )}
              <div className="p-3 border-t border-gray-700 shrink-0">
                <button
                  onClick={handleCapturePlaca}
                  disabled={ocringPlaca}
                  className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold py-2 rounded-xl transition-colors text-sm"
                >
                  {ocringPlaca ? t('common.processing') : t('gate.scanPlate')}
                </button>
              </div>
            </div>

            {/* QR scanner */}
            <div className="sg-card flex min-h-64 flex-1 flex-col overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-700 shrink-0">
                <span className="text-sm font-semibold text-gray-200">{t('gate.qrScanner')}</span>
                {qrInvitacion && (
                  <span className="text-xs bg-emerald-700 text-white px-2 py-0.5 rounded-full font-medium">
                    {t('gate.qrValid')}
                  </span>
                )}
              </div>
              <div className="flex-1 bg-gray-900 min-h-0 overflow-hidden relative">
                <video ref={qrVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                <canvas ref={qrCanvasRef} className="hidden" />
              </div>
              <div className="px-4 py-2 border-t border-gray-700 shrink-0 space-y-1">
                {qrInvitacion ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-emerald-400 truncate">
                      {qrInvitacion.etiqueta || qrInvitacion.nombre_visitante || t('gate.qrValid')}
                      {' · '}{qrInvitacion.residente_nombre}
                    </p>
                    <Button variant="secondary" size="sm" className="shrink-0" onClick={handleQrRescan}>
                      {t('gate.qrRescan')}
                    </Button>
                  </div>
                ) : qrError ? (
                  <p className="text-xs text-red-400">{qrError}</p>
                ) : qrChecking ? (
                  <p className="text-xs text-gray-400">{t('common.processing')}</p>
                ) : (
                  <p className="text-xs text-gray-500">{t('gate.qrScanning')}</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Form column — bottom on mobile, right on desktop */}
          <div className="w-full space-y-3 overflow-y-auto p-4 lg:w-1/2">

        {/* Datos del visitante */}
        <div className="sg-card p-5 sm:p-6 space-y-4 shrink-0">
          <h2 className="text-base font-bold text-white">{t('gate.visitorData')}</h2>

          {error && (
            <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-2 text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Nombre */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('gate.visitorName')} *</label>
              <input
                name="nombre_visitante"
                value={form.nombre_visitante}
                onChange={handleChange}
                disabled={qrInvitacion?.tipo === 'individual'}
                placeholder="Juan Pérez"
                className="sg-input disabled:opacity-60"
              />
            </div>

            {/* DPI — with frecuentes autocomplete */}
            <div className="relative">
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs text-gray-400">{t('gate.dpi')} *</label>
                {dpiOcr && (
                  <span className="text-xs bg-emerald-700 text-white px-1.5 py-0.5 rounded font-medium">OCR</span>
                )}
                {dpiHistorial && !dpiOcr && (
                  <span className="text-xs bg-brand-500 text-brand-ink px-1.5 py-0.5 rounded font-medium">Historial</span>
                )}
              </div>
              <input
                name="numero_dpi"
                value={form.numero_dpi}
                onChange={e => handleDpiChange(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && setDpiDropdownOpen(false)}
                onBlur={() => setTimeout(() => setDpiDropdownOpen(false), 150)}
                disabled={qrInvitacion?.tipo === 'individual' && !!qrInvitacion.numero_dpi}
                placeholder="1234567890101"
                autoComplete="off"
                className="sg-input disabled:opacity-60"
              />
              {dpiDropdownOpen && dpiSugerencias.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-gray-700 border border-gray-600 rounded-lg shadow-xl max-h-48 overflow-y-auto left-0">
                  {dpiSugerencias.map(v => (
                    <button
                      key={v.id}
                      type="button"
                      onMouseDown={() => selectSugerencia(v)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-600 transition-colors border-b border-gray-600 last:border-0"
                    >
                      <p className="text-white text-xs font-medium truncate">{v.nombre}</p>
                      <p className="text-gray-400 text-xs font-mono">{v.numero_dpi}
                        {v.placa && <span className="ml-2 text-teal-400">{formatearPlaca(v.placa)}</span>}
                        <span className="ml-2 text-gray-500">{diasDesde(v.ultima_visita)}</span>
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Placa */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                {t('gate.plate')}{qrInvitacion && configQr?.requiere_placa ? ' *' : ''}
              </label>
              <PlacaInput
                ref={placaInputRef}
                name="placa"
                value={form.placa}
                onChange={placa => setForm(prev => ({ ...prev, placa }))}
                disabled={!!qrInvitacion?.placa}
                className="disabled:opacity-60"
              />
              {qrInvitacion && configQr?.requiere_placa && !form.placa && (
                <p className="text-xs text-amber-400 mt-1">{t('gate.qrPlateRequired')}</p>
              )}
            </div>

            {/* Casa / Unidad autocomplete */}
            <div className="relative">
              <label className="block text-xs text-gray-400 mb-1">{t('gate.houseUnit')} *</label>
              <input
                value={selectedResidente
                  ? `Casa ${selectedResidente.numero_casa} — ${selectedResidente.nombre}`
                  : casaSearch}
                onChange={e => {
                  setCasaSearch(e.target.value);
                  setForm(prev => ({ ...prev, residente_id: '' }));
                  setCasaOpen(true);
                }}
                onFocus={() => setCasaOpen(true)}
                onBlur={() => setTimeout(() => setCasaOpen(false), 150)}
                placeholder={t('gate.searchHouse')}
                className="sg-input"
              />
              {casaOpen && filteredResidentes.length > 0 && (
                <ul className="absolute z-20 w-full bg-gray-700 border border-gray-600 rounded-lg mt-1 max-h-36 overflow-y-auto shadow-2xl">
                  {filteredResidentes.map(r => (
                    <li
                      key={r.id}
                      onMouseDown={() => {
                        setForm(prev => ({ ...prev, residente_id: r.id }));
                        setCasaSearch('');
                        setCasaOpen(false);
                      }}
                      className="px-3 py-2 text-sm text-white hover:bg-gray-600 cursor-pointer flex items-center justify-between"
                    >
                      <span>Casa {r.numero_casa} — {r.nombre}</span>
                      {r.estado_pago === 'mora' && (
                        <span className="text-yellow-400 text-xs font-semibold">⚠ {t('gate.mora')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Preauth banner */}
        {preautorizado && (
          <div className="bg-emerald-900/60 border-2 border-emerald-500 rounded-2xl px-5 py-4 flex items-center gap-3 shrink-0 shadow-xl">
            <span className="text-emerald-400 text-2xl font-black tracking-widest">✓ PREAUTORIZADO</span>
            <p className="text-emerald-300 text-sm">Visitante con preautorización activa para hoy. Datos auto-completados.</p>
          </div>
        )}

        {/* Cargo alert banner */}
        {cargoAlert && (
          <div className="bg-amber-900/60 border-2 border-amber-500 rounded-2xl px-5 py-4 space-y-1 shrink-0 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <p className="text-amber-300 font-bold text-sm">
                ⚠ Cargo aplicado: Q{cargoAlert.monto} — {cargoAlert.nombre} ({cargoAlert.frecuencia})
              </p>
              <button
                onClick={() => setCargoAlert(null)}
                className="text-amber-400 hover:text-amber-200 text-lg leading-none shrink-0 transition-colors"
              >✕</button>
            </div>
            <p className="text-amber-200 text-xs">Nuevo saldo pendiente: Q{cargoAlert.saldo}</p>
          </div>
        )}

        {/* Extra charge for entering while in mora (T-S5-03) */}
        {extraMoraAlert && (
          <div className="bg-red-900/60 border-2 border-red-500 rounded-2xl px-5 py-4 flex items-start justify-between gap-2 shrink-0 shadow-xl">
            <p className="text-red-300 font-bold text-sm">
              ⛔ Cargo extra de Q{extraMoraAlert.monto} aplicado por visita en mora
            </p>
            <button
              onClick={() => setExtraMoraAlert(null)}
              className="text-red-400 hover:text-red-200 text-lg leading-none shrink-0 transition-colors"
            >✕</button>
          </div>
        )}

        {/* Action buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 shrink-0">
          <button
            onClick={handleAutorizar}
            disabled={loading || !!blacklistBlock || !!(qrInvitacion && configQr?.requiere_placa && !form.placa)}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-5 rounded-2xl transition-colors text-sm tracking-widest shadow-xl"
          >
            {loading ? t('gate.registering') : t('gate.authorizeEntry')}
          </button>
          <button
            onClick={handleDenegar}
            className="bg-red-600 hover:bg-red-500 text-white font-bold py-5 rounded-2xl transition-colors text-sm tracking-widest shadow-xl"
          >
            {t('gate.denyEntry')}
          </button>
        </div>

        {/* Últimos Ingresos */}
        <div className="sg-card overflow-hidden shrink-0">
          <div className="px-5 py-3 border-b border-gray-700">
            <h3 className="text-sm font-bold text-white">{t('gate.lastEntries')}</h3>
          </div>
          {ultimosIngresos.length === 0 ? (
            <p className="text-gray-500 text-xs px-5 py-5 text-center">
              {t('gate.noEntries')}
            </p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-left">
                  <th className="px-4 py-2 font-medium">{t('gate.hour')}</th>
                  <th className="px-4 py-2 font-medium">{t('gate.visitorName')}</th>
                  <th className="px-4 py-2 font-medium">{t('gate.plate')}</th>
                  <th className="px-4 py-2 font-medium">{t('gate.unit')}</th>
                  <th className="px-4 py-2 font-medium">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {ultimosIngresos.map(ing => (
                  <tr key={ing.id} className="border-b border-gray-700/50 last:border-0">
                    <td className="px-4 py-2 text-gray-300">{ing.hora}</td>
                    <td className="px-4 py-2 text-white font-medium">{ing.visitante}</td>
                    <td className="px-4 py-2 text-gray-300 uppercase">{ing.placa}</td>
                    <td className="px-4 py-2 text-gray-300">{ing.unidad}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full font-semibold ${
                        ing.estado === 'Autorizado'
                          ? 'bg-emerald-900/60 text-emerald-400 border border-emerald-700'
                          : 'bg-red-900/60 text-red-400 border border-red-700'
                      }`}>
                        {ing.estado === 'Autorizado' ? t('gate.authorized') : t('gate.denied')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
