import type { EmpresaStats } from '../../services/api';
import { BarList, ResumenCifras, fmtNumero } from '../../components/charts';
import { useTranslation } from '../../i18n/useTranslation';

/**
 * Cifras de una empresa: los accesos de hoy mandan, desglosados por sucursal
 * (el desglose es lo que permite ver dónde se concentra la operación); el
 * resto se lee como filas. Lo comparten el panel del admin de empresa y el
 * detalle de empresa del owner.
 */
export default function ResumenEmpresa({ stats }: { stats: EmpresaStats }) {
  const { t, language } = useTranslation();
  const n = (x: number) => fmtNumero(x, language);
  const porSucursal = [...stats.sucursales].sort((a, b) => b.accesos_hoy - a.accesos_hoy);

  return (
    <ResumenCifras
      ariaLabel={t('ae.summary')}
      principal={{
        etiqueta: t('dashboard.accessesToday'),
        valor: n(stats.total_accesos_hoy),
        grafico: porSucursal.length ? (
          <div>
            <h3 className="mb-3 text-sm font-medium text-gray-300">{t('ae.byBranch')}</h3>
            <BarList
              items={porSucursal.map(s => ({ id: s.id, etiqueta: s.nombre, valor: s.accesos_hoy }))}
              formato={n}
            />
          </div>
        ) : (
          <p className="text-sm text-gray-400">{t('ae.noData')}</p>
        ),
      }}
      filas={[
        { id: 'sucursales', etiqueta: t('ae.activeBranches'), valor: n(stats.total_sucursales) },
        { id: 'residentes', etiqueta: t('empDetail.residents'), valor: n(stats.total_residentes) },
        {
          id: 'pendientes',
          etiqueta: t('dashboard.pendingPayments'),
          valor: n(stats.total_pagos_pendientes),
          nota: stats.total_pagos_pendientes ? t('ae.pendingHint') : t('dashboard.pendingNone'),
          atencion: stats.total_pagos_pendientes > 0 ? 'warning' : undefined,
        },
      ]}
    />
  );
}
