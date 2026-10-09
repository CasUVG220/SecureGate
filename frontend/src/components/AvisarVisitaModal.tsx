/**
 * «Avisar de una visita»: el ÚNICO formulario para anunciarle a la garita que alguien va a llegar.
 *
 * Antes había dos —uno del administrador (PreautPage) y otro del residente (ResidentePage)— con campos,
 * textos y reglas distintas: el del administrador dejaba «Hasta» como opcional y creaba una fila que el
 * servidor ignoraba para siempre, y el del residente creaba un aviso nuevo en cada clic.
 *
 * Aquí las dos fechas son obligatorias y empiezan en hoy: para una sola visita no hay que tocar nada.
 * Si `residentes` viene, avisa el administrador y elige la casa; si no, avisa el propio residente.
 * (En la base y en la API esto sigue llamándose «preautorización».)
 */
import { useState, type FormEvent } from 'react';
import {
  createMisPreautorizacion, createPreautorizacion,
  type MiPreautorizacion, type Preautorizacion, type Residente,
} from '../services/api';
import { Button, Input, Modal, Select, useToast } from './ui';
import PlacaInput from './PlacaInput';
import { useTranslation } from '../i18n/useTranslation';
import { hoyEnZona } from '../utils/fecha';
import { normalizarPlaca, placaParaInput } from '../utils/placa';

export interface DatosVisita {
  residente_id?: string;
  nombre_visitante?: string;
  numero_dpi?: string | null;
  placa?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Administrador: residentes entre los que elegir la casa. Sin la lista, avisa el propio residente. */
  residentes?: Residente[];
  /** Datos de partida (un visitante guardado o un aviso anterior). */
  inicial?: DatosVisita | null;
  /** El aviso quedó creado. */
  onCreada: (aviso: Preautorizacion | MiPreautorizacion) => void;
}

interface Form {
  residente_id: string;
  nombre_visitante: string;
  numero_dpi: string;
  placa: string;
  fecha_inicio: string;
  fecha_fin: string;
}

const formInicial = (d?: DatosVisita | null): Form => {
  const hoy = hoyEnZona();
  return {
    residente_id: d?.residente_id ?? '',
    nombre_visitante: d?.nombre_visitante ?? '',
    numero_dpi: d?.numero_dpi ?? '',
    placa: d?.placa ? placaParaInput(d.placa) : '',
    fecha_inicio: hoy,
    fecha_fin: hoy,
  };
};

export default function AvisarVisitaModal({ open, onClose, residentes, inicial, onCreada }: Props) {
  const { t } = useTranslation();
  const showToast = useToast();
  const [form, setForm] = useState<Form>(() => formInicial(inicial));
  /** Mientras «Hasta» no se toca, sigue a «Desde»: una sola visita no pide más. */
  const [finPropia, setFinPropia] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cada vez que el diálogo se abre empieza limpio (estado derivado durante el render).
  const [estabaAbierto, setEstabaAbierto] = useState(open);
  if (open !== estabaAbierto) {
    setEstabaAbierto(open);
    if (open) { setForm(formInicial(inicial)); setFinPropia(false); setError(null); setSaving(false); }
  }

  const esAdmin = residentes !== undefined;
  const hoy = hoyEnZona();

  const cambiar = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const cambiarInicio = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inicio = e.target.value;
    setForm(prev => ({
      ...prev,
      fecha_inicio: inicio,
      fecha_fin: !finPropia || (inicio && prev.fecha_fin < inicio) ? inicio : prev.fecha_fin,
    }));
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const placa = normalizarPlaca(form.placa);
    const dpi = form.numero_dpi.trim();
    if (esAdmin && !form.residente_id) { setError(t('aviso.errorResident')); return; }
    if (!form.nombre_visitante.trim() || !form.fecha_inicio || !form.fecha_fin) { setError(t('common.requiredFields')); return; }
    if (!dpi && !placa) { setError(t('aviso.errorIdentity')); return; }
    if (form.fecha_fin < form.fecha_inicio) { setError(t('aviso.errorDates')); return; }

    setSaving(true); setError(null);
    const datos = {
      nombre_visitante: form.nombre_visitante.trim(),
      numero_dpi: dpi || undefined,
      placa: placa || undefined,
      fecha_inicio: form.fecha_inicio,
      fecha_fin: form.fecha_fin,
    };
    try {
      const creada = esAdmin
        ? await createPreautorizacion({ residente_id: form.residente_id, ...datos })
        : await createMisPreautorizacion(datos);
      onCreada(creada);
      showToast(t('aviso.created'));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!saving}
      title={t('aviso.title')}
      description={t('aviso.intro')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="submit" form="form-aviso-visita" loading={saving}>{t('aviso.submit')}</Button>
        </>
      }
    >
      <form id="form-aviso-visita" onSubmit={enviar} className="space-y-4" noValidate>
        {error && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{error}</p>}

        {esAdmin && (
          <Select name="residente_id" label={t('aviso.resident')} required value={form.residente_id} onChange={cambiar}>
            <option value="">{t('aviso.selectResident')}</option>
            {residentes.map(r => (
              <option key={r.id} value={r.id}>{t('aviso.list.house')} {r.numero_casa} — {r.nombre}</option>
            ))}
          </Select>
        )}

        <Input name="nombre_visitante" label={t('aviso.visitor')} required autoFocus={!esAdmin} placeholder="Juan Pérez"
          value={form.nombre_visitante} onChange={cambiar} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input name="numero_dpi" label={t('aviso.dpi')} placeholder="1234567890101" inputMode="numeric"
            value={form.numero_dpi} onChange={cambiar} />
          <div className="min-w-0">
            <label htmlFor="aviso-placa" className="mb-1.5 block text-xs font-semibold text-gray-300">{t('aviso.plate')}</label>
            <PlacaInput id="aviso-placa" name="placa" value={form.placa} onChange={placa => setForm(prev => ({ ...prev, placa }))} />
          </div>
        </div>
        <p className="-mt-2 text-xs text-gray-400">{t('aviso.identityHint')}</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input name="fecha_inicio" type="date" label={t('aviso.from')} required min={hoy}
            value={form.fecha_inicio} onChange={cambiarInicio} />
          <Input name="fecha_fin" type="date" label={t('aviso.until')} required min={form.fecha_inicio || hoy}
            value={form.fecha_fin} onChange={e => { setFinPropia(true); cambiar(e); }} />
        </div>
        <p className="-mt-2 text-xs text-gray-400">{t('aviso.datesHint')}</p>
      </form>
    </Modal>
  );
}
