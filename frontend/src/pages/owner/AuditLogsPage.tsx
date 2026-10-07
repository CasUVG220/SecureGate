import { useEffect, useMemo, useState } from 'react';
import {
  getAuditAcciones, getAuditLogs,
  type AuditAccion, type AuditEstado, type AuditLog,
} from '../../services/api';
import { Button, DataTable, EmptyState, Input, Select, StatusText, type Column, type StatusKind } from '../../components/ui';
import { rellenar } from '../../components/charts/format';
import { useTranslation } from '../../i18n/useTranslation';
import { formatearFechaHora } from '../../utils/fecha';
import { estadoDe, grupoDeAccion, GRUPOS, type GrupoAuditoria } from './auditoria';

const PAGE_SIZE = 50;

const ESTADOS: AuditEstado[] = ['ok', 'rechazado', 'bloqueado', 'error'];
const TONO_ESTADO: Record<AuditEstado, StatusKind> = { ok: 'on', rechazado: 'warn', bloqueado: 'bad', error: 'bad' };

const ICON_REGISTRO = 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5h6M9 12h6M9 16h4';

/**
 * Registro de auditoría (owner). Muestra TODAS las acciones que existen en la bitácora —la lista de acciones sale del
 * servidor, ya no está escrita a mano— agrupadas por tema, con su nombre en español; se filtra por acción, por resultado
 * (correctas, rechazadas, bloqueadas por un límite de tasa, con error), por persona o correo intentado y por fechas.
 */
