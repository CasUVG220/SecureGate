import { useEffect, useState } from 'react';
import {
  getAccesoActivo,
  registrarSalidaVehiculo,
  decodeTokenPayload,
  type AccesoActivo,
} from '../services/api';

export default function SalidaPage() {
  const [placa, setPlaca] = useState('');
  const [searching, setSearching] = useState(false);
  const [accesoActivo, setAccesoActivo] = useState<AccesoActivo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [registrando, setRegistrando] = useState(false);
  const [salidaOk, setSalidaOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agenteNombre, setAgenteNombre] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const payload = decodeTokenPayload(token);
    if (payload) setAgenteNombre((payload.nombre as string) || (payload.email as string));
  }, []);

  const resetBusqueda = () => {
    setAccesoActivo(null);
    setNotFound(false);
    setSalidaOk(false);
    setError(null);
  };

  const handleBuscar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!placa.trim()) return;
    resetBusqueda();
    setSearching(true);
    try {
      const data = await getAccesoActivo(placa.trim());
      if (data === null) {
        setNotFound(true);
      } else {
        setAccesoActivo(data);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al buscar acceso');
    } finally {
      setSearching(false);
    }
  };

  const handleSalida = async () => {
    if (!accesoActivo) return;
    setRegistrando(true);
    setError(null);
    try {
      await registrarSalidaVehiculo(accesoActivo.registro_id);
      setSalidaOk(true);
      setAccesoActivo(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al registrar salida');
    } finally {
      setRegistrando(false);
    }
  };

  const handleNuevaBusqueda = () => {
    setPlaca('');
    resetBusqueda();
  };

  return (
    <div className="text-gray-100">
      <main className="flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-lg space-y-4">

          {/* Search form — always visible */}
          <form onSubmit={handleBuscar} className="bg-gray-800 rounded-2xl p-8 shadow-xl space-y-5">
            <h2 className="text-lg font-bold text-white">Buscar vehículo activo</h2>

            <div>
              <label className="block text-sm text-gray-300 mb-1">Placa del vehículo *</label>
              <input
                value={placa}
                onChange={(e) => setPlaca(e.target.value)}
                required
                placeholder="P-123ABC"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors uppercase"
              />
            </div>

            <button
              type="submit"
              disabled={searching}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {searching ? 'Buscando...' : 'Buscar'}
            </button>
          </form>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-300 rounded-xl px-5 py-4 text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Not found */}
          {notFound && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl px-5 py-4 text-gray-400 text-sm text-center">
              No se encontró acceso activo con la placa <span className="font-semibold text-white">{placa}</span>.
            </div>
          )}

          {/* Active access card */}
          {accesoActivo && !salidaOk && (
            <div className="bg-gray-800 rounded-2xl p-8 shadow-xl space-y-4">
              <h3 className="text-base font-bold text-white">Acceso activo encontrado</h3>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between border-b border-gray-700 pb-2">
                  <span className="text-gray-400">Placa</span>
                  <span className="font-semibold text-white uppercase">{accesoActivo.placa}</span>
                </div>
                <div className="flex justify-between border-b border-gray-700 pb-2">
                  <span className="text-gray-400">Visitante</span>
                  <span className="text-white">{accesoActivo.visitante.nombre}</span>
                </div>
                <div className="flex justify-between border-b border-gray-700 pb-2">
                  <span className="text-gray-400">DPI</span>
                  <span className="text-white">{accesoActivo.visitante.numero_dpi}</span>
                </div>
                <div className="flex justify-between border-b border-gray-700 pb-2">
                  <span className="text-gray-400">Casa</span>
                  <span className="text-white">{accesoActivo.residente.numero_casa}</span>
                </div>
                <div className="flex justify-between border-b border-gray-700 pb-2">
                  <span className="text-gray-400">Residente</span>
                  <span className="text-white">{accesoActivo.residente.nombre}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Hora de entrada</span>
                  <span className="text-white">
                    {new Date(accesoActivo.timestamp_entrada).toLocaleString('es-GT')}
                  </span>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-red-700 text-sm">
                  {error}
                </div>
              )}

              <button
                onClick={handleSalida}
                disabled={registrando}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                {registrando ? 'Registrando...' : 'Registrar Salida'}
              </button>
            </div>
          )}

          {/* Success */}
          {salidaOk && (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-300 rounded-xl p-6">
                <h3 className="text-green-700 font-bold text-lg mb-1">Salida registrada</h3>
                <p className="text-green-600 text-sm">
                  La salida del vehículo <strong className="uppercase">{placa}</strong> fue registrada correctamente.
                </p>
              </div>
              <button
                onClick={handleNuevaBusqueda}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                Nueva búsqueda
              </button>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
