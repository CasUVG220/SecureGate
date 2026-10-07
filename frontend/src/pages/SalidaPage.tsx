import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getAccesoActivo,
  getAccesosActivos,
  registrarSalidaVehiculo,
  decodeTokenPayload,
  scanPlaca,
  type AccesoActivo,
} from '../services/api';
import { CardSkeleton } from '../components/Skeleton';
import { Button, ROW_ICON, RowActions } from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';
import { formatearFechaHora, formatearHora } from '../utils/fecha';
import { formatearPlaca, normalizarPlaca, placaParaInput } from '../utils/placa';
import PlacaInput from '../components/PlacaInput';

export default function SalidaPage() {
  const { t } = useTranslation();
  const [placa, setPlaca]               = useState('');
  const [searching, setSearching]       = useState(false);
  const [accesoActivo, setAccesoActivo] = useState<AccesoActivo | null>(null);
  const [notFound, setNotFound]         = useState(false);
  const [registrando, setRegistrando]   = useState(false);
  const [salidaOk, setSalidaOk]         = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [agenteNombre, setAgenteNombre] = useState('');

  // Camera / OCR state
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanning, setScanning]     = useState(false);
  const [ocrMsg, setOcrMsg]         = useState<string | null>(null);

  // Active visitors panel
  const [activos, setActivos]             = useState<AccesoActivo[]>([]);
  const [activosLoading, setActivosLoading] = useState(true);
  const [salidaActivoId, setSalidaActivoId] = useState<string | null>(null);

  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const loadActivos = useCallback(() => {
    setActivosLoading(true);
    getAccesosActivos()
      .then(setActivos)
      .catch(() => {})
      .finally(() => setActivosLoading(false));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const payload = decodeTokenPayload(token);
    if (payload) setAgenteNombre((payload.nombre as string) || (payload.email as string));
    loadActivos();
  }, [loadActivos]);

  void agenteNombre;

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => { stopCamera(); }, [stopCamera]);

  const hasCamera = !!(navigator.mediaDevices?.getUserMedia);

  const startCamera = async () => {
    if (!hasCamera) {
      setOcrMsg('Cámara no disponible (requiere HTTPS)');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      console.warn('Cámara no disponible:', err);
      setOcrMsg('No se pudo acceder a la cámara.');
    }
  };

  const handleToggleCamera = () => {
    if (cameraOpen) {
      stopCamera();
      setCameraOpen(false);
      setOcrMsg(null);
    } else {
      setCameraOpen(true);
      void startCamera();
    }
  };

  const resetBusqueda = () => {
    setAccesoActivo(null);
    setNotFound(false);
    setSalidaOk(false);
    setError(null);
  };

  const buscarPorPlaca = async (p: string) => {
    resetBusqueda();
    setSearching(true);
    try {
      const data = await getAccesoActivo(normalizarPlaca(p));
      if (data === null) setNotFound(true);
      else setAccesoActivo(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al buscar acceso');
    } finally {
      setSearching(false);
    }
  };

  const handleScanPlaca = async () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL('image/jpeg', 0.9).replace(/^data:image\/jpeg;base64,/, '');
    setScanning(true);
    setOcrMsg(null);
    try {
      const result = await scanPlaca(base64);
      if (result.placa) {
        setPlaca(placaParaInput(result.placa));
        setOcrMsg(`Placa detectada: ${formatearPlaca(result.placa)}`);
        stopCamera();
        setCameraOpen(false);
        void buscarPorPlaca(result.placa);
      } else {
        setOcrMsg('No se pudo leer la placa. Intenta de nuevo.');
      }
    } catch {
      setOcrMsg('Error al procesar la imagen.');
    } finally {
      setScanning(false);
    }
  };

  const handleBuscar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!placa.trim()) return;
    void buscarPorPlaca(placa);
  };

  const handleSalida = async () => {
    if (!accesoActivo) return;
    setRegistrando(true);
    setError(null);
    try {
      await registrarSalidaVehiculo(accesoActivo.registro_id);
      setSalidaOk(true);
      setAccesoActivo(null);
      loadActivos();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al registrar salida');
    } finally {
      setRegistrando(false);
    }
  };

  const handleSalidaActivo = async (registroId: string) => {
    setSalidaActivoId(registroId);
    try {
      await registrarSalidaVehiculo(registroId);
      loadActivos();
    } catch {
      // silently ignore
    } finally {
      setSalidaActivoId(null);
    }
  };

  const handleNuevaBusqueda = () => {
    setPlaca('');
    resetBusqueda();
  };

  return (
    <div className="text-gray-100">
      <main className="sg-page text-gray-100">
        <div className="w-full max-w-lg space-y-4">

          {/* Search form */}
          <form onSubmit={handleBuscar} className="sg-card space-y-5 p-5 sm:p-7">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">{t('exit.searchTitle')}</h2>
              {hasCamera ? (
                <button
                  type="button"
                  onClick={handleToggleCamera}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                    cameraOpen
                      ? 'bg-danger-700 hover:bg-danger-600 text-white'
                      : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {cameraOpen ? 'Cerrar' : 'Escanear'}
                </button>
              ) : (
                <span className="text-xs text-gray-400 italic">Cámara no disponible</span>
              )}
            </div>

            {/* OCR camera */}
            {cameraOpen && (
              <div className="space-y-2">
                <div className="relative bg-black rounded-xl overflow-hidden aspect-video">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  <canvas ref={canvasRef} className="hidden" />
                </div>
                {ocrMsg && (
                  <p className={`text-xs px-2 py-1 rounded ${ocrMsg.startsWith('Placa') ? 'text-success-400' : 'text-warning-400'}`}>
                    {ocrMsg}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleScanPlaca}
                  disabled={scanning}
                  className="sg-btn sg-btn-primary w-full text-sm"
                >
                  {scanning ? 'Procesando...' : 'Capturar placa'}
                </button>
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-300 mb-1">{t('exit.plateLabel')} *</label>
              <PlacaInput value={placa} onChange={setPlaca} required />
              {!hasCamera && <p className="mt-1.5 text-xs text-gray-400">{t('exit.noCameraHint')}</p>}
            </div>

            <button
              type="submit"
              disabled={searching}
              className="sg-btn sg-btn-primary w-full"
            >
              {searching ? t('common.searching') : t('common.search')}
            </button>
          </form>

          {/* Error */}
          {error && (
            <div className="bg-danger-50 border border-danger-300 rounded-xl px-5 py-4 text-danger-700 text-sm">
              {error}
            </div>
          )}

          {/* Not found */}
          {notFound && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl px-5 py-4 text-gray-400 text-sm text-center">
              {t('exit.notFound')} <span className="font-semibold text-white">{formatearPlaca(placa)}</span>.
            </div>
          )}

          {/* Active access card */}
          {accesoActivo && !salidaOk && (
            <div className="sg-card space-y-4 p-5 sm:p-7">
              <h3 className="text-base font-bold text-white">{t('exit.activeAccessFound')}</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between border-b border-gray-700 pb-2">
                  <span className="text-gray-400">{t('exit.plateLabel')}</span>
                  <span className="font-semibold text-white uppercase">{formatearPlaca(accesoActivo.placa)}</span>
                </div>
                <div className="flex justify-between border-b border-gray-700 pb-2">
                  <span className="text-gray-400">{t('exit.visitor')}</span>
                  <span className="text-white">{accesoActivo.visitante.nombre}</span>
                </div>
                <div className="flex justify-between border-b border-gray-700 pb-2">
                  <span className="text-gray-400">{t('exit.dpi')}</span>
                  <span className="text-white">{accesoActivo.visitante.numero_dpi}</span>
                </div>
                <div className="flex justify-between border-b border-gray-700 pb-2">
                  <span className="text-gray-400">{t('exit.house')}</span>
                  <span className="text-white">{accesoActivo.residente.numero_casa}</span>
                </div>
                <div className="flex justify-between border-b border-gray-700 pb-2">
                  <span className="text-gray-400">{t('exit.resident')}</span>
                  <span className="text-white">{accesoActivo.residente.nombre}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">{t('exit.entryTime')}</span>
                  <span className="text-white">
                    {formatearFechaHora(accesoActivo.timestamp_entrada)}
                  </span>
                </div>
              </div>

              {error && (
                <div className="bg-danger-50 border border-danger-300 rounded-lg px-4 py-3 text-danger-700 text-sm">
                  {error}
                </div>
              )}

              <button
                onClick={handleSalida}
                disabled={registrando}
                className="sg-btn sg-btn-primary w-full"
              >
                {registrando ? t('exit.registering') : t('exit.registerExit')}
              </button>
            </div>
          )}

          {/* Success */}
          {salidaOk && (
            <div className="space-y-4">
              <div className="bg-success-50 border border-success-300 rounded-xl p-6">
                <h3 className="text-success-700 font-bold text-lg mb-1">{t('exit.exitOkTitle')}</h3>
                <p className="text-success-600 text-sm">
                  {t('exit.exitOkDesc')} <strong className="uppercase">{formatearPlaca(placa)}</strong>
                </p>
              </div>
              <Button size="lg" fullWidth onClick={handleNuevaBusqueda}>
                {t('exit.newSearch')}
              </Button>
            </div>
          )}

        </div>
      </main>

      {/* Active Visitors Panel */}
      <div className="sg-page pt-0 text-gray-100">
        <div className="sg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
            <h2 className="text-base font-bold text-white">
              Visitantes dentro
              {!activosLoading && (
                <span className="ml-2 text-sm font-normal text-gray-400">({activos.length})</span>
              )}
            </h2>
            <button
              onClick={loadActivos}
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              Actualizar
            </button>
          </div>
          {activosLoading ? (
            <div className="p-4"><CardSkeleton count={4} /></div>
          ) : activos.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">No hay visitantes dentro actualmente.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-400 text-left">
                    <th className="px-5 py-3 font-medium">Visitante</th>
                    <th className="px-5 py-3 font-medium">Casa</th>
                    <th className="px-5 py-3 font-medium">Placa</th>
                    <th className="px-5 py-3 font-medium">Entrada</th>
                    <th className="px-5 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {activos.map(a => (
                    <tr key={a.registro_id} className="border-b border-gray-700 last:border-0 hover:bg-gray-700/30 transition-colors">
                      <td className="px-5 py-3 text-white font-medium">{a.visitante.nombre}</td>
                      <td className="px-5 py-3 text-gray-300">{a.residente.numero_casa}</td>
                      <td className="px-5 py-3 text-gray-400 uppercase">{a.placa ? formatearPlaca(a.placa) : '—'}</td>
                      <td className="px-5 py-3 text-gray-400">
                        {formatearHora(a.timestamp_entrada)}
                      </td>
                      <td className="px-5 py-3">
                        <RowActions
                          align="start"
                          actions={[
                            {
                              id: 'salida',
                              label: 'Registrar salida',
                              icon: ROW_ICON.close,
                              tone: 'primary',
                              loading: salidaActivoId === a.registro_id,
                              onClick: () => handleSalidaActivo(a.registro_id),
                            },
                          ]}
                        />
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
