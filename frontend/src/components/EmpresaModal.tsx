/**
 * Alta y edición de una empresa. Es el ÚNICO formulario para crear empresas:
 * antes el panel del owner y la lista de empresas tenían cada uno el suyo, con
 * textos y validaciones que se iban separando.
 *
 * Al crear no se cierra de golpe: una empresa sin administrador no sirve de
 * nada, así que el diálogo pasa a un segundo paso que ofrece «Invitar
 * administrador» (o dejarlo para después, que la lista de empresas lo recuerda).
 */
import { useState, type FormEvent } from 'react';
import { createEmpresa, updateEmpresa, type Empresa, type EmpresaInput } from '../services/api';
import { Button, Input, Modal, useToast } from './ui';
import { useTranslation } from '../i18n/useTranslation';
import { rellenar } from './charts/format';

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

const VACIA: EmpresaInput = { nombre: '', nit: '', logo_url: '' };

const desde = (e?: Empresa | null): EmpresaInput =>
  e ? { nombre: e.nombre, nit: e.nit ?? '', logo_url: e.logo_url ?? '' } : VACIA;

export default function EmpresaModal({ open, onClose, empresa, onSaved, onInvitar }: Props) {
  const { t } = useTranslation();
  const showToast = useToast();
  const [form, setForm] = useState<EmpresaInput>(() => desde(empresa));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Empresa recién creada: el diálogo muestra el paso siguiente. */
  const [creada, setCreada] = useState<Empresa | null>(null);

  // Cada vez que el diálogo se abre empieza con los datos de la empresa (o vacío).
  const [estabaAbierto, setEstabaAbierto] = useState(open);
  if (open !== estabaAbierto) {
    setEstabaAbierto(open);
    if (open) { setForm(desde(empresa)); setError(null); setCreada(null); setSaving(false); }
  }

  const editando = !!empresa;
  const cambiar = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.nombre.trim()) { setError(t('empresas.nameRequired')); return; }
    setSaving(true); setError(null);
    const datos = { nombre: form.nombre.trim(), nit: form.nit?.trim() || undefined, logo_url: form.logo_url?.trim() || undefined };
    try {
      if (empresa) {
        const guardada = await updateEmpresa(empresa.id, datos);
        onSaved(guardada, false);
        showToast(t('owner.companyUpdated'));
        onClose();
      } else {
        const nueva = await createEmpresa(datos);
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
          <Button type="submit" form="form-empresa" loading={saving}>{editando ? t('common.save') : t('empresas.create')}</Button>
        </>
      }
    >
      <form id="form-empresa" onSubmit={guardar} className="space-y-4" noValidate>
        {error && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{error}</p>}
        <Input name="nombre" label={t('common.name')} required autoFocus value={form.nombre} onChange={cambiar} />
        <Input name="nit" label={t('owner.nit')} value={form.nit ?? ''} onChange={cambiar} />
        <Input name="logo_url" type="url" label={t('owner.logoUrl')} value={form.logo_url ?? ''} onChange={cambiar} placeholder="https://" />
      </form>
    </Modal>
  );
}
