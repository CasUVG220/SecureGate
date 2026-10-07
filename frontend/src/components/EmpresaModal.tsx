/**
 * Alta y edición de una empresa. Es el ÚNICO formulario para crear empresas:
 * antes el panel del owner y la lista de empresas tenían cada uno el suyo, con
 * textos y validaciones que se iban separando.
 *
 * Al crear no se cierra de golpe: una empresa sin administrador no sirve de
 * nada, así que el diálogo pasa a un segundo paso que ofrece «Invitar
 * administrador» (o dejarlo para después, que la lista de empresas lo recuerda).
 */
import { useRef, useState, type FormEvent } from 'react';
import { createEmpresa, updateEmpresa, type Empresa, type EmpresaInput } from '../services/api';
import { Button, Input, Modal, useToast } from './ui';
import { useTranslation } from '../i18n/useTranslation';
import { rellenar } from './charts/format';
import { archivoALogo, ImagenError } from '../utils/imagen';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Empresa a editar; sin ella el diálogo crea una nueva. */
  empresa?: Empresa | null;
  /** Se guardó (creada o editada): la página refresca su lista. */
  onSaved: (empresa: Empresa, nueva: boolean) => void;
  /** «Invitar administrador» tras crear. Sin esta función el paso siguiente no se ofrece. */
  onInvitar?: (empresa: Empresa) => void;
}

/** El logo no es un campo de texto: se sube como archivo y se guarda aparte del resto del formulario. */
type DatosEmpresa = Pick<EmpresaInput, 'nombre' | 'nit'>;

const VACIA: DatosEmpresa = { nombre: '', nit: '' };

const desde = (e?: Empresa | null): DatosEmpresa => (e ? { nombre: e.nombre, nit: e.nit ?? '' } : VACIA);

export default function EmpresaModal({ open, onClose, empresa, onSaved, onInvitar }: Props) {
  const { t } = useTranslation();
  const showToast = useToast();
  const [form, setForm] = useState<DatosEmpresa>(() => desde(empresa));
  /** Logo actual: data URI (archivo subido), URL (las anteriores) o vacío. */
  const [logo, setLogo] = useState(() => empresa?.logo_url ?? '');
  const [logoError, setLogoError] = useState<string | null>(null);
  const [leyendoLogo, setLeyendoLogo] = useState(false);
  const inputLogo = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Empresa recién creada: el diálogo muestra el paso siguiente. */
  const [creada, setCreada] = useState<Empresa | null>(null);

  // Cada vez que el diálogo se abre empieza con los datos de la empresa (o vacío).
  const [estabaAbierto, setEstabaAbierto] = useState(open);
  if (open !== estabaAbierto) {
    setEstabaAbierto(open);
    if (open) { setForm(desde(empresa)); setLogo(empresa?.logo_url ?? ''); setLogoError(null); setError(null); setCreada(null); setSaving(false); }
  }

  const editando = !!empresa;
  const cambiar = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const elegirLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';                       // permite volver a elegir el mismo archivo
    if (!archivo) return;
    setLeyendoLogo(true); setLogoError(null);
    try {
      setLogo(await archivoALogo(archivo));
    } catch (err) {
      setLogoError(err instanceof ImagenError ? err.message : t('empresas.logoError'));
    } finally {
      setLeyendoLogo(false);
    }
  };

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.nombre.trim()) { setError(t('empresas.nameRequired')); return; }
    setSaving(true); setError(null);
    const datos = { nombre: form.nombre.trim(), nit: form.nit?.trim() || undefined };
    try {
      if (empresa) {
        // El logo solo viaja si cambió ('' lo quita); así editar el nombre no vuelve a mandar la imagen entera.
        const logoCambio = (empresa.logo_url ?? '') !== logo;
        const guardada = await updateEmpresa(empresa.id, logoCambio ? { ...datos, logo_url: logo } : datos);
        onSaved(guardada, false);
        showToast(t('owner.companyUpdated'));
        onClose();
      } else {
        const nueva = await createEmpresa({ ...datos, logo_url: logo || undefined });
        onSaved(nueva, true);
        if (onInvitar) setCreada(nueva);
        else { showToast(t('owner.companyCreated')); onClose(); }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('empresas.saveError'));
    } finally {
      setSaving(false);
    }
  };

  if (creada) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={t('empresa.ready.title')}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>{t('empresa.ready.later')}</Button>
            <Button onClick={() => { onInvitar?.(creada); onClose(); }}>{t('empresa.ready.invite')}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-200">{rellenar(t('empresa.ready.body'), { nombre: creada.nombre })}</p>
          <p className="text-xs text-gray-400">{t('empresa.ready.laterHint')}</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!saving}
      title={editando ? t('empresas.editTitle') : t('empresas.createTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="submit" form="form-empresa" loading={saving} disabled={leyendoLogo}>{editando ? t('common.save') : t('empresas.create')}</Button>
        </>
      }
    >
      <form id="form-empresa" onSubmit={guardar} className="space-y-4" noValidate>
        {error && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{error}</p>}
        <Input name="nombre" label={t('common.name')} required autoFocus value={form.nombre} onChange={cambiar} />
        <Input name="nit" label={t('owner.nit')} value={form.nit ?? ''} onChange={cambiar} />

        <div>
          <span id="logo-etiqueta" className="mb-1.5 block text-xs font-semibold text-gray-300">{t('empresas.logo')}</span>
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-600 bg-white">
              {logo
                ? <img src={logo} alt={t('empresas.logoPreview')} className="max-h-full max-w-full object-contain" />
                : <span aria-hidden="true" className="text-xs text-gray-400">—</span>}
            </div>
            <div className="min-w-0 space-y-1.5">
              <input
                ref={inputLogo}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-labelledby="logo-etiqueta"
                data-testid="logo-archivo"
                className="sr-only"
                tabIndex={-1}
                onChange={e => void elegirLogo(e)}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" loading={leyendoLogo} onClick={() => inputLogo.current?.click()}>
                  {logo ? t('empresas.logoChange') : t('empresas.logoChoose')}
                </Button>
                {logo && <Button size="sm" variant="ghost" onClick={() => { setLogo(''); setLogoError(null); }}>{t('empresas.logoRemove')}</Button>}
              </div>
              <p className="text-xs text-gray-400">{t('empresas.logoHint')}</p>
            </div>
          </div>
          {logoError && <p role="alert" className="mt-2 text-xs font-medium text-danger-400">{logoError}</p>}
        </div>
      </form>
    </Modal>
  );
}
