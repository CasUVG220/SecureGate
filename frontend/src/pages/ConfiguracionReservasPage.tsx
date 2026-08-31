import { useEffect, useState } from 'react';
import { getConfigReservas, updateConfigReservas, type ConfigReservas } from '../services/api';
import { Spinner } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n/useTranslation';

/** Campo con etiqueta y texto de ayuda debajo. */
function Campo({
  label, help, children,
}: { label: string; help: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
      {children}
      <p className="text-xs text-gray-500 mt-1">{help}</p>
    </div>
  );
}

const INPUT =
  'w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500';

export default function ConfiguracionReservasPage() {
  const { t } = useTranslation();
  const showToast = useToast();

  const [config, setConfig] = useState<ConfigReservas | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [esDefault, setEsDefault] = useState(false);

  const [form, setForm] = useState({
    permite_cancelacion: true,
    horas_limite_cancelacion_completa: '48',
    horas_limite_cancelacion_parcial: '24',
    porcentaje_reembolso_parcial: '50',
    max_reservas_activas_por_residente: '',
    requiere_aprobacion_admin: false,
    buffer_minutos_entre_reservas: '0',
    buffer_motivo: '',
  });

  useEffect(() => {
    getConfigReservas()
      .then(c => {
        setConfig(c);
        setEsDefault(!!c.es_default);
        setForm({
          permite_cancelacion: c.permite_cancelacion,
          horas_limite_cancelacion_completa: String(c.horas_limite_cancelacion_completa),
          horas_limite_cancelacion_parcial: String(c.horas_limite_cancelacion_parcial),
          porcentaje_reembolso_parcial: String(parseFloat(String(c.porcentaje_reembolso_parcial))),
          max_reservas_activas_por_residente:
            c.max_reservas_activas_por_residente === null
              ? ''
              : String(c.max_reservas_activas_por_residente),
          requiere_aprobacion_admin: c.requiere_aprobacion_admin,
          buffer_minutos_entre_reservas: String(c.buffer_minutos_entre_reservas),
          buffer_motivo: c.buffer_motivo ?? '',
        });
      })
      .catch(() => setError('No se pudo cargar la configuración de reservas.'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    const completa = Number(form.horas_limite_cancelacion_completa);
    const parcial = Number(form.horas_limite_cancelacion_parcial);
    if (completa < parcial) {
      setFormError('El límite de reembolso completo debe ser mayor o igual al parcial.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      // max_reservas y buffer_motivo se envían SIEMPRE (aunque vayan vacíos)
      // porque null es un valor con significado: "sin límite" / "sin motivo".
      const saved = await updateConfigReservas({
        permite_cancelacion: form.permite_cancelacion,
        horas_limite_cancelacion_completa: completa,
        horas_limite_cancelacion_parcial: parcial,
        porcentaje_reembolso_parcial: Number(form.porcentaje_reembolso_parcial),
        max_reservas_activas_por_residente:
          form.max_reservas_activas_por_residente.trim() === ''
            ? null
            : Number(form.max_reservas_activas_por_residente),
        requiere_aprobacion_admin: form.requiere_aprobacion_admin,
        buffer_minutos_entre_reservas: Number(form.buffer_minutos_entre_reservas),
        buffer_motivo: form.buffer_motivo.trim() || null,
      });
      setConfig(saved);
      setEsDefault(false);
      showToast(t('reservas.configSaved'));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-gray-400 text-sm">{t('common.loading')}</p>;
  if (error && !config) {
    return (
      <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="sg-page-inner space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white">{t('reservas.configTitle')}</h2>
        <p className="text-sm text-gray-400 mt-0.5">{t('reservas.configSubtitle')}</p>
      </div>

      {esDefault && (
        <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg px-4 py-3 text-blue-300 text-sm">
          {t('reservas.usingDefaults')}
        </div>
      )}

      {formError && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          {formError}
        </div>
      )}

      <div className="sg-card p-5 sm:p-6 space-y-5">
        <label className="flex items-start gap-3 text-sm text-gray-300">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.permite_cancelacion}
            onChange={e => setForm(p => ({ ...p, permite_cancelacion: e.target.checked }))}
          />
          <span>
            <span className="font-medium">{t('reservas.allowCancel')}</span>
            <span className="block text-xs text-gray-500 mt-0.5">{t('reservas.allowCancelHelp')}</span>
          </span>
        </label>

        <div className="grid sm:grid-cols-2 gap-5">
          <Campo label={t('reservas.fullRefundHours')} help={t('reservas.fullRefundHoursHelp')}>
            <input
              name="horas_limite_cancelacion_completa"
              type="number"
              min="0"
              value={form.horas_limite_cancelacion_completa}
              onChange={e =>
                setForm(p => ({ ...p, horas_limite_cancelacion_completa: e.target.value }))
              }
              className={INPUT}
            />
          </Campo>

          <Campo label={t('reservas.partialRefundHours')} help={t('reservas.partialRefundHoursHelp')}>
            <input
              name="horas_limite_cancelacion_parcial"
              type="number"
              min="0"
              value={form.horas_limite_cancelacion_parcial}
              onChange={e =>
                setForm(p => ({ ...p, horas_limite_cancelacion_parcial: e.target.value }))
              }
              className={INPUT}
            />
          </Campo>

          <Campo label={t('reservas.partialRefundPct')} help={t('reservas.partialRefundPctHelp')}>
            <input
              name="porcentaje_reembolso_parcial"
              type="number"
              min="0"
              max="100"
              value={form.porcentaje_reembolso_parcial}
              onChange={e => setForm(p => ({ ...p, porcentaje_reembolso_parcial: e.target.value }))}
              className={INPUT}
            />
          </Campo>

          <Campo label={t('reservas.maxActive')} help={t('reservas.maxActiveHelp')}>
            <input
              name="max_reservas_activas_por_residente"
              type="number"
              min="1"
              placeholder={t('reservas.noLimit')}
              value={form.max_reservas_activas_por_residente}
              onChange={e =>
                setForm(p => ({ ...p, max_reservas_activas_por_residente: e.target.value }))
              }
              className={INPUT}
            />
          </Campo>
        </div>

        <label className="flex items-start gap-3 text-sm text-gray-300">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.requiere_aprobacion_admin}
            onChange={e => setForm(p => ({ ...p, requiere_aprobacion_admin: e.target.checked }))}
          />
          <span>
            <span className="font-medium">{t('reservas.requireApproval')}</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              {t('reservas.requireApprovalHelp')}
            </span>
          </span>
        </label>

        <Campo label={t('reservas.bufferMinutes')} help={t('reservas.bufferMinutesHelp')}>
          <input
            name="buffer_minutos_entre_reservas"
            type="number"
            min="0"
            max="1440"
            value={form.buffer_minutos_entre_reservas}
            onChange={e => setForm(p => ({ ...p, buffer_minutos_entre_reservas: e.target.value }))}
            className={INPUT}
          />
        </Campo>

        <Campo label={t('reservas.bufferReason')} help={t('reservas.bufferReasonHelp')}>
          <input
            name="buffer_motivo"
            placeholder="Limpieza y desinfección entre usos"
            value={form.buffer_motivo}
            onChange={e => setForm(p => ({ ...p, buffer_motivo: e.target.value }))}
            className={INPUT}
          />
        </Campo>

        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-6 py-2 rounded-xl transition-colors flex items-center gap-2"
        >
          {saving && <Spinner size={14} />}
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </div>
  );
}
