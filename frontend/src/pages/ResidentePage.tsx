import { useEffect, useState } from 'react';
import { getResidenteMe, type ResidenteMe } from '../services/api';

const BADGE: Record<string, string> = {
  al_dia:   'bg-green-100 text-green-700',
  mora:     'bg-red-100 text-red-700',
  pendiente:'bg-yellow-100 text-yellow-700',
};
const BADGE_LABEL: Record<string, string> = {
  al_dia: 'Al día', mora: 'Mora', pendiente: 'Pendiente',
};
const ESTADO_PAGO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  aprobado:  'Aprobado',
  rechazado: 'Rechazado',
};
const ESTADO_PAGO_CLASS: Record<string, string> = {
  pendiente: 'bg-yellow-100 text-yellow-700',
  aprobado:  'bg-green-100 text-green-700',
  rechazado: 'bg-red-100 text-red-700',
};

export default function ResidentePage() {
  const [data, setData]       = useState<ResidenteMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    getResidenteMe()
      .then(setData)
      .catch(() => setError('No se pudo cargar tu información.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Cargando...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="bg-red-50 border border-red-300 rounded-xl p-8 text-center max-w-sm">
          <p className="text-red-700 font-semibold">{error ?? 'Error inesperado'}</p>
        </div>
      </div>
    );
  }

  const saldo = parseFloat(data.saldo_pendiente);

  return (
    <main className="px-6 py-8 space-y-8 max-w-2xl mx-auto">
      {/* Summary card */}
      <div className="bg-gray-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-gray-400 text-sm">Casa</p>
            <p className="text-3xl font-bold text-white mt-1">{data.numero_casa}</p>
          </div>
          <span className={`mt-1 px-3 py-1 rounded-full text-sm font-semibold ${BADGE[data.estado_pago] ?? 'bg-gray-600 text-gray-200'}`}>
            {BADGE_LABEL[data.estado_pago] ?? data.estado_pago}
          </span>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 gap-4">
          <div>
            <p className="text-gray-400 text-xs">Saldo pendiente</p>
            <p className={`text-xl font-semibold mt-0.5 ${saldo > 0 ? 'text-red-400' : 'text-green-400'}`}>
              Q{saldo.toFixed(2)}
            </p>
          </div>
          {data.telefono && (
            <div>
              <p className="text-gray-400 text-xs">Teléfono</p>
              <p className="text-white text-sm mt-0.5">{data.telefono}</p>
            </div>
          )}
        </div>
      </div>

      {/* Pagos recientes */}
      <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700">
          <h2 className="text-base font-semibold text-white">Mis pagos</h2>
        </div>
        {data.pagos_recientes.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-10">No hay pagos registrados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Monto</th>
                <th className="px-4 py-3 font-medium">Método</th>
                <th className="px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.pagos_recientes.map(p => (
                <tr key={p.id} className="border-b border-gray-700 last:border-0">
                  <td className="px-4 py-3 text-gray-300">
                    {new Date(p.fecha_pago).toLocaleDateString('es-GT')}
                  </td>
                  <td className="px-4 py-3 font-medium text-white">Q{parseFloat(p.monto).toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-300 capitalize">{p.metodo}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ESTADO_PAGO_CLASS[p.estado] ?? 'bg-gray-600 text-gray-200'}`}>
                      {ESTADO_PAGO_LABEL[p.estado] ?? p.estado}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
