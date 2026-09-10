import { useEffect, useState } from 'react';
import { getConfigQr, updateConfigQr, type ConfigQr } from '../services/api';
import { FormSkeleton, Spinner } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n/useTranslation';

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

export default function ConfiguracionQrPage() {
  const { t } = useTranslation();
  const showToast = useToast();

  const [config, setConfig] = useState<ConfigQr | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [esDefault, setEsDefault] = useState(false);

  const [form, setForm] = useState({
    dpi_obligatorio_individual: true,
    requiere_placa: false,
    autorizacion_automatica: false,
    max_intentos_fallidos: '5',
    bloqueo_minutos: '15',
  });

  useEffect(() => {
    getConfigQr()
      .then(c => {
        setConfig(c);
        setEsDefault(!!c.es_default);
        setForm({
          dpi_obligatorio_individual: c.dpi_obligatorio_individual,
          requiere_placa: c.requiere_placa,
          autorizacion_automatica: c.autorizacion_automatica,
          max_intentos_fallidos: String(c.max_intentos_fallidos),
          bloqueo_minutos: String(c.bloqueo_minutos),
        });
      })
      .catch(() => setError('No se pudo cargar la configuración de QR.'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    const maxIntentos = Number(form.max_intentos_fallidos);
    const bloqueoMin = Number(form.bloqueo_minutos);
    if (!Number.isFinite(maxIntentos) || maxIntentos <= 0) {
      setFormError('El máximo de intentos fallidos debe ser mayor a 0.');
      return;
    }
    if (!Number.isFinite(bloqueoMin) || bloqueoMin <= 0) {
      setFormError('Los minutos de bloqueo deben ser mayores a 0.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const saved = await updateConfigQr({
        dpi_obligatorio_individual: form.dpi_obligatorio_individual,
        requiere_placa: form.requiere_placa,
        autorizacion_automatica: form.autorizacion_automatica,
        max_intentos_fallidos: maxIntentos,
        bloqueo_minutos: bloqueoMin,
      });
      setConfig(saved);
      setEsDefault(false);
      showToast(t('qr.configSaved'));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="sg-page-inner"><FormSkeleton fields={4} /></div>;
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
        <h2 className="text-lg font-bold text-white">{t('qr.configTitle')}</h2>
        <p className="text-sm text-gray-400 mt-0.5">{t('qr.configSubtitle')}</p>
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
            checked={form.dpi_obligatorio_individual}
            onChange={e => setForm(p => ({ ...p, dpi_obligatorio_individual: e.target.checked }))}
          />
          <span>
            <span className="font-medium">{t('qr.requireDpi')}</span>
            <span className="block text-xs text-gray-500 mt-0.5">{t('qr.requireDpiHelp')}</span>
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm text-gray-300">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.requiere_placa}
            onChange={e => setForm(p => ({ ...p, requiere_placa: e.target.checked }))}
          />
          <span>
            <span className="font-medium">{t('qr.requirePlate')}</span>
            <span className="block text-xs text-gray-500 mt-0.5">{t('qr.requirePlateHelp')}</span>
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm text-gray-300">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.autorizacion_automatica}
            onChange={e => setForm(p => ({ ...p, autorizacion_automatica: e.target.checked }))}
          />
          <span>
            <span className="font-medium">{t('qr.autoAuthorize')}</span>
            <span className="block text-xs text-gray-500 mt-0.5">{t('qr.autoAuthorizeHelp')}</span>
          </span>
        </label>

        <div className="grid sm:grid-cols-2 gap-5">
          <Campo label={t('qr.maxFailedAttempts')} help={t('qr.maxFailedAttemptsHelp')}>
            <input
              type="number"
              min="1"
              value={form.max_intentos_fallidos}
              onChange={e => setForm(p => ({ ...p, max_intentos_fallidos: e.target.value }))}
              className={INPUT}
            />
          </Campo>

          <Campo label={t('qr.lockoutMinutes')} help={t('qr.lockoutMinutesHelp')}>
            <input
              type="number"
              min="1"
              value={form.bloqueo_minutos}
              onChange={e => setForm(p => ({ ...p, bloqueo_minutos: e.target.value }))}
              className={INPUT}
            />
          </Campo>
        </div>

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
