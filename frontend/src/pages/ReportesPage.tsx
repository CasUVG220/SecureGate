import { useState } from 'react';
import { downloadReporteAccesos, downloadReportePagos } from '../services/api';
import { Spinner } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n/useTranslation';

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
  onDownload: (desde: string, hasta: string) => Promise<void>;
}) {
  const showToast = useToast();
  const { t } = useTranslation();
  const [desde, setDesde]       = useState(firstOfMonth());
  const [hasta, setHasta]       = useState(today());
  const [loading, setLoading]   = useState(false);

  const handleDownload = async () => {
    if (!desde || !hasta) { showToast(t('reports.bothDatesRequired'), 'warning'); return; }
    if (desde > hasta)    { showToast(t('reports.dateOrderError'), 'warning'); return; }
    setLoading(true);
    try {
      await onDownload(desde, hasta);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-800 rounded-2xl p-6 space-y-4 shadow-xl">
      <h2 className="text-base font-bold text-white">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('reports.from')}</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('reports.until')}</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors" />
        </div>
      </div>
      <button onClick={handleDownload} disabled={loading}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2">
        {loading && <Spinner />}
        {loading ? t('common.downloading') : t('common.download')}
      </button>
    </div>
  );
}

const downloadAccesos = (d: string, h: string) =>
  new Promise<void>(resolve => { downloadReporteAccesos(d, h); setTimeout(resolve, 500); });
const downloadPagos = (d: string, h: string) =>
  new Promise<void>(resolve => { downloadReportePagos(d, h); setTimeout(resolve, 500); });

export default function ReportesPage() {
  const { t } = useTranslation();
  return (
    <div className="p-4 sm:p-6 text-gray-100 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-white">{t('reports.title')}</h1>
        <p className="text-sm text-gray-400 mt-1">{t('reports.subtitle')}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <ReporteCard title={t('reports.accesses')}       onDownload={downloadAccesos} />
        <ReporteCard title={t('reports.paymentsReport')} onDownload={downloadPagos} />
      </div>
    </div>
  );
}