export default function AuditLogsPage() {
  const { t } = useTranslation();

  const [logs, setLogs]       = useState<AuditLog[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [acciones, setAcciones] = useState<AuditAccion[]>([]);

  // Filtros del servidor
  const [accion, setAccion]   = useState('');
  const [estado, setEstado]   = useState<AuditEstado | ''>('');
  const [desde, setDesde]     = useState('');
  const [hasta, setHasta]     = useState('');
  const [page, setPage]       = useState(0);
  // La búsqueda por persona se manda al servidor un momento después de dejar de escribir.
  const [persona, setPersona] = useState('');
  const [buscar, setBuscar]   = useState('');

  useEffect(() => {
    const espera = setTimeout(() => { setBuscar(persona.trim()); setPage(0); }, 350);
    return () => clearTimeout(espera);
  }, [persona]);

  // La lista de acciones sale de la propia bitácora: una acción nueva aparece sola.
  useEffect(() => { getAuditAcciones().then(setAcciones).catch(() => { /* el filtro queda en «todas» */ }); }, []);

  useEffect(() => {
    let cancelled = false;
    // La consulta sincroniza filtros/paginación con la API al cambiar la vista.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(false);
    getAuditLogs({
      limit:  PAGE_SIZE,
      offset: page * PAGE_SIZE,
      accion: accion || undefined,
      estado: estado || undefined,
      buscar: buscar || undefined,
      desde:  desde  || undefined,
      hasta:  hasta  || undefined,
    })
      .then(res => { if (!cancelled) { setLogs(res.logs); setTotal(res.total); } })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accion, estado, buscar, desde, hasta, page]);

  const cambiar = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(0); };

  const limpiar = () => {
    setAccion(''); setEstado(''); setDesde(''); setHasta(''); setPersona(''); setBuscar(''); setPage(0);
  };
  const hayFiltros = !!(accion || estado || desde || hasta || persona);

  /** Nombre de la acción en el idioma elegido; una desconocida se muestra con su código. */
  const nombreAccion = (codigo: string) => t(`audit.accion.${codigo}`, codigo);

  const porGrupo = useMemo(() => {
    const grupos = new Map<GrupoAuditoria, AuditAccion[]>();
    for (const a of acciones) {
      const g = grupoDeAccion(a.accion);
      grupos.set(g, [...(grupos.get(g) ?? []), a]);
    }
    return GRUPOS.filter(g => grupos.has(g)).map(g => ({ grupo: g, items: grupos.get(g)! }));
  }, [acciones]);

  /** Lo que explica la fila además de su nombre: el límite que frenó un intento, el guard que denegó… */
  const detalle = (l: AuditLog): string | null => {
    const d = l.datos_nuevos ?? {};
    const partes: string[] = [];
    if (typeof d.limite === 'string') partes.push(rellenar(t('audit.detail.limit'), { limite: d.limite }));
    if (l.accion === 'ACCESO_DENEGADO' && typeof d.guarda === 'string') {
      partes.push(rellenar(t('audit.detail.denied'), { metodo: String(d.metodo ?? ''), ruta: String(d.ruta ?? ''), guarda: d.guarda }));
    }
    if (typeof d.intentos_callados === 'number' && d.intentos_callados > 0) {
      partes.push(rellenar(t('audit.detail.silenced'), { n: d.intentos_callados }));
    }
    // Verificación en dos pasos y renovaciones rechazadas: cómo entró o por qué falló (el detalle nunca lleva códigos).
    if (d.segundo_paso === 'pendiente') partes.push(t('audit.detail.secondStep'));
    if (d.via === 'totp' || d.via === 'recuperacion') partes.push(t(`audit.detail.via.${d.via}`));
    if (typeof d.motivo === 'string' && t(`audit.motivo.${d.motivo}`, '') !== '') {
      partes.push(rellenar(t('audit.detail.reason'), { motivo: t(`audit.motivo.${d.motivo}`) }));
    }
    return partes.length ? partes.join(' · ') : null;
  };

  const columns: Column<AuditLog>[] = [
    {
      key: 'cuando', header: t('audit.col.when'), primary: true,
      cell: l => <span className="whitespace-nowrap font-mono text-xs text-gray-300">{formatearFechaHora(l.created_at)}</span>,
    },
    {
      key: 'persona', header: t('audit.col.user'),
      cell: l => {
        const intentado = typeof l.datos_nuevos?.email === 'string' ? l.datos_nuevos.email : null;
        if (l.usuario_nombre || l.usuario_email) {
          return (
            <>
              <span className="block font-medium text-gray-100">{l.usuario_nombre ?? '—'}</span>
              {l.usuario_email && <span className="block text-xs text-gray-400">{l.usuario_email}</span>}
            </>
          );
        }
        return intentado
          ? <span className="text-xs text-gray-300">{t('audit.user.triedEmail')} <span className="font-mono">{intentado}</span></span>
          : <span className="text-xs italic text-gray-400">{t('audit.user.none')}</span>;
      },
    },
    {
      key: 'accion', header: t('audit.col.action'),
      cell: l => {
        const extra = detalle(l);
        return (
          <>
            <span className="block text-sm font-medium text-gray-100">{nombreAccion(l.accion)}</span>
            <span className="block font-mono text-2xs text-gray-400">{l.accion}</span>
            {extra && <span className="mt-0.5 block text-xs text-gray-300">{extra}</span>}
          </>
        );
      },
    },
    {
      key: 'resultado', header: t('audit.col.result'),
      cell: l => {
        const e = estadoDe(l.status_code);
        return (
          <>
            <StatusText kind={TONO_ESTADO[e]}>{t(`audit.status.${e}`)}</StatusText>
            {l.status_code != null && <span className="ml-1.5 font-mono text-2xs text-gray-400">{l.status_code}</span>}
          </>
        );
      },
    },
    { key: 'ip', header: t('audit.col.ip'), hideOnMobile: true, cell: l => <span className="font-mono text-xs text-gray-400">{l.ip_address ?? '—'}</span> },
    { key: 'sucursal', header: t('audit.col.branch'), hideOnMobile: true, cell: l => <span className="font-mono text-xs text-gray-400">{l.sucursal_id ? l.sucursal_id.slice(0, 8) : '—'}</span> },
  ];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd   = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="sg-page text-gray-100">
      <div>
        <h1 className="text-xl font-bold text-white">{t('audit.title')}</h1>
        <p className="mt-0.5 text-sm text-gray-400">{t('audit.subtitle')}</p>
      </div>

      {/* ── Filtros ── */}
      <div className="sg-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select label={t('audit.filter.action')} value={accion} onChange={e => cambiar(setAccion)(e.target.value)}>
            <option value="">{t('audit.filter.allActions')}</option>
            {porGrupo.map(({ grupo, items }) => (
              <optgroup key={grupo} label={t(`audit.group.${grupo}`)}>
                {items.map(a => <option key={a.accion} value={a.accion}>{nombreAccion(a.accion)} ({a.total})</option>)}
              </optgroup>
            ))}
          </Select>

          <Select label={t('audit.filter.result')} value={estado} onChange={e => cambiar<AuditEstado | ''>(setEstado)(e.target.value as AuditEstado | '')}>
            <option value="">{t('audit.filter.allResults')}</option>
            {ESTADOS.map(e => <option key={e} value={e}>{t(`audit.result.${e}`)}</option>)}
          </Select>

          <Input
            label={t('audit.filter.person')}
            value={persona}
            onChange={e => setPersona(e.target.value)}
            placeholder={t('audit.filter.personPlaceholder')}
          />

          <Input type="date" label={t('audit.filter.from')} value={desde} max={hasta || undefined} onChange={e => cambiar(setDesde)(e.target.value)} />
          <Input type="date" label={t('audit.filter.until')} value={hasta} min={desde || undefined} onChange={e => cambiar(setHasta)(e.target.value)} />
        </div>

        {hayFiltros && (
          <div className="mt-3 flex justify-end">
            <Button variant="secondary" size="sm" onClick={limpiar}>{t('audit.filter.clear')}</Button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">
          {t('audit.error')}
        </p>
      )}

      {/* ── Tabla ── */}
      <DataTable
        columns={columns}
        rows={logs}
        rowKey={l => l.id}
        loading={loading}
        caption={t('audit.title')}
        empty={<EmptyState compact icon={ICON_REGISTRO} title={t('audit.empty')} />}
      />

      {/* ── Paginación ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-gray-400">
          {total === 0 ? t('audit.noResults') : rellenar(t('audit.range'), { desde: rangeStart, hasta: rangeEnd, total })}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={loading || page === 0}>
            {t('audit.prev')}
          </Button>
          <span className="px-1 text-xs text-gray-400">{page + 1} / {totalPages}</span>
          <Button variant="secondary" size="sm" onClick={() => setPage(p => (p + 1 < totalPages ? p + 1 : p))} disabled={loading || page + 1 >= totalPages}>
            {t('audit.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
