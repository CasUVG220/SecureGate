import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  crearInvitacionQr, getConfigQr,
  type InvitacionQr, type InvitacionQrInput, type InvitacionQrTipo, type ConfigQr,
} from '../services/api';
import { Spinner } from './Skeleton';
import { useTranslation } from '../i18n/useTranslation';

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_FORM = {
  tipo: 'individual' as InvitacionQrTipo,
  etiqueta: '',
  nombre_visitante: '',
  numero_dpi: '',
  placa: '',
  fecha_inicio: today(),
  fecha_fin: '',
  usos_maximos: '',
};

interface Props {
  /** Si viene una invitación existente, se muestra directo el QR (modo "ver"), sin formulario. */
  invitacion?: InvitacionQr | null;
  onClose: () => void;
  onCreated?: (inv: InvitacionQr) => void;
}

export default function QrInviteModal({ invitacion, onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated]     = useState<InvitacionQr | null>(invitacion ?? null);
  const [qrDataUri, setQrDataUri] = useState<string | null>(null);
  const [config, setConfig]       = useState<ConfigQr | null>(null);

  useEffect(() => {
    if (!created) return;
    QRCode.toDataURL(`SGQR:${created.id}`, { width: 320, margin: 2 })
      .then(setQrDataUri)
      .catch(() => setQrDataUri(null));
  }, [created]);

  useEffect(() => {
    if (created) return;
    getConfigQr().then(setConfig).catch(() => {});
  }, [created]);

  // Mientras la config no cargó, se asume el default (DPI obligatorio) para
  // no dejar pasar un formulario que el backend terminaría rechazando.
  const dpiRequerido = config ? config.dpi_obligatorio_individual : true;
  const placaRequerida = config ? config.requiere_placa : false;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fecha_inicio) {
      setFormError(t('qr.errorFechaInicio'));
      return;
    }
    if (form.tipo === 'individual' && !form.nombre_visitante.trim()) {
      setFormError(t('qr.errorIndividual'));
      return;
    }
    if (form.tipo === 'individual' && dpiRequerido && !form.numero_dpi.trim()) {
      setFormError(t('qr.errorIndividual'));
      return;
    }
    if (placaRequerida && !form.placa.trim()) {
      setFormError(t('qr.errorPlacaRequerida'));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload: InvitacionQrInput = {
        tipo: form.tipo,
        etiqueta: form.etiqueta.trim() || undefined,
        placa: form.placa.trim() || undefined,
        fecha_inicio: form.fecha_inicio,
        fecha_fin: form.fecha_fin || undefined,
        usos_maximos: form.usos_maximos ? Number(form.usos_maximos) : undefined,
        ...(form.tipo === 'individual'
          ? { nombre_visitante: form.nombre_visitante.trim(), numero_dpi: form.numero_dpi.trim() || undefined }
          : {}),
      };
      const result = await crearInvitacionQr(payload);
      setCreated(result);
      onCreated?.(result);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const canShareFiles = typeof navigator !== 'undefined' && !!navigator.canShare && !!navigator.share;

  const handleShare = async () => {
    if (!qrDataUri || !created) return;
    try {
      const res = await fetch(qrDataUri);
      const blob = await res.blob();
      const file = new File([blob], `invitacion-qr-${created.id}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: t('qr.title') });
      }
    } catch {
      // El usuario canceló el share o el navegador lo rechazó — no es un error a mostrar.
    }
  };

  return (
    <div className="sg-drawer-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="sg-card max-h-[95vh] w-full rounded-t-3xl p-5 sm:max-w-md sm:rounded-2xl sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">
            {created ? t('qr.modalTitle') : t('qr.newInvite')}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">
            ✕
          </button>
        </div>

        {created ? (
          <div className="space-y-4 text-center">
            {qrDataUri ? (
              <img src={qrDataUri} alt="QR" className="mx-auto rounded-lg border border-gray-600 bg-white p-2" />
            ) : (
              <div className="h-40 flex items-center justify-center"><Spinner size={24} /></div>
            )}
            <div className="text-sm text-gray-300 space-y-0.5">
              {created.etiqueta && <p className="font-semibold text-white">{created.etiqueta}</p>}
              <p>{created.tipo === 'individual' ? t('qr.typeIndividual') : t('qr.typeGroup')}</p>
              {created.tipo === 'individual' && (
                <p className="text-gray-400">
                  {created.nombre_visitante}{created.numero_dpi ? ` · ${created.numero_dpi}` : ''}
                </p>
              )}
              {created.placa && (
                <p className="text-gray-400">{t('qr.plate')}: {created.placa}</p>
              )}
              {created.usos_maximos != null && (
                <p className="text-gray-400">{created.usos_actuales}/{created.usos_maximos} {t('qr.usesLabel')}</p>
              )}
            </div>
            <div className="flex gap-3">
              <a
                href={qrDataUri ?? undefined}
                download={`invitacion-qr-${created.id}.png`}
                className={`flex-1 bg-brand-500 hover:bg-brand-600 text-brand-ink text-center font-semibold py-2 rounded-xl transition-colors text-sm ${!qrDataUri ? 'pointer-events-none opacity-50' : ''}`}
              >
                {t('qr.download')}
              </a>
              {canShareFiles && (
                <button
                  onClick={handleShare}
                  className="sg-btn sg-btn-secondary flex-1 text-sm"
                >
                  {t('qr.share')}
                </button>
              )}
            </div>
            <button
              onClick={onClose}
              className="sg-btn sg-btn-secondary w-full text-sm"
            >
              {t('common.close')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleCrear} className="space-y-4">
            {formError && (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">
                {formError}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">{t('qr.type')}</label>
              <select
                name="tipo"
                value={form.tipo}
                onChange={handleChange}
                className="sg-input appearance-none"
              >
                <option value="individual">{t('qr.typeIndividual')}</option>
                <option value="grupal">{t('qr.typeGroup')}</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                {form.tipo === 'individual' ? t('qr.helpIndividual') : t('qr.helpGroup')}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">{t('qr.label')}</label>
              <input
                name="etiqueta"
                value={form.etiqueta}
                onChange={handleChange}
                placeholder={t('qr.labelPlaceholder')}
                className="sg-input"
              />
            </div>

            {form.tipo === 'individual' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    {t('qr.visitorName')} *
                  </label>
                  <input
                    name="nombre_visitante"
                    value={form.nombre_visitante}
                    onChange={handleChange}
                    className="sg-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    {t('qr.dpiOrLicense')}{dpiRequerido ? ' *' : ` (${t('common.optional')})`}
                  </label>
                  <input
                    name="numero_dpi"
                    value={form.numero_dpi}
                    onChange={handleChange}
                    className="sg-input"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                {placaRequerida ? `${t('qr.plate')} *` : t('qr.plateOptional')}
              </label>
              <input
                name="placa"
                value={form.placa}
                onChange={handleChange}
                placeholder="P123ABC"
                className="sg-input"
              />
              <p className="text-xs text-gray-500 mt-1">{t('qr.plateHelp')}</p>
            </div>

            {form.tipo === 'grupal' && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">{t('qr.maxUses')}</label>
                <input
                  name="usos_maximos"
                  type="number"
                  min="1"
                  value={form.usos_maximos}
                  onChange={handleChange}
                  placeholder={t('qr.maxUsesPlaceholder')}
                  className="sg-input"
                />
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">{t('qr.from')} *</label>
                <input
                  name="fecha_inicio"
                  type="date"
                  value={form.fecha_inicio}
                  onChange={handleChange}
                  className="sg-input"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">{t('qr.until')}</label>
                <input
                  name="fecha_fin"
                  type="date"
                  value={form.fecha_fin}
                  onChange={handleChange}
                  className="sg-input"
                />
                <p className="text-xs text-gray-500 mt-1">{t('qr.untilHelp')}</p>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="sg-btn sg-btn-primary flex-1"
              >
                {saving && <Spinner size={14} />}
                {saving ? t('common.saving') : t('qr.generate')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="sg-btn sg-btn-secondary px-4"
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
