import { useEffect, useMemo, useState } from 'react';
import { rellenar } from '../components/charts/format';
import {
  getPreautorizaciones, deletePreautorizacion, getResidentes,
  type Preautorizacion, type Residente,
} from '../services/api';
import { useToast } from '../components/Toast';
import {
  Button, DataTable, EmptyState, ROW_ICON, RowActions, StatusText,
  type Column, type StatusKind,
  useConfirmacion,
} from '../components/ui';
import AvisarVisitaModal, { type DatosVisita } from '../components/AvisarVisitaModal';
import { useTranslation } from '../i18n/useTranslation';
import { diaISO, formatearRangoDias, hoyEnZona } from '../utils/fecha';
import { formatearPlaca } from '../utils/placa';

const ICON_VISITA = 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75';

type Estado = 'hoy' | 'proxima' | 'vencida';
const ESTADO_KEY: Record<Estado, string> = { hoy: 'aviso.state.current', proxima: 'aviso.state.upcoming', vencida: 'aviso.state.expired' };
const ESTADO_TONO: Record<Estado, StatusKind> = { hoy: 'on', proxima: 'warn', vencida: 'off' };

/** Estado de un aviso respecto de hoy (día de Guatemala). Las fechas son días de calendario. */
const estadoDe = (p: Preautorizacion, hoy: string): Estado => {
  const inicio = diaISO(p.fecha_inicio) ?? '';
  const fin = diaISO(p.fecha_fin) ?? '';
  if (fin && fin < hoy) return 'vencida';
  if (inicio > hoy) return 'proxima';
  return 'hoy';
};

/**
 * Visitas avisadas (administrador). Solo aparecen los avisos con fecha de fin: los «visitantes guardados» de la
 * libreta de un residente no autorizan nada y no tienen por qué estorbar aquí. Las vencidas se esconden hasta pedirlas.
 */
export default function PreautPage() {
  const showToast = useToast();
  const { t } = useTranslation();
  const { confirmar, dialogo: dialogoConfirmar } = useConfirmacion();
  const [avisos, setAvisos]         = useState<Preautorizacion[]>([]);
  const [residentes, setResidentes] = useState<Residente[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [dialogo, setDialogo]       = useState<{ abierto: boolean; inicial: DatosVisita | null }>({ abierto: false, inicial: null });
  const [verVencidas, setVerVencidas] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const cargar = () => {
    setLoading(true);
    getPreautorizaciones()
      .then(setAvisos)
      .catch(() => setError('No se pudo cargar la lista de visitas avisadas.'))
      .finally(() => setLoading(false));
  };

  // Carga inicial de la pantalla; el estado se actualiza al resolver las peticiones.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar(); getResidentes().then(setResidentes).catch(() => {}); }, []);

  const hoy = hoyEnZona();
  const conFecha = useMemo(() => avisos.filter(p => p.fecha_fin !== null), [avisos]);
  const vencidas = useMemo(() => conFecha.filter(p => estadoDe(p, hoy) === 'vencida').length, [conFecha, hoy]);
  const visibles = verVencidas ? conFecha : conFecha.filter(p => estadoDe(p, hoy) !== 'vencida');

  const handleEliminar = async (p: Preautorizacion) => {
    const ok = await confirmar({
      title: rellenar(t('confirm.deleteNotice.title'), { nombre: p.nombre_visitante }),
      message: t('confirm.deleteNotice.message'),
      confirmLabel: t('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;
    setDeletingId(p.id);
    try {
      await deletePreautorizacion(p.id);
      cargar();
      showToast(t('aviso.deleted'), 'warning');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error al eliminar', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const abrirNuevo = () => setDialogo({ abierto: true, inicial: null });
  const abrirOtraVez = (p: Preautorizacion) => setDialogo({
    abierto: true,
    inicial: { residente_id: p.residente_id, nombre_visitante: p.nombre_visitante, numero_dpi: p.numero_dpi, placa: p.placa },
  });

  const columnas: Column<Preautorizacion>[] = [
    {
      key: 'casa', header: t('aviso.list.house'), primary: true,
      cell: p => (
        <>
          <span className="font-medium text-gray-100">{p.numero_casa}</span>
          <span className="block text-xs text-gray-400">{p.residente_nombre}</span>
        </>
      ),
    },
    { key: 'visitante', header: t('aviso.list.visitor'), cell: p => <span className="text-gray-100">{p.nombre_visitante}</span> },
    { key: 'dpi', header: t('aviso.dpi'), hideOnMobile: true, cell: p => <span className="text-gray-400">{p.numero_dpi ?? '—'}</span> },
    {
      key: 'placa', header: t('aviso.plate'),
      cell: p => p.placa ? <span className="font-mono text-gray-200">{formatearPlaca(p.placa)}</span> : <span className="text-gray-500">—</span>,
    },
    { key: 'fechas', header: t('aviso.list.dates'), cell: p => <span className="text-gray-300">{formatearRangoDias(p.fecha_inicio, p.fecha_fin)}</span> },
    {
      key: 'estado', header: t('common.status'), hideOnMobile: true,
      cell: p => { const e = estadoDe(p, hoy); return <StatusText kind={ESTADO_TONO[e]}>{t(ESTADO_KEY[e])}</StatusText>; },
    },
    {
      key: 'acciones', header: t('common.actions'), actions: true,
      cell: p => (
        <RowActions
          align="start"
          menuLabel={`${t('common.actions')}: ${p.nombre_visitante}`}
          actions={[
            { id: 'otra-vez', label: t('aviso.again'), icon: ROW_ICON.clock, tone: 'primary', onClick: () => abrirOtraVez(p) },
            {
              id: 'eliminar', label: t('common.delete'), icon: ROW_ICON.trash, tone: 'danger',
              loading: deletingId === p.id, onClick: () => handleEliminar(p),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="sg-page text-gray-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">{t('aviso.list.title')}</h1>
          <p className="mt-1 text-sm text-gray-400">{t('aviso.list.subtitle')}</p>
        </div>
        {(loading || visibles.length > 0) && <Button onClick={abrirNuevo}>{t('aviso.title')}</Button>}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-400">{error}</div>
      )}

      <DataTable
        columns={columnas}
        rows={visibles}
        rowKey={p => p.id}
        loading={loading}
        caption={t('aviso.list.title')}
        empty={
          <EmptyState
            icon={ICON_VISITA}
            title={t('aviso.list.empty')}
            description={t('aviso.list.emptyHint')}
            action={<Button onClick={abrirNuevo}>{t('aviso.title')}</Button>}
          />
        }
      />

      {vencidas > 0 && (
        <button
          type="button"
          onClick={() => setVerVencidas(v => !v)}
          aria-expanded={verVencidas}
          className="self-start text-xs font-semibold text-gray-300 underline underline-offset-4 hover:text-gray-50"
        >
          {verVencidas ? t('aviso.list.hideExpired') : t('aviso.list.showExpired').replace('{n}', String(vencidas))}
        </button>
      )}

      <AvisarVisitaModal
        open={dialogo.abierto}
        onClose={() => setDialogo(d => ({ ...d, abierto: false }))}
        residentes={residentes}
        inicial={dialogo.inicial}
        onCreada={() => cargar()}
      />
      {dialogoConfirmar}
    </div>
  );
}
