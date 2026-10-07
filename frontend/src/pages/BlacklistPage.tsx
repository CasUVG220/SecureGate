import { useEffect, useRef, useState } from 'react';
import {
  getBlacklist, createBlacklist, deleteBlacklist, buscarVisitantesPorDpi, buscarVisitantesPorPlaca,
  type Blacklist, type BlacklistInput, type BlacklistDuracion, type VisitanteBasico,
} from '../services/api';
import {
  Badge, Button, DataTable, EmptyState, Input, Modal, ROW_ICON, RowActions, Select, Spinner, Textarea, useToast,
  type Column,
} from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';
import { formatearPlaca, normalizarPlaca, PLACA_EJEMPLO } from '../utils/placa';
import { formatearFecha } from '../utils/fecha';

const DURACION_VALUES: { value: BlacklistDuracion; labelKey: string }[] = [
  { value: 'temporal_dias', labelKey: 'blacklist.durTemporal' },
  { value: '30_dias',       labelKey: 'blacklist.dur30' },
  { value: 'indefinido',    labelKey: 'blacklist.durIndefinido' },
];

const ICON_SEARCH = 'M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z';
const ICON_SHIELD = 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 8v4M12 16h.01';

type TipoBusqueda = 'dpi' | 'placa';

const EMPTY_FORM = { razon: '', duracion: 'temporal_dias' as BlacklistDuracion, dias: 7 as number | undefined };

