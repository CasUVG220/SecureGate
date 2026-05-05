import { useEffect, useState } from 'react';
import { getDashboard, type DashboardData } from '../services/api';
import { TableSkeleton } from '../components/Skeleton';

function StatCard({ label, value, colorClass }: { label: string; value: number; colorClass: string }) {
  return (
    <div className={`bg-gray-800 rounded-2xl p-6 shadow-xl border-l-4 ${colorClass}`}>
      <p className="text-gray-400 text-sm font-medium">{label}</p>
      <p className="text-4xl font-bold text-white mt-2">{value}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData]       = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    getDashboard()
      .then(setData)
      .catch(() => setError('No se pudo cargar el dashboard.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 text-gray-100 space-y-8">
      <h1 className="text-xl font-bold text-white">Dashboard</h1>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-gray-800 rounded-2xl p-6 border-l-4 border-gray-700 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-2/3 mb-3" />
              <div className="h-10 bg-gray-700 rounded w-1/3" />
            </div>
          ))
        ) : data ? (
          <>
            <StatCard label="Accesos hoy"       value={data.accesos_hoy}      colorClass="border-blue-500" />
            <StatCard label="Residentes en mora" value={data.residentes_mora}  colorClass="border-red-500" />
            <StatCard label="Pagos pendientes"   value={data.pagos_pendientes} colorClass="border-yellow-500" />
          </>
        ) : null}
      </div>

      <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700">
          <h2 className="text-base font-semibold text-white">Accesos recientes</h2>
        </div>
        {!loading && data?.accesos_recientes.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-10">No hay accesos registrados hoy.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">Visitante</th>
                <th className="px-4 py-3 font-medium">Casa</th>
                <th className="px-4 py-3 font-medium">Entrada</th>
                <th className="px-4 py-3 font-medium">Salida</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={5} cols={4} />
              ) : (
                data?.accesos_recientes.map(a => (
                  <tr key={a.id} className="border-b border-gray-700 last:border-0">
                    <td className="px-4 py-3">{a.nombre_visitante}</td>
                    <td className="px-4 py-3 font-medium">{a.numero_casa}</td>
                    <td className="px-4 py-3 text-gray-300">
                      {new Date(a.timestamp_entrada).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3">
                      {a.timestamp_salida ? (
                        <span className="text-gray-300">
                          {new Date(a.timestamp_salida).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      ) : (
                        <span className="inline-block bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">Activo</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
