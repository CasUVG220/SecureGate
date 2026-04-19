import { useEffect, useState } from 'react';
import { getDashboard, type DashboardData } from '../services/api';

interface StatCardProps {
  label: string;
  value: number;
  colorClass: string;
}

function StatCard({ label, value, colorClass }: StatCardProps) {
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
    <div className="min-h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <h1 className="text-xl font-bold tracking-tight">SecureGate</h1>
        <p className="text-xs text-gray-400">Dashboard</p>
      </header>

      <main className="px-6 py-8 space-y-8">
        {error && (
          <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-gray-400 text-sm">Cargando...</p>
        ) : data && (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard
                label="Accesos hoy"
                value={data.accesos_hoy}
                colorClass="border-blue-500"
              />
              <StatCard
                label="Residentes en mora"
                value={data.residentes_mora}
                colorClass="border-red-500"
              />
              <StatCard
                label="Pagos pendientes"
                value={data.pagos_pendientes}
                colorClass="border-yellow-500"
              />
            </div>

            {/* Recent accesses table */}
            <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-700">
                <h2 className="text-base font-semibold text-white">Accesos recientes</h2>
              </div>
              {data.accesos_recientes.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-10">
                  No hay accesos registrados hoy.
                </p>
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
                    {data.accesos_recientes.map(a => (
                      <tr key={a.id} className="border-b border-gray-700 last:border-0">
                        <td className="px-4 py-3">{a.nombre_visitante}</td>
                        <td className="px-4 py-3 font-medium">{a.numero_casa}</td>
                        <td className="px-4 py-3 text-gray-300">
                          {new Date(a.timestamp_entrada).toLocaleTimeString('es-GT', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="px-4 py-3">
                          {a.timestamp_salida ? (
                            <span className="text-gray-300">
                              {new Date(a.timestamp_salida).toLocaleTimeString('es-GT', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          ) : (
                            <span className="inline-block bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                              Activo
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}