export default function BlacklistPage() {
  const showToast = useToast();
  const { t } = useTranslation();

  const [entries, setEntries]     = useState<Blacklist[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [showModal, setShowModal] = useState(false);

  const [form, setForm]           = useState(EMPTY_FORM);
  const [tipo, setTipo]           = useState<TipoBusqueda>('dpi');
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState<VisitanteBasico[]>([]);
  const [buscando, setBuscando]   = useState(false);
  const [buscado, setBuscado]     = useState(false);
  const [selected, setSelected]   = useState<VisitanteBasico | null>(null);
  /** Placa (normalizada) que se bloqueará: sola, o junto con el visitante elegido. */
  const [placaBloqueo, setPlacaBloqueo] = useState<string | null>(null);
  const [incluirPlaca, setIncluirPlaca] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [quitando, setQuitando]   = useState<Blacklist | null>(null);
  const [quitandoBusy, setQuitandoBusy] = useState(false);

  // Solo la última búsqueda puede escribir resultados (las anteriores llegan tarde).
  const busquedaActual = useRef(0);

  const cargar = () => {
    setLoading(true);
    getBlacklist()
      .then(setEntries)
      .catch(() => showToast(t('blacklist.errorLoad'), 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const largoMinimo = (valor: string, modo: TipoBusqueda) =>
    (modo === 'placa' ? normalizarPlaca(valor) : valor.trim()).length >= 3;

  const ejecutarBusqueda = async (valor: string, modo: TipoBusqueda) => {
    const id = ++busquedaActual.current;
    if (!largoMinimo(valor, modo)) {
      setResults([]); setBuscado(false); setBuscando(false);
      return;
    }
    setBuscando(true);
    try {
      const found = modo === 'placa' ? await buscarVisitantesPorPlaca(valor) : await buscarVisitantesPorDpi(valor.trim());
      if (id !== busquedaActual.current) return;
      setResults(found);
      setBuscado(true);
    } catch {
      if (id !== busquedaActual.current) return;
      setResults([]);
      setBuscado(true);
    } finally {
      if (id === busquedaActual.current) setBuscando(false);
    }
  };

  const limpiarSeleccion = () => {
    setSelected(null);
    setPlacaBloqueo(null);
    setIncluirPlaca(false);
  };

  const handleQuery = (valor: string) => {
    setQuery(valor);
    limpiarSeleccion();
    void ejecutarBusqueda(valor, tipo);
  };

  const cambiarTipo = (nuevo: TipoBusqueda) => {
    setTipo(nuevo);
    setQuery('');
    setResults([]);
    setBuscado(false);
    limpiarSeleccion();
    busquedaActual.current++;
  };

  const selectVisitante = (v: VisitanteBasico) => {
    setSelected(v);
    setResults([]);
    setQuery(tipo === 'placa' && v.placa ? formatearPlaca(v.placa) : v.numero_dpi);
    // Si se buscó por placa, lo natural es bloquear también ese vehículo (se puede desmarcar).
    if (tipo === 'placa' && v.placa) {
      setPlacaBloqueo(normalizarPlaca(v.placa));
      setIncluirPlaca(true);
    } else {
      setPlacaBloqueo(null);
      setIncluirPlaca(false);
    }
  };

  const bloquearSoloPlaca = () => {
    setSelected(null);
    setResults([]);
    setPlacaBloqueo(normalizarPlaca(query));
    setIncluirPlaca(true);
  };

  const openModal = () => {
    setForm(EMPTY_FORM);
    setTipo('dpi');
    setQuery('');
    setResults([]);
    setBuscado(false);
    limpiarSeleccion();
    setFormError(null);
    setShowModal(true);
  };

  const soloPlacaElegida = !selected && placaBloqueo !== null;
  const mostrarSinResultados = buscado && !buscando && results.length === 0 && !selected && !soloPlacaElegida
    && largoMinimo(query, tipo);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const placa = incluirPlaca ? placaBloqueo : null;
    if (!selected && !placa) { setFormError(t('blacklist.selectVisitor')); return; }
    if (!form.razon.trim()) { setFormError(t('blacklist.reasonRequired')); return; }
    if (form.duracion === 'temporal_dias' && (!form.dias || form.dias < 1)) {
      setFormError(t('blacklist.daysRequired')); return;
    }
    const input: BlacklistInput = {
      razon:    form.razon.trim(),
      duracion: form.duracion,
      dias:     form.duracion === 'temporal_dias' ? form.dias : undefined,
      ...(selected ? { visitante_id: selected.id } : {}),
      ...(placa ? { placa } : {}),
    };
    setSaving(true); setFormError(null);
    try {
      await createBlacklist(input);
      setShowModal(false);
      cargar();
      showToast(t('blacklist.added'), 'warning');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const nombreDe = (e: Blacklist): string =>
    e.visitante_nombre ?? (e.placa ? `${t('blacklist.colPlate')} ${formatearPlaca(e.placa)}` : '—');

  const confirmarQuitar = async () => {
    if (!quitando) return;
    setQuitandoBusy(true);
    try {
      await deleteBlacklist(quitando.id);
      setQuitando(null);
      cargar();
      showToast(t('blacklist.removed'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setQuitandoBusy(false);
    }
  };

  const filtro = search.trim().toLowerCase();
  const filtroPlaca = normalizarPlaca(search);
  const filtered = entries.filter(e =>
    `${e.visitante_nombre ?? ''} ${e.numero_dpi ?? ''} ${e.razon}`.toLowerCase().includes(filtro)
    || (filtroPlaca.length >= 2 && (e.placa ?? '').includes(filtroPlaca))
  );

  const formatDate = (d: string | null) =>
    d ? formatearFecha(d) : '—';

  // Tipo de bloqueo derivado de fecha_fin: Permanente / 30 días / Temporal
  const banType = (e: Blacklist): string => {
    if (e.fecha_fin === null) return t('blacklist.permanent');
    const dias = Math.round(
      (new Date(e.fecha_fin).getTime() - new Date(e.fecha_inicio).getTime()) / 86_400_000
    );
    return dias === 30 ? t('blacklist.dur30') : t('blacklist.temporal');
  };

  const columns: Column<Blacklist>[] = [
    {
      key: 'visitante', header: t('blacklist.colVisitor'), primary: true, className: 'font-semibold text-gray-50',
      cell: e => e.visitante_nombre ?? <span className="font-medium text-gray-300">{t('blacklist.plateOnlyRow')}</span>,
    },
    { key: 'dpi', header: t('blacklist.colDpi'), className: 'font-mono text-xs text-gray-400', cell: e => e.numero_dpi ?? '—' },
    {
      key: 'placa', header: t('blacklist.colPlate'), className: 'font-mono text-xs text-gray-200',
      cell: e => (e.placa ? formatearPlaca(e.placa) : '—'),
    },
    {
      key: 'razon', header: t('blacklist.colReason'), className: 'text-gray-200',
      cell: e => <span className="block max-w-52 truncate" title={e.razon}>{e.razon}</span>,
    },
    {
      key: 'tipo', header: t('blacklist.colType'), align: 'center',
      cell: e => <Badge tone={e.fecha_fin === null ? 'danger' : 'warning'}>{banType(e)}</Badge>,
    },
    {
      key: 'vence', header: t('blacklist.colExpires'), align: 'center', className: 'text-xs text-gray-400',
      cell: e => (e.fecha_fin === null ? '∞' : formatDate(e.fecha_fin)),
    },
    { key: 'sucursal', header: t('blacklist.colBranch'), align: 'center', className: 'text-xs text-gray-400', cell: e => e.sucursal_nombre },
    {
      key: 'acciones', header: t('common.actions'), align: 'right', actions: true,
      cell: e => (
        <RowActions
          menuLabel={`${t('blacklist.rowActions')} ${nombreDe(e)}`}
          actions={[{ id: 'quitar', label: t('blacklist.remove'), icon: ROW_ICON.close, onClick: () => setQuitando(e) }]}
        />
      ),
    },
  ];

  return (
    <div className="sg-page">
      <div className="sg-page-inner space-y-5">
        <header className="sg-panel-heading">
          <div>
            <h1 className="text-2xl font-bold text-gray-50">{t('blacklist.title')}</h1>
            <p className="mt-1 text-sm text-gray-400">{t('blacklist.subtitle')}</p>
          </div>
          {(loading || !!search || entries.length > 0) && (
            <Button
              variant="danger"
              onClick={openModal}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={ICON_SHIELD} />
                </svg>
              }
            >
              {t('blacklist.add')}
            </Button>
          )}
        </header>

        <Input
          wrapperClassName="max-w-sm"
          icon={ICON_SEARCH}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('blacklist.searchPlaceholder')}
          aria-label={t('common.search')}
        />

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={e => e.id}
          loading={loading}
          caption={t('blacklist.title')}
          empty={
            search ? (
              <EmptyState icon={ICON_SEARCH} title={t('blacklist.empty')} />
            ) : (
              <EmptyState
                icon={ICON_SHIELD}
                title={t('empty.blacklist')}
                description={t('empty.blacklistHint')}
                action={<Button variant="danger" onClick={openModal}>{t('blacklist.add')}</Button>}
              />
            )
          }
        />
      </div>

      {/* Modal: bloquear */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        dismissible={!saving}
        title={t('blacklist.modalTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowModal(false)} disabled={saving}>{t('blacklist.cancel')}</Button>
            <Button variant="danger" type="submit" form="form-bloquear" loading={saving}>{t('blacklist.add')}</Button>
          </>
        }
      >
        <form id="form-bloquear" onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <p role="alert" className="rounded-lg border border-danger-500/40 bg-danger-500/10 px-3 py-2 text-sm text-danger-400">
              {formError}
            </p>
          )}

          {/* Buscar visitante por DPI o placa */}
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-xs font-semibold text-gray-300">{t('blacklist.searchByDpi')} *</legend>
            <div role="radiogroup" aria-label={t('blacklist.searchTypeLabel')} className="inline-flex rounded-lg border border-gray-600 p-0.5">
              {(['dpi', 'placa'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={tipo === m}
                  onClick={() => cambiarTipo(m)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    tipo === m ? 'bg-brand-500 text-brand-ink' : 'text-gray-300 hover:text-gray-50'
                  }`}
                >
                  {m === 'dpi' ? t('blacklist.typeDpi') : t('blacklist.typePlate')}
                </button>
              ))}
            </div>

            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={e => handleQuery(e.target.value)}
                placeholder={tipo === 'placa' ? t('blacklist.platePlaceholder').replace('P-123ABC', PLACA_EJEMPLO) : t('blacklist.dpiPlaceholder')}
                aria-label={t('blacklist.searchByDpi')}
                autoComplete="off"
                inputMode={tipo === 'dpi' ? 'numeric' : 'text'}
                className={`sg-input ${tipo === 'placa' ? 'uppercase' : ''}`}
              />
              {buscando && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2"><Spinner size={14} /></div>
              )}
              {results.length > 0 && (
                <ul role="listbox" className="absolute z-10 mt-1 max-h-44 w-full overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 shadow-xl">
                  {results.map(v => (
                    <li key={v.id} role="option" aria-selected={false}>
                      <button
                        type="button"
                        onClick={() => selectVisitante(v)}
                        className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-gray-700"
                      >
                        <span className="font-medium text-gray-50">{v.nombre}</span>
                        <span className="ml-2 text-xs text-gray-400">{v.numero_dpi}</span>
                        {v.placa && <span className="ml-2 font-mono text-xs text-gray-300">{formatearPlaca(v.placa)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {mostrarSinResultados && (
              <div role="status" className="rounded-lg border border-gray-600 bg-gray-500/10 px-3 py-2.5 text-sm text-gray-200">
                <p className="font-medium">{t('blacklist.noResults')}</p>
                {tipo === 'placa' && normalizarPlaca(query).length >= 4 && (
                  <>
                    <p className="mt-1 text-xs text-gray-400">{t('blacklist.noResultsPlateHint')}</p>
                    <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={bloquearSoloPlaca}>
                      {t('blacklist.blockPlateOnly')} {formatearPlaca(query)}
                    </Button>
                  </>
                )}
              </div>
            )}

            {selected && (
              <div className="space-y-1.5 text-xs">
                <p className="text-success-400">
                  {t('blacklist.selected')}: <strong>{selected.nombre}</strong> · {selected.numero_dpi}
                </p>
                {tipo === 'placa' && selected.placa && (
                  <label className="flex items-center gap-2 text-gray-200">
                    <input
                      type="checkbox"
                      checked={incluirPlaca}
                      onChange={e => setIncluirPlaca(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-500"
                    />
                    {t('blacklist.alsoBlockPlate')} <span className="font-mono">{formatearPlaca(selected.placa)}</span>
                  </label>
                )}
              </div>
            )}

            {soloPlacaElegida && placaBloqueo && (
              <p className="text-xs text-warning-400">
                {t('blacklist.plateOnlySelected')} <strong className="font-mono">{formatearPlaca(placaBloqueo)}</strong>{' '}
                ({t('blacklist.plateOnlyNote')}).
              </p>
            )}
          </fieldset>

          <Select
            label={`${t('blacklist.duration')} *`}
            value={form.duracion}
            onChange={e => setForm(prev => ({ ...prev, duracion: e.target.value as BlacklistDuracion }))}
          >
            {DURACION_VALUES.map(d => (
              <option key={d.value} value={d.value}>{t(d.labelKey)}</option>
            ))}
          </Select>

          {form.duracion === 'temporal_dias' && (
            <Input
              label={`${t('blacklist.days')} *`}
              type="number"
              min={1}
              value={form.dias ?? ''}
              onChange={e => setForm(prev => ({ ...prev, dias: e.target.value ? parseInt(e.target.value, 10) : undefined }))}
            />
          )}

          <Textarea
            label={`${t('blacklist.reason')} *`}
            value={form.razon}
            onChange={e => setForm(prev => ({ ...prev, razon: e.target.value }))}
            rows={3}
            placeholder={t('blacklist.reasonPlaceholder')}
          />
        </form>
      </Modal>

      {/* Modal: quitar el bloqueo */}
      <Modal
        open={quitando !== null}
        onClose={() => { if (!quitandoBusy) setQuitando(null); }}
        dismissible={!quitandoBusy}
        size="sm"
        title={t('blacklist.removeTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setQuitando(null)} disabled={quitandoBusy}>{t('blacklist.cancel')}</Button>
            <Button variant="primary" onClick={confirmarQuitar} loading={quitandoBusy}>{t('blacklist.removeConfirmBtn')}</Button>
          </>
        }
      >
        {quitando && (
          <div className="space-y-2 text-sm text-gray-300">
            <p>{t('blacklist.removeConfirm')} <strong className="text-gray-50">{nombreDe(quitando)}</strong>?</p>
            <p>{t('blacklist.removeBody')}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
