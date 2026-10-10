import { useMemo } from 'react';
import DosPasosPanel from '../components/DosPasosPanel';
import { decodeTokenPayload } from '../services/api';
import { useTranslation } from '../i18n/useTranslation';

/**
 * «Mi cuenta» de los administradores: sus datos de acceso y la seguridad de la cuenta. Hoy la seguridad es la
 * verificación en dos pasos (SCRUM-123); el cambio de contraseña propio llegará aquí cuando exista en la API.
 */
export default function MiCuentaPage() {
  const { t } = useTranslation();
  const yo = useMemo(() => decodeTokenPayload(localStorage.getItem('token') ?? ''), []);
  const texto = (v: unknown) => (typeof v === 'string' ? v : '');
  const rol = texto(yo?.rol);
  const correo = texto(yo?.email);

  return (
    <div className="sg-page text-gray-100">
      <div>
        <h1 className="text-xl font-bold text-white">{t('account.title')}</h1>
        <p className="mt-0.5 text-sm text-gray-400">{t('account.subtitle')}</p>
      </div>

      <section className="sg-card p-5 sm:p-6" aria-labelledby="cuenta-datos">
        <h2 id="cuenta-datos" className="text-lg font-bold text-white">{t('account.profile')}</h2>
        <dl className="mt-3 grid gap-4 sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-gray-400">{t('common.name')}</dt>
            <dd className="mt-0.5 break-words text-sm text-gray-100">{texto(yo?.nombre) || '—'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-gray-400">{t('common.email')}</dt>
            <dd className="mt-0.5 break-all text-sm text-gray-100">{correo || '—'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-gray-400">{t('agents.role')}</dt>
            <dd className="mt-0.5 text-sm text-gray-100">{rol ? t(`role.${rol}`, rol) : '—'}</dd>
          </div>
        </dl>
      </section>

      <DosPasosPanel correo={correo} />
    </div>
  );
}
