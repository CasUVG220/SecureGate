import type { LangKey } from '../../context/LanguageContext';
import type { Estadisticas } from '../../services/api';
import { fmtNumero, fmtPorcentaje, fmtQuetzales, rellenar, variacion } from '../../components/charts/format';

export type TonoHallazgo = 'info' | 'success' | 'warning' | 'danger';

export interface Hallazgo {
  id: string;
  tono: TonoHallazgo;
  texto: string;
}

type T = (key: string, fallback?: string) => string;

export { rellenar };

const hora = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;

/** Celda con más visitas de la matriz día × hora, o null si no hubo ninguna. */
export function franjaPico(matriz: number[][]): { dia: number; hora: number; total: number } | null {
  let mejor: { dia: number; hora: number; total: number } | null = null;
  matriz.forEach((fila, dia) => fila.forEach((total, h) => {
    if (total > 0 && (!mejor || total > mejor.total)) mejor = { dia, hora: h, total };
  }));
  return mejor;
}

/**
 * Lectura del periodo en frases. Es lo que convierte la pantalla en respuesta
 * ("¿cómo vamos?") en vez de un tablero que hay que interpretar: cada frase
 * sale de los mismos números que los gráficos y sólo aparece si dice algo.
 */
export function calcularHallazgos(e: Estadisticas, t: T, lang: LangKey): Hallazgo[] {
  const out: Hallazgo[] = [];
  const n = (x: number) => fmtNumero(x, lang);
  const q = (x: number) => fmtQuetzales(x, lang);
  const pct = (x: number) => fmtPorcentaje(Math.abs(x), lang);

  // Visitas contra el periodo anterior.
  const { total, total_anterior } = e.accesos;
  const vv = variacion(total, total_anterior);
  const varsVisitas = { actual: n(total), anterior: n(total_anterior), pct: vv.pct == null ? '' : pct(vv.pct) };
  if (total === 0) {
    out.push({ id: 'visitas', tono: 'info', texto: t('stats.insight.noVisits') });
  } else if (vv.pct == null) {
    out.push({ id: 'visitas', tono: 'info', texto: rellenar(t('stats.insight.visitsNew'), varsVisitas) });
  } else {
    const clave = vv.dir === 'sube' ? 'visitsUp' : vv.dir === 'baja' ? 'visitsDown' : 'visitsSame';
    out.push({ id: 'visitas', tono: 'info', texto: rellenar(t(`stats.insight.${clave}`), varsVisitas) });
  }

  // Hora pico: el dato más accionable (turnos de garita).
  const pico = franjaPico(e.accesos.por_franja);
  if (pico) {
    const nombre = t('stats.days.long').split(',')[pico.dia] ?? '';
    // En español el día va en minúscula dentro de la frase ("el sábado"); en inglés, no.
    const dia = lang === 'es' ? nombre.toLowerCase() : nombre;
    out.push({
      id: 'pico',
      tono: 'info',
      texto: rellenar(t('stats.insight.peak'), { dia, desde: hora(pico.hora), hasta: hora(pico.hora + 1) }),
    });
  }

  // Recaudación.
  const { recaudado, recaudado_anterior } = e.pagos;
  const vr = variacion(recaudado, recaudado_anterior);
  if (recaudado > 0) {
    const clave = vr.pct == null ? 'collectedNew' : vr.dir === 'sube' ? 'collectedUp' : vr.dir === 'baja' ? 'collectedDown' : 'collectedSame';
    out.push({
      id: 'recaudado',
      tono: vr.dir === 'baja' ? 'warning' : 'success',
      texto: rellenar(t(`stats.insight.${clave}`), { monto: q(recaudado), pct: vr.pct == null ? '' : pct(vr.pct) }),
    });
  } else {
    out.push({ id: 'recaudado', tono: 'warning', texto: t('stats.insight.collectedNone') });
  }

  const pend = e.pagos.por_estado.pendiente;
  if (pend.cantidad > 0) {
    out.push({
      id: 'pendientes',
      tono: 'warning',
      texto: rellenar(t(pend.cantidad === 1 ? 'stats.insight.pendingOne' : 'stats.insight.pending'), { n: n(pend.cantidad), monto: q(pend.monto) }),
    });
  }

  // Cartera (foto de hoy).
  const { residentes, mora, saldo_pendiente } = e.cartera;
  if (residentes > 0) {
    out.push(mora > 0
      ? {
          id: 'mora',
          tono: 'danger',
          texto: rellenar(t(mora === 1 ? 'stats.insight.debtOne' : 'stats.insight.debt'), {
            n: n(mora), pct: fmtPorcentaje(mora / residentes, lang), monto: q(saldo_pendiente),
          }),
        }
      : { id: 'mora', tono: 'success', texto: t('stats.insight.noDebt') });
  }

  const abiertas = e.solicitudes.por_estado.abierto;
  if (abiertas > 0) {
    out.push({
      id: 'solicitudes',
      tono: 'warning',
      texto: rellenar(t(abiertas === 1 ? 'stats.insight.openTicketsOne' : 'stats.insight.openTickets'), { n: n(abiertas) }),
    });
  }

  if (e.accesos.no_autorizados > 0) {
    out.push({
      id: 'no-autorizados',
      tono: 'danger',
      texto: rellenar(t(e.accesos.no_autorizados === 1 ? 'stats.insight.unauthorizedOne' : 'stats.insight.unauthorized'), { n: n(e.accesos.no_autorizados) }),
    });
  }

  if (e.accesos.sin_salida > 0) {
    out.push({
      id: 'sin-salida',
      tono: 'info',
      texto: rellenar(t(e.accesos.sin_salida === 1 ? 'stats.insight.openExitsOne' : 'stats.insight.openExits'), { n: n(e.accesos.sin_salida) }),
    });
  }

  return out;
}
