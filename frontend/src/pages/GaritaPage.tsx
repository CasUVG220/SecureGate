import { useEffect, useRef, useState } from 'react';
import {
  getResidentes,
  registrarAcceso,
  decodeTokenPayload,
  scanDPI,
  scanPlaca,
  type Residente,
} from '../services/api';

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
};

export default function GaritaPage() {
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
  const [casaSearch, setCasaSearch]   = useState('');
  const [casaOpen, setCasaOpen]       = useState(false);

  const dpiVideoRef   = useRef<HTMLVideoElement>(null);
  const placaVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setSinSesion(true); return; }
    getResidentes()
      .then(setResidentes)
      .catch(() => setError('No se pudo cargar la lista de residentes.'));

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        streamRef.current = stream;
        if (dpiVideoRef.current)   dpiVideoRef.current.srcObject = stream;
        if (placaVideoRef.current) placaVideoRef.current.srcObject = stream;
      })
      .catch(() => { /* camera unavailable */ });

    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  const captureFrame = (videoRef: React.RefObject<HTMLVideoElement>): string | null => {
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
      } else {
        setOcrDpiMsg('No se pudo leer el DPI');
      }
    } catch {
      setOcrDpiMsg('Error al procesar imagen');
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
        setForm(prev => ({ ...prev, placa: res.placa }));
        setPlacaOcr(true);
      } else {
        setOcrPlacaMsg('No se pudo leer la placa');
      }
    } catch {
      setOcrPlacaMsg('Error al procesar imagen');
    } finally {
      setOcringPlaca(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setCasaSearch('');
    setDpiOcr(false);
    setPlacaOcr(false);
    setError(null);
    setOcrDpiMsg(null);
    setOcrPlacaMsg(null);
  };

  const handleAutorizar = async () => {
    if (!form.nombre_visitante || !form.numero_dpi || !form.residente_id) {
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
      await registrarAcceso({
        nombre_visitante: form.nombre_visitante,
        numero_dpi:       form.numero_dpi,
        residente_id:     form.residente_id,
        agente_id:        payload.id as string,
        placa:            form.placa || undefined,
      });
      const residente = residentes.find(r => r.id === form.residente_id);
      setUltimosIngresos(prev => [{
        id:        crypto.randomUUID(),
        hora:      new Date().toLocaleTimeString('es-GT'),
        visitante: form.nombre_visitante,
        placa:     form.placa || '—',
        unidad:    residente ? `Casa ${residente.numero_casa}` : '—',
        estado:    'Autorizado',
      }, ...prev].slice(0, 10));
      resetForm();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al registrar');
    } finally {
      setLoading(false);
    }
  };

  const handleDenegar = () => {
    const residente = residentes.find(r => r.id === form.residente_id);
    setUltimosIngresos(prev => [{
      id:        crypto.randomUUID(),
      hora:      new Date().toLocaleTimeString('es-GT'),
      visitante: form.nombre_visitante || 'Desconocido',
      placa:     form.placa || '—',
      unidad:    residente ? `Casa ${residente.numero_casa}` : '—',
      estado:    'Denegado',
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
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="bg-red-50 border border-red-300 rounded-xl p-8 text-center max-w-sm">
          <p className="text-red-700 font-semibold text-lg">Sesión no iniciada</p>
          <p className="text-red-600 text-sm mt-2">Inicia sesión para acceder a la terminal de garita.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full text-gray-100">
      <canvas ref={canvasRef} className="hidden" />

      {/* Left column — always-on cameras */}
      <div className="w-1/2 flex flex-col gap-3 p-4 border-r border-gray-700 min-h-0">

        {/* DPI scanner */}
        <div className="flex-1 bg-gray-800 rounded-2xl flex flex-col shadow-xl overflow-hidden min-h-0">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-700 shrink-0">
            <span className="text-sm font-semibold text-gray-200">Escáner de DPI</span>
            {dpiOcr && (
              <span className="text-xs bg-emerald-600 text-white px-2 py-0.5 rounded-full font-medium">OCR</span>
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
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2 rounded-xl transition-colors text-sm"
            >
              {ocringDpi ? 'Procesando...' : 'Escanear Documento'}
            </button>
          </div>
        </div>

        {/* Plate scanner */}
        <div className="flex-1 bg-gray-800 rounded-2xl flex flex-col shadow-xl overflow-hidden min-h-0">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-700 shrink-0">
            <span className="text-sm font-semibold text-gray-200">Reconocimiento de Placa</span>
            {placaOcr && (
              <span className="text-xs bg-emerald-600 text-white px-2 py-0.5 rounded-full font-medium">OCR</span>
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
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2 rounded-xl transition-colors text-sm"
            >
              {ocringPlaca ? 'Procesando...' : 'Escanear Placa'}
            </button>
          </div>
        </div>
      </div>

      {/* Right column — form + actions + log */}
      <div className="w-1/2 flex flex-col gap-3 p-4 overflow-y-auto">

        {/* Datos del visitante */}
        <div className="bg-gray-800 rounded-2xl p-5 shadow-xl space-y-4 shrink-0">
          <h2 className="text-base font-bold text-white">Datos del Visitante</h2>

          {error && (
            <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-2 text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {/* Nombre */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Nombre *</label>
              <input
                name="nombre_visitante"
                value={form.nombre_visitante}
                onChange={handleChange}
                placeholder="Juan Pérez"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            {/* DPI */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">DPI *</label>
              <input
                name="numero_dpi"
                value={form.numero_dpi}
                onChange={handleChange}
                placeholder="1234567890101"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Placa */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Placa</label>
              <input
                name="placa"
                value={form.placa}
                onChange={handleChange}
                placeholder="P-123ABC"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Casa / Unidad autocomplete */}
            <div className="relative">
              <label className="block text-xs text-gray-400 mb-1">Casa / Unidad *</label>
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
                placeholder="Buscar casa..."
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors"
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
                        <span className="text-yellow-400 text-xs font-semibold">⚠ MORA</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3 shrink-0">
          <button
            onClick={handleAutorizar}
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-5 rounded-2xl transition-colors text-sm tracking-widest shadow-xl"
          >
            {loading ? 'REGISTRANDO...' : 'AUTORIZAR ENTRADA'}
          </button>
          <button
            onClick={handleDenegar}
            className="bg-red-600 hover:bg-red-500 text-white font-bold py-5 rounded-2xl transition-colors text-sm tracking-widest shadow-xl"
          >
            DENEGAR ENTRADA
          </button>
        </div>

        {/* Últimos Ingresos */}
        <div className="bg-gray-800 rounded-2xl overflow-hidden shadow-xl shrink-0">
          <div className="px-5 py-3 border-b border-gray-700">
            <h3 className="text-sm font-bold text-white">Últimos Ingresos</h3>
          </div>
          {ultimosIngresos.length === 0 ? (
            <p className="text-gray-500 text-xs px-5 py-5 text-center">
              Sin registros en esta sesión.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-left">
                  <th className="px-4 py-2 font-medium">Hora</th>
                  <th className="px-4 py-2 font-medium">Visitante</th>
                  <th className="px-4 py-2 font-medium">Placa</th>
                  <th className="px-4 py-2 font-medium">Unidad</th>
                  <th className="px-4 py-2 font-medium">Estado</th>
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
                        {ing.estado}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
