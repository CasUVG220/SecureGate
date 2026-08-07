import { useState } from 'react';
import AreasComunesPage from './AreasComunesPage';
import ConfiguracionReservasPage from './ConfiguracionReservasPage';
import AdminReservasPage from './AdminReservasPage';
import { useTranslation } from '../i18n/useTranslation';

type Tab = 'areas' | 'config' | 'reservas';

const TABS: { key: Tab; labelKey: string }[] = [
  { key: 'reservas', labelKey: 'reservas.tabReservas' },
  { key: 'areas',    labelKey: 'reservas.tabAreas' },
  { key: 'config',   labelKey: 'reservas.tabConfig' },
];

/**
 * Contenedor de la sección de reservas del administrador. Agrupa las tres
 * pantallas en pestañas para no sumar tres entradas al sidebar.
 */
export default function ReservasAdminPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('reservas');

  return (
    <div className="p-4 sm:p-6 text-gray-100 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold text-white">{t('reservas.adminTitle')}</h1>
        <p className="text-sm text-gray-400 mt-0.5">{t('reservas.adminSubtitle')}</p>
      </div>

      <div className="flex rounded-xl overflow-hidden border border-gray-700 w-fit">
        {TABS.map(tb => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`px-5 py-2.5 text-sm font-semibold transition-colors ${
              tab === tb.key
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {t(tb.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'reservas' && <AdminReservasPage />}
      {tab === 'areas' && <AreasComunesPage />}
      {tab === 'config' && <ConfiguracionReservasPage />}
    </div>
  );
}
