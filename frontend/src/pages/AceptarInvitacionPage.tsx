/**
 * Ruta pública /invitacion/:token — la abre quien recibió el correo. Muestra a
 * qué lo invitaron (rol, empresa/sucursal), pide nombre y contraseña, y al
 * aceptar entra en sesión directo con el JWT que devuelve el backend.
 */
import { useEffect, useState, type FormEvent } from 'react';
import {
  aceptarInvitacion, getInvitacionPublica, InvitacionError,
  type InvitacionPublica, type LoginResult,
} from '../services/api';
import { Button, Card, ErrorState, Input, Spinner } from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';

interface Props {
  token: string;
  onAceptada: (resultado: LoginResult) => void;
  onIrALogin: () => void;
}

const ICON_SHIELD = 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z';
const ICON_USER = 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z';
const ICON_LOCK = 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4';

type Fallo = { tipo: 'expirada' | 'usada' | 'invalida'; detalle?: string };

const clasificar = (err: unknown): Fallo => {
  if (err instanceof InvitacionError) {
    if (err.status === 410) return { tipo: 'expirada' };
    if (err.status === 409) return { tipo: 'usada', detalle: err.message };
  }
  return { tipo: 'invalida', detalle: err instanceof Error ? err.message : undefined };
};

export default function AceptarInvitacionPage({ token, onAceptada, onIrALogin }: Props) {
  const { t, language } = useTranslation();
  const [invitacion, setInvitacion] = useState<InvitacionPublica | null>(null);
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState<Fallo | null>(null);

  const [nombre, setNombre] = useState('');
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    getInvitacionPublica(token)
      .then(inv => { if (vivo) setInvitacion(inv); })
      .catch(err => { if (vivo) setFallo(clasificar(err)); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      onAceptada(await aceptarInvitacion(token, { nombre: nombre.trim(), password }));
    } catch (err) {
      const f = clasificar(err);
      // Si entre cargar y enviar la invitación caducó o fue revocada, se
      // reemplaza el formulario por el estado terminal.
      if (f.tipo !== 'invalida' || err instanceof InvitacionError && err.status === 404) setFallo(f);
      else setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setEnviando(false);
    }
  };

  const alcance = invitacion
    ? invitacion.rol_invitado === 'admin_sucursal'
      ? `${invitacion.sucursal_nombre ?? ''} · ${invitacion.empresa_nombre ?? ''}`
      : invitacion.empresa_nombre ?? ''
    : '';

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-logo text-logo-ink">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={ICON_SHIELD} />
            </svg>
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-gray-50">{t('inv.accept.title')}</h1>
          <p className="mt-1 text-xs text-gray-400">SecureGate</p>
        </div>

        <Card padded>
          {cargando ? (
            <div className="flex items-center justify-center gap-3 py-8 text-sm text-gray-400" role="status">
              <Spinner size={18} /> {t('inv.accept.loading')}
            </div>
          ) : fallo ? (
            <ErrorState
              variant={fallo.tipo === 'expirada' ? 'error' : 'notFound'}
              title={t(fallo.tipo === 'expirada' ? 'inv.accept.expired' : fallo.tipo === 'usada' ? 'inv.accept.used' : 'inv.accept.invalid')}
              detail={fallo.detalle}
              action={<Button variant="secondary" onClick={onIrALogin}>{t('inv.accept.goLogin')}</Button>}
            />
          ) : invitacion && (
            <form onSubmit={submit} className="space-y-4">
              <div className="rounded-lg border border-gray-700 bg-gray-500/[0.06] px-4 py-3 text-sm">
                <p className="text-gray-400">{t('inv.accept.invitedAs')}</p>
                <p className="mt-0.5 font-semibold text-gray-50">
                  <span>{invitacion.rol_nombre}</span>{' '}
                  <span className="font-normal text-gray-400">{t('inv.accept.of')}</span>{' '}
                  <span>{alcance}</span>
                </p>
                {invitacion.crea_empresa && (
                  <p className="mt-1 text-xs text-gray-400">{t('inv.accept.willCreate')} <strong className="text-gray-200">{invitacion.empresa_nombre}</strong>.</p>
                )}
                <p className="mt-2 text-xs text-gray-400">
                  {t('inv.accept.expiresOn')} {new Date(invitacion.expira_en).toLocaleString(language === 'en' ? 'en-US' : 'es-GT', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              </div>

              <Input type="email" label={t('common.email')} value={invitacion.email} readOnly disabled />
              <Input
                label={t('inv.accept.name')}
                icon={ICON_USER}
                required
                minLength={2}
                maxLength={100}
                autoFocus
                autoComplete="name"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
              />
              <Input
                type="password"
                label={t('inv.accept.password')}
                icon={ICON_LOCK}
                required
                minLength={8}
                maxLength={100}
                autoComplete="new-password"
                hint={t('inv.accept.passwordHint')}
                value={password}
                onChange={e => setPassword(e.target.value)}
              />

              {error && (
                <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{error}</p>
              )}

              <Button type="submit" size="lg" fullWidth loading={enviando} className="mt-2">
                {enviando ? t('inv.accept.submitting') : t('inv.accept.submit')}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
