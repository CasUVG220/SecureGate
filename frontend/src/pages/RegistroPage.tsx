/**
 * Ruta pública /registro — alta autoservicio de una empresa (paso 1).
 *
 * Pide solo un correo y el nombre de la empresa. NO crea nada: manda un enlace al correo y el asistente (/onboarding/<token>) continúa desde ahí,
 * así que solo quien controla esa bandeja sigue adelante. La respuesta es la misma exista o no una cuenta con ese correo.
 *
 * `sitio_web` es un campo trampa (honeypot): invisible y fuera del orden de tabulación; una persona no lo llena, un robot sí.
 */
import { useState, type FormEvent } from 'react';
import { solicitarAlta } from '../services/api';
import { Button, Card, Input } from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';

const ICON_SHIELD = 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z';
const ICON_MAIL = 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6';
const ICON_BUILDING = 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 13v.01M9 17v.01';

export default function RegistroPage({ onIrALogin }: { onIrALogin: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [terminos, setTerminos] = useState(false);
  const [trampa, setTrampa] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!terminos) { setError(t('reg.needTerms')); return; }
    setEnviando(true);
    try {
      await solicitarAlta({ email: email.trim(), empresa_nombre: empresa.trim(), acepta_terminos: true, sitio_web: trampa });
      setEnviado(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-logo text-logo-ink">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON_SHIELD} /></svg>
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-gray-50">{t('reg.title')}</h1>
          <p className="mt-1 text-sm text-gray-400">{t('reg.subtitle')}</p>
        </div>

        <Card padded>
          {enviado ? (
            <div role="status" className="space-y-3 text-center">
              <h2 className="text-lg font-bold text-gray-50">{t('reg.sent.title')}</h2>
              <p className="text-sm text-gray-300">{t('reg.sent.desc').replace('{email}', email.trim())}</p>
              <p className="text-xs text-gray-400">{t('reg.sent.spam')}</p>
              <Button variant="secondary" onClick={onIrALogin}>{t('reg.haveAccount')}</Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate={false}>
              <Input type="email" label={t('common.email')} icon={ICON_MAIL} required maxLength={254} autoComplete="email" autoFocus value={email} onChange={e => setEmail(e.target.value)} />
              <Input label={t('reg.company')} icon={ICON_BUILDING} required minLength={2} maxLength={150} autoComplete="organization" hint={t('reg.company.hint')} value={empresa} onChange={e => setEmpresa(e.target.value)} />

              {/* Campo trampa: fuera de pantalla, sin foco y oculto a los lectores de pantalla. */}
              <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
                <label>
                  Sitio web
                  <input type="text" name="sitio_web" tabIndex={-1} autoComplete="off" value={trampa} onChange={e => setTrampa(e.target.value)} />
                </label>
              </div>

              <label className="flex items-start gap-2.5 text-sm text-gray-300">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={terminos} onChange={e => setTerminos(e.target.checked)} />
                <span>{t('reg.terms')}</span>
              </label>

              {error && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{error}</p>}

              <Button type="submit" size="lg" fullWidth loading={enviando}>{t('reg.submit')}</Button>
              <p className="text-center text-sm text-gray-400">
                {t('reg.haveAccount.q')}{' '}
                <button type="button" onClick={onIrALogin} className="font-semibold text-brand-400 hover:underline">{t('reg.haveAccount')}</button>
              </p>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
