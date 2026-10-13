import { useEffect, useState, type FormEvent } from 'react';
import { login, logout, tomarBloqueoGuardado, tomarAvisoSesionGuardado, EmpresaBloqueadaError, PortalIncorrectoError, type BloqueoEmpresa, type LoginResult } from '../services/api';
import { Button, Input } from '../components/ui';
import VerificacionDosPasos from '../components/VerificacionDosPasos';
import { useTranslation } from '../i18n/useTranslation';
import { ENLACE_PORTAL, NOMBRE_PORTAL, RUTA_PORTAL, otroPortal, type Portal } from '../routing/portales';
import { formatearFecha } from '../utils/fecha';

interface LoginPageProps {
  onLogin: (token: string, rol: string, usuario: Record<string, unknown>) => void;
  /** Portal desde el que se está entrando; sólo cambia el rótulo y el enlace cruzado. */
  portal?: Portal;
  onCambiarPortal?: (ruta: string) => void;
}

const ICON_SHIELD = 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z';
const ICON_MAIL = 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6';
const ICON_LOCK = 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4';
const ICON_DESKTOP = 'M2 4h20v12H2zM8 20h8M12 16v4';

/**
 * El rol agente trabaja sólo desde la app de escritorio (desktop/). El
 * backend no cambia: sigue autenticándolo porque la app usa el mismo
 * /auth/login. Se decide aquí, con el rol que ya devuelve la respuesta, y se
 * cierra la sesión recién abierta para no dejar la cookie de refresh viva.
 */
const ROL_SOLO_ESCRITORIO = 'agente';
const URL_APP_ESCRITORIO: string =
  (import.meta.env.VITE_DESKTOP_APP_URL as string | undefined)?.trim() || 'https://github.com/CasUVG220/SecureGate/releases';

