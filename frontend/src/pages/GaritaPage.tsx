import { useEffect, useState } from 'react';
import {
  getResidentes,
  registrarAcceso,
  decodeTokenPayload,
  type Residente,
  type AccesoResult,
} from '../services/api';

const EMPTY_FORM = {
  nombre_visitante: '',
  numero_dpi: '',
  residente_id: '',
  placa: '',
  notas: '',
};

export default function GaritaPage() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [residentes, setResidentes] = useState<Residente[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AccesoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agenteNombre, setAgenteNombre] = useState<string>('');
  const [sinSesion, setSinSesion] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setSinSesion(true);
      return;
    }
    const payload = decodeTokenPayload(token);
    if (payload) setAgenteNombre((payload.nombre as string) || (payload.email as string));

    getResidentes()
      .then(setResidentes)
      .catch(() => setError('No se pudo cargar la lista de residentes.'));
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    const token = localStorage.getItem('token');
    if (!token) { setSinSesion(true); return; }

    const payload = decodeTokenPayload(token);
    if (!payload?.id) { setError('Token inválido. Vuelve a iniciar sesión.'); return; }

    setLoading(true);
    try {
      const data = await registrarAcceso({
        nombre_visitante: form.nombre_visitante,
        numero_dpi: form.numero_dpi,
        residente_id: form.residente_id,
        agente_id: payload.id as string,
        placa: form.placa || undefined,
        notas: form.notas || undefined,
      });
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  const handleNuevaEntrada = () => {
    setForm(EMPTY_FORM);
    setResult(null);
    setError(null);
  };

  if (sinSesion) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="bg-red-50 border border-red-300 rounded-xl p-8 text-center max-w-sm">
          <p className="text-red-700 font-semibold text-lg">Sesión no iniciada</p>
          <p className="text-red-600 text-sm mt-2">
            Inicia sesión para acceder a la terminal de garita.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">SecureGate</h1>
          <p className="text-xs text-gray-400">Terminal de Garita</p>
        </div>
        {agenteNombre && (
          <span className="text-sm text-gray-300">
            Agente: <span className="font-medium text-white">{agenteNombre}</span>
          </span>
        )}
      </header>

      <main className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-lg">

          {/* Result card */}
          {result ? (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-300 rounded-xl p-6">
                <h2 className="text-green-700 font-bold text-lg mb-1">Acceso registrado</h2>
                <p className="text-green-600 text-sm">
                  Visitante: <strong>{(result.visitante as Record<string, string>).nombre}</strong>
                  &nbsp;— DPI: {(result.visitante as Record<string, string>).numero_dpi}
                </p>
                <p className="text-green-600 text-sm mt-1">
                  Entrada:{' '}
                  {new Date(
                    (result.registro as Record<string, string>).timestamp_entrada
                  ).toLocaleString('es-GT')}
                </p>
              </div>

              {result.cargo_generado && (
                <div className="bg-yellow-50 border border-yellow-400 rounded-xl p-6">
                  <h3 className="text-yellow-700 font-bold mb-1">Cargo automático generado</h3>
                  <p className="text-yellow-700 text-sm">
                    {(result.cargo_generado as Record<string, string>).descripcion}
                  </p>
                  <p className="text-yellow-800 font-semibold mt-1">
                    Monto: Q{(result.cargo_generado as Record<string, string>).monto}
                  </p>
                  <p className="text-yellow-600 text-xs mt-1">
                    El residente tiene pagos pendientes. Se notificó al administrador.
                  </p>
                </div>
              )}

              <button
                onClick={handleNuevaEntrada}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                Nueva entrada
              </button>
            </div>
          ) : (
            /* Registration form */
            <form onSubmit={handleSubmit} className="bg-gray-800 rounded-2xl p-8 space-y-5 shadow-xl">
              <h2 className="text-lg font-bold text-white">Registro de entrada</h2>

              {error && (
                <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-red-700 text-sm">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm text-gray-300 mb-1">Nombre del visitante *</label>
                <input
                  name="nombre_visitante"
                  value={form.nombre_visitante}
                  onChange={handleChange}
                  required
                  placeholder="Juan Pérez"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Número de DPI *</label>
                <input
                  name="numero_dpi"
                  value={form.numero_dpi}
                  onChange={handleChange}
                  required
                  placeholder="1234567890101"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Casa destino *</label>
                <select
                  name="residente_id"
                  value={form.residente_id}
                  onChange={handleChange}
                  required
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="">Seleccionar casa...</option>
                  {residentes.map((r) => (
                    <option key={r.id} value={r.id}>
                      Casa {r.numero_casa} — {r.nombre}
                      {r.estado_pago === 'mora' ? ' ⚠ MORA' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Placa del vehículo</label>
                <input
                  name="placa"
                  value={form.placa}
                  onChange={handleChange}
                  placeholder="P-123ABC (opcional)"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Notas</label>
                <textarea
                  name="notas"
                  value={form.notas}
                  onChange={handleChange}
                  rows={2}
                  placeholder="Observaciones (opcional)"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                {loading ? 'Registrando...' : 'Registrar entrada'}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}