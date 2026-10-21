import { useEffect, useState } from 'react';
import { getEntradas, type EntradaAcceso, type MetodoAcceso } from '../services/api';
import { Badge, Button, DataTable, EmptyState, Input, Select, StatusText, type Column } from '../components/ui';
import EvidenciaMiniatura from '../components/EvidenciaMiniatura';
import { rellenar } from '../components/charts/format';
import { useTranslation } from '../i18n/useTranslation';
import { formatearFechaHora, formatearHora } from '../utils/fecha';
import { formatearPlaca } from '../utils/placa';

const POR_PAGINA = 25;
const METODOS: MetodoAcceso[] = ['manual', 'clic', 'qr', 'anpr'];
const ICON_ENTRADAS = 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3';

interface Props {
  /** El administrador de empresa y el owner ven varias sucursales: se agrega la columna. */
  mostrarSucursal?: boolean;
}

/**
 * Entradas (Sprint 10, seguimiento del ANPR): todo lo que pasó por la garita —visitantes y residentes que entraron por placas— para
 * que la administración pueda auditar también lo que el sistema abrió solo. Cada rol ve lo que ve hoy (su sucursal, su empresa o
 * todo, según el backend). Filtro por método (manual, clic, QR, automático por placas), búsqueda por placa, fechas y paginación.
 */
