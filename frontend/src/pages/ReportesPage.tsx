import { useState } from 'react';
import { downloadReporteAccesos, downloadReportePagos } from '../services/api';

const today = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

function ReporteCard({
    title,
    onDownload,
}: {
    title: string;
    onDownload: (desde: string, hasta: string) => void;
}) {
    const [desde, setDesde] = useState(firstOfMonth());
    const [hasta, setHasta] = useState(today());
    const [error, setError] = useState<string | null>(null);

    const handleDownload = () => {
        if (!desde || !hasta) { setError('Selecciona ambas fechas.'); return; }
        if (desde > hasta) { setError('"Desde" no puede ser posterior a "Hasta".'); return; }
        setError(null);
        onDownload(desde, hasta);
    };

    return (
        <div className="bg-gray-800 rounded-2xl p-6 space-y-4 shadow-xl">
            <h2 className="text-base font-bold text-white">{title}</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm text-gray-400 mb-1">Desde</label>
                    <input
                        type="date"
                        value={desde}
                        onChange={e => setDesde(e.target.value)}
                        className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    />
                </div>
                <div>
                    <label className="block text-sm text-gray-400 mb-1">Hasta</label>
                    <input
                        type="date"
                        value={hasta}
                        onChange={e => setHasta(e.target.value)}
                        className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    />
                </div>
            </div>

            {error && (
                <p className="text-sm text-red-400">{error}</p>
            )}

            <button
                onClick={handleDownload}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition-colors"
            >
                Descargar CSV
            </button>
        </div>
    );
}

export default function ReportesPage() {
    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 px-4 py-10">
            <div className="max-w-2xl mx-auto space-y-6">
                <div>
                    <h1 className="text-xl font-bold text-white">Reportes</h1>
                    <p className="text-sm text-gray-400 mt-1">Exporta registros en formato CSV por rango de fechas.</p>
                </div>

                <ReporteCard
                    title="Reporte de Accesos"
                    onDownload={downloadReporteAccesos}
                />

                <ReporteCard
                    title="Reporte de Pagos"
                    onDownload={downloadReportePagos}
                />
            </div>
        </div>
    );
}