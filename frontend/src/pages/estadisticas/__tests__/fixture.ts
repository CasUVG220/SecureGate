import type { Estadisticas } from '../../../services/api';

/** Respuesta de /reportes/estadisticas para 7 días, con valores fáciles de verificar. */
export function estadisticasFixture(over: Partial<Estadisticas> = {}): Estadisticas {
  const franja = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  franja[5][18] = 9; // sábado 18:00
  franja[0][8] = 2;
  return {
    periodo: { desde: '2026-09-18', hasta: '2026-09-24', dias: 7, anterior: { desde: '2026-09-11', hasta: '2026-09-17' } },
    accesos: {
      total: 125, total_anterior: 100, visitantes_unicos: 80, con_vehiculo: 40, sin_salida: 0, no_autorizados: 0,
      duracion_mediana_min: 42,
      por_dia: ['18', '19', '20', '21', '22', '23', '24'].map((d, i) => ({ fecha: `2026-09-${d}`, total: [10, 20, 15, 30, 20, 15, 15][i] })),
      por_dia_anterior: [10, 15, 15, 20, 15, 10, 15],
      por_franja: franja,
      top_casas: [{ numero_casa: 'A-12', total: 30 }, { numero_casa: 'B-03', total: 12 }],
    },
    pagos: {
      recaudado: 2400, recaudado_anterior: 3000,
      por_estado: { aprobado: { cantidad: 6, monto: 2400 }, pendiente: { cantidad: 2, monto: 750 }, rechazado: { cantidad: 0, monto: 0 } },
      por_metodo: [{ metodo: 'transferencia', cantidad: 4, monto: 1800 }, { metodo: 'efectivo', cantidad: 2, monto: 600 }],
      por_dia: ['18', '19', '20', '21', '22', '23', '24'].map((d, i) => ({ fecha: `2026-09-${d}`, monto: i === 2 ? 2400 : 0 })),
      por_dia_anterior: [0, 0, 3000, 0, 0, 0, 0],
    },
    cartera: { residentes: 20, al_dia: 15, pendiente: 2, mora: 3, saldo_pendiente: 1350 },
    solicitudes: { total: 5, por_estado: { abierto: 2, en_proceso: 1, cerrado: 2 }, por_tipo: [{ tipo: 'mantenimiento', total: 3 }, { tipo: 'queja', total: 2 }] },
    reservas: {
      total: 4, cargos: 300,
      por_estado: { pendiente_aprobacion: 1, confirmada: 1, completada: 1, cancelada: 1, rechazada: 0 },
      top_areas: [{ area: 'Salón social', total: 2 }, { area: 'Piscina', total: 1 }],
    },
    ...over,
  };
}