export default function EntradasPage({ mostrarSucursal = false }: Props) {
  const { t } = useTranslation();
  const [filas, setFilas] = useState<EntradaAcceso[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);

  const [metodo, setMetodo] = useState<MetodoAcceso | ''>('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagina, setPagina] = useState(0);
  // La placa se manda al servidor un momento después de dejar de escribir (y con al menos 2 letras o números).
  const [placaTexto, setPlacaTexto] = useState('');
  const [placa, setPlaca] = useState('');

  useEffect(() => {
    const espera = setTimeout(() => {
      const limpia = placaTexto.replace(/[^A-Za-z0-9]/g, '');
      setPlaca(limpia.length >= 2 ? limpia : '');
      setPagina(0);
    }, 350);
    return () => clearTimeout(espera);
  }, [placaTexto]);

  useEffect(() => {
    let cancelado = false;
    // La consulta sincroniza filtros y paginación con la API al cambiar la vista.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCargando(true);
    setError(false);
    getEntradas({ metodo: metodo || undefined, placa: placa || undefined, desde: desde || undefined, hasta: hasta || undefined, pagina: pagina + 1, por_pagina: POR_PAGINA })
      .then(r => { if (!cancelado) { setFilas(r.accesos); setTotal(r.total); } })
      .catch(() => { if (!cancelado) setError(true); })
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
  }, [metodo, placa, desde, hasta, pagina]);

  const cambiar = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPagina(0); };
  const hayFiltros = !!(metodo || desde || hasta || placaTexto);
  const limpiar = () => { setMetodo(''); setDesde(''); setHasta(''); setPlacaTexto(''); setPlaca(''); setPagina(0); };

  const columnas: Column<EntradaAcceso>[] = [
    {
      key: 'cuando', header: t('entradas.col.when'), primary: true,
      cell: e => <span className="whitespace-nowrap font-mono text-xs text-gray-300">{formatearFechaHora(e.timestamp_entrada)}</span>,
    },
    {
      key: 'quien', header: t('entradas.col.person'),
      cell: e => (
        <>
          <span className="block font-medium text-gray-100">{e.es_residente ? e.residente_nombre : e.visitante_nombre ?? '—'}</span>
          <span className="block text-xs text-gray-400">
            {e.es_residente ? `${t('entradas.resident')} · ` : ''}{rellenar(t('entradas.house'), { casa: e.numero_casa })}
          </span>
        </>
      ),
    },
    {
      key: 'placa', header: t('entradas.col.plate'),
      cell: e => <span className="whitespace-nowrap font-mono text-sm text-gray-100">{e.placa ? formatearPlaca(e.placa) : '—'}</span>,
    },
    {
      key: 'metodo', header: t('entradas.col.method'),
      cell: e => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={e.metodo === 'anpr' ? 'info' : 'neutral'}>{t(`entradas.method.${e.metodo}`)}</Badge>
          {e.verificado && (
            <Badge tone="success" title={e.verificado_por_nombre ? rellenar(t('entradas.verifiedBy'), { nombre: e.verificado_por_nombre }) : undefined}>
              {t('entradas.verified')}
            </Badge>
          )}
          {!e.autorizado && <StatusText kind="bad">{t('entradas.rejected')}</StatusText>}
        </span>
      ),
    },
    {
      key: 'confianza', header: t('entradas.col.confidence'), align: 'right', hideOnMobile: true,
      cell: e => <span className="font-mono text-xs text-gray-300">{e.confianza == null ? '—' : `${Math.round(e.confianza * 100)} %`}</span>,
    },
    {
      key: 'evidencia', header: t('entradas.col.evidence'),
      cell: e => (e.id_cliente && e.evidencia_placa
        ? <EvidenciaMiniatura idCliente={e.id_cliente} placa={e.placa} />
        : <span className="text-xs text-gray-400">—</span>),
    },
    ...(mostrarSucursal ? [{
      key: 'sucursal', header: t('entradas.col.branch'), hideOnMobile: true,
      cell: (e: EntradaAcceso) => <span className="text-xs text-gray-300">{e.sucursal_nombre}</span>,
    }] : []),
    {
      key: 'salida', header: t('entradas.col.exit'), hideOnMobile: true,
      cell: e => (e.timestamp_salida
        ? <span className="font-mono text-xs text-gray-300">{formatearHora(e.timestamp_salida)}</span>
        : <StatusText kind="on">{t('entradas.inside')}</StatusText>),
    },
  ];

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const inicio = total === 0 ? 0 : pagina * POR_PAGINA + 1;
  const fin = Math.min((pagina + 1) * POR_PAGINA, total);

  return (
    <div className="sg-page text-gray-100">
      <div>
        <h1 className="text-xl font-bold text-white">{t('entradas.title')}</h1>
        <p className="mt-0.5 text-sm text-gray-400">{t('entradas.subtitle')}</p>
      </div>

      <div className="sg-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select label={t('entradas.filter.method')} value={metodo} onChange={e => cambiar<MetodoAcceso | ''>(setMetodo)(e.target.value as MetodoAcceso | '')}>
            <option value="">{t('entradas.filter.allMethods')}</option>
            {METODOS.map(m => <option key={m} value={m}>{t(`entradas.method.${m}`)}</option>)}
          </Select>
          <Input
            label={t('entradas.filter.plate')}
            value={placaTexto}
            onChange={e => setPlacaTexto(e.target.value)}
            placeholder={t('entradas.filter.platePlaceholder')}
            autoComplete="off"
            spellCheck={false}
          />
          <Input type="date" label={t('entradas.filter.from')} value={desde} max={hasta || undefined} onChange={e => cambiar(setDesde)(e.target.value)} />
          <Input type="date" label={t('entradas.filter.until')} value={hasta} min={desde || undefined} onChange={e => cambiar(setHasta)(e.target.value)} />
        </div>
        {hayFiltros && (
          <div className="mt-3 flex justify-end">
            <Button variant="secondary" size="sm" onClick={limpiar}>{t('entradas.filter.clear')}</Button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">
          {t('entradas.error')}
        </p>
      )}

      <DataTable
        columns={columnas}
        rows={filas}
        rowKey={e => e.id}
        loading={cargando}
        caption={t('entradas.title')}
        empty={(
          <EmptyState
            compact
            icon={ICON_ENTRADAS}
            title={t('entradas.empty')}
            description={hayFiltros ? t('entradas.emptyFiltered') : t('entradas.emptyHint')}
          />
        )}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-gray-400" role="status">
          {total === 0 ? t('entradas.noResults') : rellenar(t('entradas.range'), { desde: inicio, hasta: fin, total })}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPagina(p => Math.max(0, p - 1))} disabled={cargando || pagina === 0}>
            {t('entradas.prev')}
          </Button>
          <span className="px-1 text-xs text-gray-400">{pagina + 1} / {paginas}</span>
          <Button variant="secondary" size="sm" onClick={() => setPagina(p => (p + 1 < paginas ? p + 1 : p))} disabled={cargando || pagina + 1 >= paginas}>
            {t('entradas.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
