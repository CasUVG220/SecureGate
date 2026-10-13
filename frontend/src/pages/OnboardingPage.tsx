/**
 * Ruta pública /onboarding/<token> — asistente de alta de una empresa (pasos 2 a 5 del alta autoservicio).
 *
 * El enlace llegó al correo (/registro). Cuatro pasos: empresa, primera sucursal, plan y revisar. Cada «Siguiente» guarda el borrador en el servidor,
 * así que el asistente se puede retomar desde otro equipo con el mismo enlace. Al crear se arma todo junto (empresa, sucursal, plan en prueba) y llega
 * la invitación de administrador al correo; la cuenta nace al aceptarla. El último paso —el código de la primera garita— se hace ya con sesión (Mi plan).
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  completarOnboarding, getOnboarding, guardarBorradorOnboarding, OnboardingError, reenviarInvitacionOnboarding,
  type BorradorOnboarding, type EstadoOnboarding,
} from '../services/api';
import { Badge, Button, Card, ErrorState, Input, Select, Spinner } from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';
import { plural } from '../i18n/plural';
import { TIPOS_SUCURSAL } from '../utils/sucursal';
import { fmtCentavos, pasoInicial } from '../utils/saas';

const ICON_SHIELD = 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z';
const PASOS = ['company', 'branch', 'plan', 'review'] as const;

export default function OnboardingPage({ token, onIrALogin }: { token: string; onIrALogin: () => void }) {
  const { t, language } = useTranslation();
  const [estado, setEstado] = useState<EstadoOnboarding | null>(null);
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState<'vencido' | 'invalido' | null>(null);
  const [paso, setPaso] = useState(0);
  const [b, setB] = useState<BorradorOnboarding>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminado, setTerminado] = useState<string | null>(null);
  const [reenviado, setReenviado] = useState(false);

  const cargar = useCallback(() => {
    setCargando(true);
    getOnboarding(token)
      .then(e => { setEstado(e); setB(e.borrador); setPaso(pasoInicial(e.borrador)); })
      .catch(err => setFallo(err instanceof OnboardingError && err.status === 410 ? 'vencido' : 'invalido'))
      .finally(() => setCargando(false));
  }, [token]);
  useEffect(() => { cargar(); }, [cargar]);

  const set = (campo: keyof BorradorOnboarding) => (e: { target: { value: string } }) => setB(prev => ({ ...prev, [campo]: e.target.value }));

  /** Guarda lo del paso actual y avanza. Los vacíos opcionales se mandan como null para borrarlos. */
  const siguiente = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const envio: BorradorOnboarding =
      paso === 0 ? { empresa_nombre: b.empresa_nombre?.trim(), nit: b.nit?.trim() || null }
      : paso === 1 ? { sucursal_nombre: b.sucursal_nombre?.trim(), direccion: b.direccion?.trim() || null, tipo: b.tipo || null }
      : paso === 2 ? { plan_codigo: b.plan_codigo }
      : {};
    if (paso === 2 && !b.plan_codigo) { setError(t('onb.plan.pick')); return; }
    setGuardando(true);
    try {
      if (paso < 3) {
        setB((await guardarBorradorOnboarding(token, envio)).borrador);
        setPaso(paso + 1);
      } else {
        const r = await completarOnboarding(token);
        setTerminado(r.email);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setGuardando(false);
    }
  };

  const reenviar = async () => {
    setError(null);
    try { await reenviarInvitacionOnboarding(token); setReenviado(true); cargar(); }
    catch (err) { setError(err instanceof Error ? err.message : t('common.error')); }
  };

  const plan = estado?.planes.find(p => p.codigo === b.plan_codigo);
  const yaInvitada = estado?.estado === 'invitada' || terminado !== null;

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <span className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-logo text-logo-ink">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON_SHIELD} /></svg>
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-gray-50">{t('onb.title')}</h1>
          <p className="mt-1 text-xs text-gray-400">SecureGate</p>
        </div>

        <Card padded>
          {cargando ? (
            <div className="flex items-center justify-center gap-3 py-8 text-sm text-gray-400" role="status"><Spinner size={18} /> {t('onb.loading')}</div>
          ) : fallo ? (
            <ErrorState
              variant={fallo === 'vencido' ? 'error' : 'notFound'}
              title={t(fallo === 'vencido' ? 'onb.expired' : 'onb.invalid')}
              description={t('onb.restart')}
              action={<Button variant="secondary" onClick={() => { window.location.assign('/registro'); }}>{t('onb.goRegister')}</Button>}
            />
          ) : yaInvitada ? (
            <div role="status" className="space-y-3 text-center">
              <h2 className="text-lg font-bold text-gray-50">{t('onb.done.title')}</h2>
              <p className="text-sm text-gray-300">{t('onb.done.desc').replace('{email}', terminado ?? estado?.email ?? '')}</p>
              <p className="text-xs text-gray-400">{t('onb.done.next')}</p>
              {estado?.invitacion?.puede_reenviar && !reenviado && <Button variant="secondary" onClick={reenviar}>{t('onb.done.resend')}</Button>}
              {reenviado && <p className="text-sm font-semibold text-success-400">{t('onb.done.resent')}</p>}
              {error && <p role="alert" className="text-sm font-medium text-danger-400">{error}</p>}
              <div><Button variant="ghost" onClick={onIrALogin}>{t('reg.haveAccount')}</Button></div>
            </div>
          ) : (
            <form onSubmit={siguiente} className="space-y-5">
              <ol className="flex items-center gap-2 text-xs font-semibold" aria-label={t('onb.steps')}>
                {PASOS.map((p, i) => (
                  <li key={p} aria-current={i === paso ? 'step' : undefined} className={`flex-1 rounded-full px-2 py-1 text-center ${i === paso ? 'bg-brand-500 text-brand-ink' : i < paso ? 'bg-success-500/15 text-success-400' : 'bg-gray-500/10 text-gray-400'}`}>
                    {i + 1}. {t(`onb.step.${p}`)}
                  </li>
                ))}
              </ol>

              {paso === 0 && (<>
                <Input label={t('onb.company.name')} required minLength={2} maxLength={150} value={b.empresa_nombre ?? ''} onChange={set('empresa_nombre')} autoFocus />
                <Input label={t('onb.company.nit')} maxLength={14} value={b.nit ?? ''} onChange={set('nit')} hint={t('onb.company.nit.hint')} />
              </>)}

              {paso === 1 && (<>
                <Input label={t('onb.branch.name')} required minLength={2} maxLength={150} value={b.sucursal_nombre ?? ''} onChange={set('sucursal_nombre')} autoFocus hint={t('onb.branch.name.hint')} />
                <Input label={t('onb.branch.address')} maxLength={250} value={b.direccion ?? ''} onChange={set('direccion')} />
                <Select label={t('onb.branch.type')} value={b.tipo ?? ''} onChange={set('tipo')}>
                  <option value="">{t('sucursal.tipo.none')}</option>
                  {TIPOS_SUCURSAL.map(tp => <option key={tp} value={tp}>{t(`sucursal.tipo.${tp}`)}</option>)}
                </Select>
              </>)}

              {paso === 2 && (
                <fieldset className="space-y-3">
                  <legend className="mb-1 text-sm font-semibold text-gray-200">{t('onb.plan.legend')}</legend>
                  {estado?.planes.map(p => (
                    <label key={p.codigo} className={`block cursor-pointer rounded-lg border p-4 ${b.plan_codigo === p.codigo ? 'border-brand-500 bg-brand-500/10' : 'border-gray-700 hover:border-gray-500'}`}>
                      <span className="flex items-start gap-3">
                        <input type="radio" name="plan" className="mt-1" value={p.codigo} checked={b.plan_codigo === p.codigo} onChange={() => setB(prev => ({ ...prev, plan_codigo: p.codigo }))} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-bold text-gray-50">{p.nombre}</span>
                            <span className="font-semibold tabular-nums text-gray-100">{fmtCentavos(p.precio_mensual_centavos, language)} <span className="text-xs font-normal text-gray-400">{t('plan.perMonth')}</span></span>
                          </span>
                          <span className="mt-1 block text-sm text-gray-300">
                            {plural(t, 'onb.plan.includes', p.visitas_incluidas, { extra: fmtCentavos(p.precio_visita_extra_centavos, language) })}
                          </span>
                          <span className="mt-0.5 block text-xs text-gray-400">
                            {t('onb.plan.limits').replace('{s}', p.max_sucursales === null ? '∞' : String(p.max_sucursales)).replace('{g}', p.max_garitas === null ? '∞' : String(p.max_garitas))}
                            {p.dias_prueba > 0 && ` · ${t('onb.plan.trial').replace('{n}', String(p.dias_prueba))}`}
                          </span>
                        </span>
                      </span>
                    </label>
                  ))}
                  {estado?.planes.some(p => p.supuesto) && <p className="text-xs text-gray-400">{t('plan.assumed')}</p>}
                </fieldset>
              )}

              {paso === 3 && (
                <div className="space-y-3 text-sm">
                  <h2 className="text-base font-bold text-gray-50">{t('onb.review.title')}</h2>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                    <dt className="text-gray-400">{t('onb.company.name')}</dt><dd className="font-medium text-gray-100">{b.empresa_nombre}</dd>
                    {b.nit && (<><dt className="text-gray-400">{t('onb.company.nit')}</dt><dd className="text-gray-100">{b.nit}</dd></>)}
                    <dt className="text-gray-400">{t('onb.branch.name')}</dt><dd className="font-medium text-gray-100">{b.sucursal_nombre}</dd>
                    {b.direccion && (<><dt className="text-gray-400">{t('onb.branch.address')}</dt><dd className="text-gray-100">{b.direccion}</dd></>)}
                    <dt className="text-gray-400">{t('onb.step.plan')}</dt>
                    <dd className="text-gray-100">{plan ? <>{plan.nombre} <Badge tone="info">{t('onb.plan.trial').replace('{n}', String(plan.dias_prueba))}</Badge></> : b.plan_codigo}</dd>
                    <dt className="text-gray-400">{t('common.email')}</dt><dd className="text-gray-100">{estado?.email}</dd>
                  </dl>
                  <p className="text-xs text-gray-400">{t('onb.review.note')}</p>
                </div>
              )}

              {error && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{error}</p>}

              <div className="flex items-center justify-between gap-3">
                {paso > 0 ? <Button variant="ghost" onClick={() => { setError(null); setPaso(paso - 1); }} disabled={guardando}>{t('common.back')}</Button> : <span />}
                <Button type="submit" loading={guardando}>{paso === 3 ? t('onb.create') : t('onb.next')}</Button>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
