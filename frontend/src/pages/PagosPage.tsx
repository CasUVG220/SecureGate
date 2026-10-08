import { useEffect, useMemo, useState } from 'react';
import {
  getPagos, createPago, aprobarPago, rechazarPago, getResidentes,
  type Pago, type Residente,
} from '../services/api';
import {
  Badge, Button, DataTable, EmptyState, ESTADO_PAGO_TONE, Input, Modal, Select, useToast,
  type Column,
} from '../components/ui';
import { Skeleton } from '../components/Skeleton';
import { useTranslation } from '../i18n/useTranslation';
import { formatearFecha } from '../utils/fecha';

const EMPTY_FORM = { residente_id: '', monto: '' };

const ICON_SEARCH = 'M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z';
const ICON_PAYMENTS = 'M1 4h22v16H1zM1 10h22';

export default function PagosPage() {
  const showToast = useToast();
  const { t } = useTranslation();
  const [pagos, setPagos]           = useState<Pago[]>([]);
  const [residentes, setResidentes] = useState<Residente[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [showModal, setShowModal]   = useState(false);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);
  const [actionId, setActionId]     = useState<string | null>(null);

  const LABEL: Record<string, string> = {
    aprobado: t('payments.approved'), pendiente: t('payments.pending'), rechazado: t('payments.rejected'),
  };
  const METODO_LABEL: Record<string, string> = {
    efectivo: t('payments.cash'), transferencia: t('payments.transfer'),
    tarjeta: t('card.payWithCard'), reserva: t('payments.reservation'),
  };

  const cargarPagos = () => {
    setLoading(true);
    getPagos()
      .then(setPagos)
      .catch(() => setError('No se pudo cargar la lista de pagos.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    cargarPagos();
    getResidentes().then(setResidentes).catch(() => {});
  }, []);

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.residente_id || !form.monto) { setFormError('Selecciona un residente e ingresa el monto.'); return; }
    const monto = parseFloat(form.monto);
    if (isNaN(monto) || monto <= 0) { setFormError('El monto debe ser mayor a 0.'); return; }
    setSaving(true); setFormError(null);
    try {
      await createPago({ residente_id: form.residente_id, monto });
      setShowModal(false);
      setForm(EMPTY_FORM);
      cargarPagos();
      showToast(t('payments.created'));
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error al registrar pago');
    } finally {
      setSaving(false);
    }
  };

  const handleAprobar = async (id: string) => {
    setActionId(id);
    try {
      await aprobarPago(id);
      cargarPagos();
      showToast(t('payments.paymentApproved'));
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error al aprobar pago', 'error');
    } finally {
      setActionId(null);
    }
  };

  const handleRechazar = async (id: string) => {
    setActionId(id);
    try {
      await rechazarPago(id);
      cargarPagos();
      showToast(t('payments.paymentRejected'), 'warning');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error al rechazar pago', 'error');
    } finally {
      setActionId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    // La vista normal no incluye los rechazados (no son ingresos); se ven al elegir «Rechazado».
    return pagos.filter(p =>
      (filterEstado ? p.estado === filterEstado : p.estado !== 'rechazado') &&
      (`${p.numero_casa} ${p.residente_nombre}`).toLowerCase().includes(q)
    );
  }, [pagos, filterEstado, search]);

  const ocultosRechazados = filterEstado ? 0 : pagos.filter(p => p.estado === 'rechazado').length;
  const filtrando = Boolean(search || filterEstado);

  const columns: Column<Pago>[] = [
    { key: 'casa', header: t('residents.house'), primary: true, className: 'font-bold text-gray-50', cell: p => p.numero_casa },
    { key: 'residente', header: t('payments.resident'), className: 'text-gray-100', cell: p => p.residente_nombre },
    {
      key: 'monto', header: t('common.amount'), align: 'right',
      className: 'font-semibold tabular-nums text-gray-50',
      cell: p => `Q${parseFloat(p.monto).toFixed(2)}`,
    },
    {
      key: 'metodo', header: t('payments.method'), className: 'text-gray-300',
      // `es_simulado` marca los pagos generados por la pasarela de prueba.
      cell: p => p.es_simulado
        ? `${METODO_LABEL[p.metodo] ?? p.metodo} · ${t('card.simulated')}`
        : (METODO_LABEL[p.metodo] ?? p.metodo),
    },
    {
      key: 'estado', header: t('common.status'),
      cell: p => (
        <Badge tone={ESTADO_PAGO_TONE[p.estado] ?? 'neutral'} dot>
          {LABEL[p.estado] ?? p.estado}
        </Badge>
      ),
    },
    {
      key: 'fecha', header: t('common.date'), className: 'whitespace-nowrap text-gray-400',
      cell: p => formatearFecha(p.fecha_pago),
    },
    {
      key: 'acciones', header: t('common.actions'), align: 'right', actions: true,
      cell: p => p.estado !== 'pendiente' ? null : (
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="secondary" loading={actionId === p.id} onClick={() => handleAprobar(p.id)}>
            {t('common.approve')}
          </Button>
          <Button size="sm" variant="ghost" disabled={actionId === p.id} onClick={() => handleRechazar(p.id)} className="text-danger-400 hover:bg-danger-500/12 hover:text-danger-400">
            {t('common.reject')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="sg-page">
      <div className="sg-page-inner space-y-5">
        <header className="sg-panel-heading">
          <div>
            <h1 className="text-2xl font-bold text-gray-50">{t('payments.title')}</h1>
            <div className="mt-1 text-sm text-gray-400">
              {loading
                ? <Skeleton height="0.875rem" width="5rem" />
                : <p>
                    {`${filtered.length} / ${pagos.length - ocultosRechazados}`}
                    {ocultosRechazados > 0 && ` · ${ocultosRechazados} ${t('payments.hiddenRejected')}`}
                  </p>}
            </div>
          </div>
          <Button onClick={() => { setForm(EMPTY_FORM); setFormError(null); setShowModal(true); }}>
            {t('payments.registerCash')}
          </Button>
        </header>

        {error && (
          <p role="alert" className="rounded-xl border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-400">{error}</p>
        )}

        <div className="sg-card flex flex-col gap-3 p-4 sm:flex-row">
          <Input
            wrapperClassName="flex-1"
            icon={ICON_SEARCH}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por casa o residente…"
            aria-label={t('common.search')}
          />
          <Select
            wrapperClassName="sm:w-52"
            value={filterEstado}
            onChange={e => setFilterEstado(e.target.value)}
            aria-label={t('common.status')}
          >
            <option value="">{t('payments.allNoRejected')}</option>
            <option value="pendiente">{t('payments.pending')}</option>
            <option value="aprobado">{t('payments.approved')}</option>
            <option value="rechazado">{t('payments.rejected')}</option>
          </Select>
        </div>

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={p => p.id}
          loading={loading}
          caption={t('payments.title')}
          empty={
            filtrando ? (
              <EmptyState
                icon={ICON_SEARCH}
                title={t('empty.paymentsFiltered')}
                action={
                  <Button variant="secondary" onClick={() => { setSearch(''); setFilterEstado(''); }}>
                    {t('empty.clearFilters')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={ICON_PAYMENTS}
                title={t('payments.noPayments')}
                description={t('empty.paymentsHint')}
                action={<Button onClick={() => setShowModal(true)}>{t('empty.addFirst')}</Button>}
              />
            )
          }
        />
      </div>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={t('payments.modalTitle')}
        dismissible={!saving}
      >
        <form onSubmit={handleCrear} className="space-y-4">
          {formError && (
            <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-sm text-danger-400">{formError}</p>
          )}
          <Select name="residente_id" label={t('payments.resident')} required value={form.residente_id} onChange={handleFormChange}>
            <option value="">{t('payments.selectResident')}</option>
            {residentes.map(r => (
              <option key={r.id} value={r.id}>{t('residents.house')} {r.numero_casa} — {r.nombre}</option>
            ))}
          </Select>
          <Input
            name="monto" label={t('payments.amountLabel')} required type="number" min="0.01" step="0.01"
            placeholder="0.00" value={form.monto} onChange={handleFormChange} suffix="Q"
          />
          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowModal(false)} disabled={saving}>{t('common.cancel')}</Button>
            <Button type="submit" loading={saving}>{saving ? t('common.saving') : t('common.save')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
