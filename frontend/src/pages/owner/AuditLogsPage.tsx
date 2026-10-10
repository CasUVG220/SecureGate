import { useEffect, useMemo, useState } from 'react';
import { getAuditLogs, type AuditLog } from '../../services/api';
import { TableSkeleton } from '../../components/Skeleton';
import { useTranslation } from '../../i18n/useTranslation';

const PAGE_SIZE = 50;

const ACCIONES = [
  'LOGIN',
  'REGISTRO_ENTRADA',
  'REGISTRO_SALIDA',
  'PAGO_EFECTIVO',
  'PAGO_APROBADO',
  'PAGO_RECHAZADO',
  'RESIDENTE_ELIMINADO',
  'EMPRESA_CREADA',
  'EMPRESA_ELIMINADA',
  'BLACKLIST_AGREGADO',
  'BLACKLIST_REMOVIDO',
] as const;

const ACCION_BADGE: Record<string, string> = {
  LOGIN:               'bg-gray-700 text-gray-300',
  REGISTRO_ENTRADA:    'bg-brand-900/50 text-brand-400',
  REGISTRO_SALIDA:     'bg-brand-900/50 text-brand-400',
  PAGO_EFECTIVO:       'bg-success-900/50 text-success-400',
  PAGO_APROBADO:       'bg-success-900/50 text-success-400',
  PAGO_RECHAZADO:      'bg-danger-900/50 text-danger-400',
  RESIDENTE_ELIMINADO: 'bg-danger-950 text-danger-300 border border-danger-800',
  EMPRESA_ELIMINADA:   'bg-danger-950 text-danger-300 border border-danger-800',
  EMPRESA_CREADA:      'bg-brand-900/50 text-brand-400',
  BLACKLIST_AGREGADO:  'bg-danger-900/50 text-danger-400',
  BLACKLIST_REMOVIDO:  'bg-success-900/50 text-success-400',
};

const fmtFecha = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export default function AuditLogsPage() {
  const { t } = useTranslation();

  const [logs, setLogs]       = useState<AuditLog[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Server-side filters
  const [accion, setAccion]   = useState('');
  const [desde, setDesde]     = useState('');
  const [hasta, setHasta]     = useState('');
  const [page, setPage]       = useState(0);

  // Client-side text filter (name/email)
  const [busqueda, setBusqueda] = useState('');

  useEffect(() => {
    let cancelled = false;
    // La consulta sincroniza filtros/paginación con la API al cambiar la vista.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    getAuditLogs({
      limit:  PAGE_SIZE,
      offset: page * PAGE_SIZE,
      accion: accion || undefined,
      desde:  desde  || undefined,
      hasta:  hasta  || undefined,
    })
      .then(res => {
        if (cancelled) return;
        setLogs(res.logs);
        setTotal(res.total);
      })
      .catch(() => { if (!cancelled) setError('No se pudieron cargar los registros de auditoría.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accion, desde, hasta, page]);

  // Reset to first page whenever a server-side filter changes
  const updateFilter = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(0);
  };

  const limpiarFiltros = () => {
    setAccion('');
    setDesde('');
    setHasta('');
    setBusqueda('');
    setPage(0);
  };

  const visibleLogs = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(l =>
      (l.usuario_nombre ?? '').toLowerCase().includes(q) ||
      (l.usuario_email  ?? '').toLowerCase().includes(q)
    );
  }, [logs, busqueda]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd   = Math.min((page + 1) * PAGE_SIZE, total);

  const hasFilters = !!(accion || desde || hasta || busqueda);

  return (
    <div className="sg-page text-gray-100">
      <div>
        <h1 className="text-xl font-bold text-white">{t('nav.auditLogs')}</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Registro completo de acciones del sistema
        </p>
      </div>

      {/* ── Filtros ── */}
      <div className="bg-gray-800 rounded-2xl p-4 shadow-xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Acción</label>
            <select
              value={accion}
              onChange={e => updateFilter(setAccion)(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500 transition-colors"
            >
              <option value="">Todas las acciones</option>
              {ACCIONES.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Usuario (nombre o email)</label>
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar usuario..."
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-400 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Desde</label>
            <input
              type="date"
              value={desde}
              onChange={e => updateFilter(setDesde)(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Hasta</label>
            <input
              type="date"
              value={hasta}
              onChange={e => updateFilter(setHasta)(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>
        </div>

        {hasFilters && (
          <div className="mt-3 flex justify-end">
            <button
              onClick={limpiarFiltros}
              className="text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 px-4 py-1.5 rounded-lg transition-colors"
            >
              Limpiar filtros
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-danger-900/40 border border-danger-700 rounded-lg px-4 py-3 text-danger-300 text-sm">{error}</div>
      )}

      {/* ── Tabla ── */}
      <div className="sg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-5 py-3 font-medium whitespace-nowrap">Fecha y hora</th>
                <th className="px-5 py-3 font-medium">Usuario</th>
                <th className="px-5 py-3 font-medium">Acción</th>
                <th className="px-5 py-3 font-medium">Tabla afectada</th>
                <th className="px-5 py-3 font-medium">IP Address</th>
                <th className="px-5 py-3 font-medium">Sucursal</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={8} cols={6} />
              ) : visibleLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-gray-400 text-sm">
                    No se encontraron registros de auditoría
                  </td>
                </tr>
              ) : (
                visibleLogs.map((log, i) => (
                  <tr key={log.id} className={`border-b border-gray-700/50 last:border-0 ${i % 2 === 0 ? '' : 'bg-gray-700/20'}`}>
                    <td className="px-5 py-3 text-gray-300 text-xs whitespace-nowrap font-mono">
                      {fmtFecha(log.created_at)}
                    </td>
                    <td className="px-5 py-3">
                      {log.usuario_nombre || log.usuario_email ? (
                        <>
                          <p className="text-white font-medium">{log.usuario_nombre ?? '—'}</p>
                          {log.usuario_email && (
                            <p className="text-gray-500 text-xs mt-0.5">{log.usuario_email}</p>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-600 text-xs italic">Sistema</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${ACCION_BADGE[log.accion] ?? 'bg-gray-700 text-gray-300'}`}>
                        {log.accion}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-300 text-xs">{log.tabla_afectada ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs font-mono">{log.ip_address ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs font-mono">
                      {log.sucursal_id ? log.sucursal_id.slice(0, 8) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Paginación ── */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-700">
          <p className="text-xs text-gray-400">
            {total === 0
              ? 'Sin resultados'
              : `Mostrando ${rangeStart}–${rangeEnd} de ${total} resultados`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={loading || page === 0}
              className="text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-gray-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              Anterior
            </button>
            <span className="text-xs text-gray-400 px-1">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => (p + 1 < totalPages ? p + 1 : p))}
              disabled={loading || page + 1 >= totalPages}
              className="text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-gray-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
