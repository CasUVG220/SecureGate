/**
 * Diálogo «Invitar administrador»: el owner invita al administrador de una
 * empresa y el administrador de empresa al de una sucursal. Es el mismo diálogo
 * para dos entradas:
 *
 *  - el panel de invitaciones (`InvitacionesPanel`), donde se elige a quién invitar;
 *  - el paso siguiente tras crear una empresa o una sucursal, donde el alcance ya
 *    está decidido (`empresaFija` / `sucursalFija`) y solo falta escribir el correo.
 *
 * Nada de esto toca las licencias de la app de garita: eso vincula máquinas por
 * huella de hardware; esto invita personas por correo.
 */
import { useState, type FormEvent } from 'react';
import {
  crearInvitacion,
  type Empresa, type Invitacion, type InvitacionInput, type Sucursal,
} from '../services/api';
import { Button, Input, Modal, Select, useToast } from './ui';
import { useTranslation } from '../i18n/useTranslation';
import { rellenar } from './charts/format';

export type InvitacionesModo = 'owner' | 'admin_empresa';
type EmpresaMode = 'new' | 'existing';

export interface AlcanceFijo { id: string; nombre: string }

interface Props {
  open: boolean;
  onClose: () => void;
  modo: InvitacionesModo;
  /** Owner: empresas existentes a las que se puede sumar un admin. */
  empresas?: Empresa[];
  /** Admin de empresa: sucursales de SU empresa (el backend vuelve a validar). */
  sucursales?: Sucursal[];
  /** Alcance ya decidido (owner): no se elige, solo se muestra. */
  empresaFija?: AlcanceFijo | null;
  /** Alcance ya decidido (admin de empresa): no se elige, solo se muestra. */
  sucursalFija?: AlcanceFijo | null;
  /** Invitación recién reenviada: abre directo en la vista del enlace. */
  resultado?: Invitacion | null;
  /** Se llamó a la API con éxito (el panel refresca su lista). */
  onEnviada?: (inv: Invitacion) => void;
}

export const ICON_MAIL = 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6';

interface Estado {
  email: string;
  empresaMode: EmpresaMode;
  empresaId: string;
  empresaNombre: string;
  sucursalId: string;
  saving: boolean;
  formError: string | null;
  /** Última invitación creada/reenviada: se ofrece el enlace para copiar. */
  ultima: Invitacion | null;
}

const inicial = (resultado?: Invitacion | null): Estado => ({
  email: '', empresaMode: 'new', empresaId: '', empresaNombre: '', sucursalId: '',
  saving: false, formError: null, ultima: resultado ?? null,
});

const ERROR_CLASS = 'rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400';