export default function LoginPage({ onLogin, portal = 'personal', onCambiarPortal }: LoginPageProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /** Portal al que sí pertenece la cuenta, cuando se probó en el equivocado. */
  const [portalSugerido, setPortalSugerido] = useState<Portal | null>(null);
  /** La cuenta es de agente: su terminal es la app de escritorio, no la web. */
  const [soloEscritorio, setSoloEscritorio] = useState(false);
  /** La empresa de la cuenta está suspendida o de baja: nadie de ella entra. */
  const [bloqueo, setBloqueo] = useState<BloqueoEmpresa | null>(null);
  /** Contraseña correcta en una cuenta con verificación en dos pasos: falta el código (SCRUM-123). */
  const [desafio, setDesafio] = useState<string | null>(null);

  // Si la sesión murió por una suspensión (refresh → 423), el aviso llega
  // guardado desde services/api y se muestra al aterrizar aquí. Lo mismo si
  // el servidor la cerró por seguridad porque un token se usó dos veces.
  useEffect(() => {
    const guardado = tomarBloqueoGuardado();
    if (guardado) setBloqueo(guardado);
    if (tomarAvisoSesionGuardado()) setError(t('login.sesionComprometida'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Con la sesión ya abierta (con contraseña sola o tras el segundo paso). */
  const completarSesion = async (result: LoginResult) => {
    if (result.usuario.rol === ROL_SOLO_ESCRITORIO) {
      // Credenciales correctas, pero este no es su punto de entrada. La
      // sesión que el backend acaba de abrir se cierra de inmediato.
      await logout();
      setDesafio(null);
      setSoloEscritorio(true);
      return;
    }
    localStorage.setItem('token', result.token);
    onLogin(result.token, result.usuario.rol, result.usuario);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setPortalSugerido(null);
    setSoloEscritorio(false);
    setBloqueo(null);
    setLoading(true);
    try {
      const result = await login(email, password, portal);
      if ('requiere_2fa' in result) {
        // La contraseña no se queda en pantalla mientras se escribe el código.
        setPassword('');
        setDesafio(result.desafio);
        return;
      }
      await completarSesion(result);
    } catch (err: unknown) {
      if (err instanceof EmpresaBloqueadaError) {
        setBloqueo(err.bloqueo);
      } else if (err instanceof PortalIncorrectoError) {
        // La cuenta existe y la contraseña es correcta, pero es de otro portal:
        // se ofrece el enlace en vez de dejar al usuario adivinando.
        setError(err.message);
        setPortalSugerido(err.portalCorrecto);
      } else {
        setError(err instanceof Error ? err.message : 'Error al iniciar sesión');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="sg-card w-full max-w-md p-6 sm:p-9">
        <div className="mb-8 text-center">
          <span className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-logo text-logo-ink">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={ICON_SHIELD} />
            </svg>
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-gray-50">{t('login.title')}</h1>
          {/* El rótulo del portal deja claro por qué puerta se está entrando:
              las credenciales de un residente no sirven aquí y viceversa. */}
          <p className="mt-2 text-sm font-semibold text-gray-300">{t(NOMBRE_PORTAL[portal])}</p>
          <p className="mt-1 text-xs text-gray-400">{t('login.subtitle')}</p>
        </div>

        {bloqueo && (
          <div role="alert" className="mb-5 rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-400">
            <p className="flex items-start gap-2.5 font-semibold">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden="true">
                <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.93 4.93l14.14 14.14" />
              </svg>
              <span>
                {bloqueo.codigo === 'empresa_inactiva'
                  ? t('login.empresaInactiva').replace('{empresa}', bloqueo.empresa)
                  : t('login.empresaSuspendida').replace('{empresa}', bloqueo.empresa)}
              </span>
            </p>
            {bloqueo.codigo === 'empresa_suspendida' && (
              <dl className="mt-2 space-y-0.5 pl-7 text-xs text-danger-400/90">
                {bloqueo.motivo && <div><dt className="inline font-semibold">{t('login.suspensionMotivo')}: </dt><dd className="inline">{bloqueo.motivo}</dd></div>}
                {bloqueo.desde && <div><dt className="inline font-semibold">{t('login.suspensionDesde')}: </dt><dd className="inline">{formatearFecha(bloqueo.desde)}</dd></div>}
              </dl>
            )}
            <p className="mt-2 pl-7 text-xs text-gray-300">{t('login.suspensionContacto')}</p>
          </div>
        )}

        {soloEscritorio && (
          <div role="alert" className="mb-5 rounded-lg border border-warning-500/30 bg-warning-500/10 px-4 py-3 text-sm text-warning-400">
            <p className="flex items-start gap-2.5 font-medium">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden="true">
                <path d={ICON_DESKTOP} />
              </svg>
              <span>{t('login.desktopOnly')}</span>
            </p>
            <a
              href={URL_APP_ESCRITORIO}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-semibold text-gray-50 underline-offset-4 hover:underline"
            >
              {t('login.desktopDownload')}
            </a>
          </div>
        )}

        {error && (
          <p role="alert" className="mb-5 flex items-center gap-2.5 rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0" aria-hidden="true">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
            </svg>
            {error}
          </p>
        )}

        {portalSugerido && onCambiarPortal && (
          <Button
            variant="secondary"
            fullWidth
            className="mb-5"
            onClick={() => onCambiarPortal(RUTA_PORTAL[portalSugerido])}
          >
            {t(ENLACE_PORTAL[portalSugerido])}
          </Button>
        )}

        {desafio ? (
          <VerificacionDosPasos
            desafio={desafio}
            onVerificado={completarSesion}
            onVencido={mensaje => { setDesafio(null); setError(mensaje); }}
            onBloqueo={b => { setDesafio(null); setBloqueo(b); }}
            onVolver={() => { setDesafio(null); setError(''); }}
          />
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="email"
            label={t('login.email')}
            icon={ICON_MAIL}
            autoComplete="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder={t('login.emailPlaceholder')}
          />

          <Input
            type="password"
            label={t('login.password')}
            icon={ICON_LOCK}
            autoComplete="current-password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
          />

          <Button type="submit" size="lg" fullWidth loading={loading} className="mt-2">
            {loading ? t('login.submitting') : t('login.submit')}
          </Button>
        </form>
        )}

        {/* Quien llegue a la puerta equivocada tiene la otra a un clic, en vez
            de tener que conocer la dirección de memoria. Se oculta si el intento
            de acceso ya ofreció el mismo enlace como botón. */}
        {onCambiarPortal && portal === 'personal' && !portalSugerido && !desafio && (
          <p className="mt-5 text-center text-xs text-gray-400">
            {t('login.registerQ')}{' '}
            <button type="button" onClick={() => onCambiarPortal('/registro')} className="font-semibold text-brand-400 underline-offset-4 hover:underline">
              {t('login.register')}
            </button>
          </p>
        )}
        {onCambiarPortal && !portalSugerido && !desafio && (
          <p className="mt-6 border-t border-gray-700 pt-5 text-center text-xs text-gray-400">
            <button
              type="button"
              onClick={() => onCambiarPortal(RUTA_PORTAL[otroPortal(portal)])}
              className="font-semibold text-gray-200 underline-offset-4 transition-colors hover:text-gray-50 hover:underline"
            >
              {t(ENLACE_PORTAL[otroPortal(portal)])}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