export default function InvitarAdminModal({
  open, onClose, modo, empresas = [], sucursales = [], empresaFija, sucursalFija, resultado, onEnviada,
}: Props) {
  const { t } = useTranslation();
  const showToast = useToast();
  const [s, setS] = useState<Estado>(() => inicial(resultado));
  const set = (cambios: Partial<Estado>) => setS(prev => ({ ...prev, ...cambios }));

  // Cada vez que el diálogo se abre empieza limpio (estado derivado durante el render).
  const [estabaAbierto, setEstabaAbierto] = useState(open);
  if (open !== estabaAbierto) {
    setEstabaAbierto(open);
    if (open) setS(inicial(resultado));
  }

  const esOwner = modo === 'owner';
  const fija = esOwner ? empresaFija : sucursalFija;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    set({ formError: null });
    const input: InvitacionInput = esOwner
      ? {
          email: s.email, rol_invitado: 'admin_empresa',
          ...(empresaFija ? { empresa_id: empresaFija.id }
            : s.empresaMode === 'existing' ? { empresa_id: s.empresaId } : { empresa_nombre: s.empresaNombre.trim() }),
        }
      : { email: s.email, rol_invitado: 'admin_sucursal', sucursal_id: sucursalFija?.id ?? s.sucursalId };
    if (esOwner && !empresaFija && s.empresaMode === 'existing' && !s.empresaId) { set({ formError: t('inv.selectEmpresa') }); return; }
    if (!esOwner && !sucursalFija && !s.sucursalId) { set({ formError: t('inv.selectSucursal') }); return; }
    set({ saving: true });
    try {
      const inv = await crearInvitacion(input);
      set({ ultima: inv, saving: false });
      showToast(t('inv.sent').replace('{email}', inv.email), 'success');
      onEnviada?.(inv);
    } catch (err) {
      set({ formError: err instanceof Error ? err.message : 'Error', saving: false });
    }
  };

  const copiar = async (enlace: string) => {
    try {
      await navigator.clipboard.writeText(enlace);
      showToast(t('inv.linkCopied'), 'info');
    } catch {
      // Sin permiso de portapapeles el enlace sigue a la vista, seleccionado, para copiarlo a mano.
    }
  };

  const { ultima } = s;

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!s.saving}
      title={t(esOwner ? 'inv.modal.ownerTitle' : 'inv.modal.aeTitle')}
      footer={ultima ? (
        <Button onClick={onClose}>{t('common.close', 'Cerrar')}</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={onClose} disabled={s.saving}>{t('common.cancel')}</Button>
          <Button type="submit" form="form-invitacion" loading={s.saving}>{t('inv.send')}</Button>
        </>
      )}
    >
      {ultima ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-200">{t('inv.sent').replace('{email}', ultima.email)}</p>
          {ultima.enlace && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400">{t('inv.linkHint')}</p>
              <div className="flex gap-2">
                <Input readOnly value={ultima.enlace} className="font-mono text-xs" wrapperClassName="flex-1" aria-label="Enlace" onFocus={e => e.currentTarget.select()} />
                <Button variant="secondary" onClick={() => void copiar(ultima.enlace!)}>{t('inv.copyLink')}</Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <form id="form-invitacion" onSubmit={enviar} className="space-y-4">
          {s.formError && <p role="alert" className={ERROR_CLASS}>{s.formError}</p>}

          {fija && (
            <div className="rounded-lg border border-gray-700 bg-gray-500/[0.06] px-4 py-3">
              <p className="text-sm font-semibold text-gray-100">
                {rellenar(t(esOwner ? 'inv.forCompany' : 'inv.forBranch'), { nombre: fija.nombre })}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">{t(esOwner ? 'inv.fixedHint.company' : 'inv.fixedHint.branch')}</p>
            </div>
          )}

          <Input type="email" label={t('inv.field.email')} icon={ICON_MAIL} required autoFocus value={s.email} onChange={e => set({ email: e.target.value })} placeholder="nombre@empresa.com" />

          {!fija && (esOwner ? (
            <>
              <div className="flex gap-1 rounded-lg bg-gray-500/10 p-1" role="tablist">
                {(['new', 'existing'] as EmpresaMode[]).map(m => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={s.empresaMode === m}
                    onClick={() => set({ empresaMode: m })}
                    className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${s.empresaMode === m ? 'bg-brand-500 text-brand-ink' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    {t(m === 'new' ? 'inv.empresaMode.new' : 'inv.empresaMode.existing')}
                  </button>
                ))}
              </div>
              {s.empresaMode === 'new' ? (
                <Input label={t('inv.field.empresaNueva')} required minLength={2} maxLength={150} value={s.empresaNombre} onChange={e => set({ empresaNombre: e.target.value })} />
              ) : (
                <Select label={t('inv.field.empresa')} required value={s.empresaId} onChange={e => set({ empresaId: e.target.value })}>
                  <option value="">{t('inv.selectEmpresa')}</option>
                  {empresas.filter(e => e.activo).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </Select>
              )}
            </>
          ) : (
            <Select label={t('inv.field.sucursal')} required value={s.sucursalId} onChange={e => set({ sucursalId: e.target.value })}>
              <option value="">{t('inv.selectSucursal')}</option>
              {sucursales.filter(x => x.activo).map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </Select>
          ))}
        </form>
      )}
    </Modal>
  );
}
