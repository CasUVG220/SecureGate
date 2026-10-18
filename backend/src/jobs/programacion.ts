import cron, { type ScheduledTask } from 'node-cron';
import { revisarEstadosMora } from './mora.job';
import { enviarRecordatoriosReservas } from './recordatoriosReservas.job';
import { expirarInvitaciones } from './invitaciones.job';
import { APP_TZ } from '../utils/reservas';
import pool from '../db/pool';
import { ejecutarFacturacionMensual, revisarVencimientos } from '../services/facturacion';
import { purgarEvidenciasAnpr } from '../controllers/anpr.controller';

/**
 * Tareas programadas del backend. Viven aquí (y no en index.ts) para poder comprobar con una prueba que las
 * expresiones son válidas para la versión instalada de node-cron — se subió a la 4.x (S-14) y un cambio de
 * sintaxis habría dejado las tareas sin correr sin que nada avisara al arrancar.
 *
 * El contenedor corre en UTC. Las que dependen del reloj del condominio llevan `timezone`: sin él, las 08:00
 * dispararían a las 02:00 de Guatemala.
 */
export interface TareaProgramada {
  nombre: string;
  /** Formato cron de 5 campos: minuto hora día-del-mes mes día-de-la-semana. */
  expresion: string;
  timezone?: string;
  ejecutar: () => Promise<unknown>;
  /** Cómo se escribe en el registro el resultado de una corrida. */
  resumen: (resultado: never) => string;
}

export const TAREAS: TareaProgramada[] = [
  {
    // Revisión diaria del ciclo de mora a las 00:05 (UTC)
    nombre: 'mora.job',
    expresion: '5 0 * * *',
    ejecutar: revisarEstadosMora,
    resumen: (r: Awaited<ReturnType<typeof revisarEstadosMora>>) =>
      `Revisión completada — pendiente: ${r.movidos_a_pendiente}, mora: ${r.movidos_a_mora}`,
  },
  {
    // Recordatorios de las reservas de mañana, a las 08:00 hora local.
    nombre: 'recordatorios.job',
    expresion: '0 8 * * *',
    timezone: APP_TZ,
    ejecutar: enviarRecordatoriosReservas,
    resumen: (r: Awaited<ReturnType<typeof enviarRecordatoriosReservas>>) =>
      `Recordatorios: ${r.recordatorios_enviados}, completadas: ${r.reservas_completadas}`,
  },
  {
    // Invitaciones administrativas vencidas → 'expirada', a diario a las 00:15 hora local.
    nombre: 'invitaciones.job',
    expresion: '15 0 * * *',
    timezone: APP_TZ,
    ejecutar: expirarInvitaciones,
    resumen: (r: Awaited<ReturnType<typeof expirarInvitaciones>>) => `Invitaciones expiradas: ${r.expiradas}`,
  },
  {
    // Facturación SaaS: el día 1 de cada mes a la 01:20 hora local factura el mes que terminó (T11). Idempotente: una factura por empresa y mes.
    nombre: 'facturacion.mensual',
    expresion: '20 1 1 * *',
    timezone: APP_TZ,
    ejecutar: () => ejecutarFacturacionMensual(pool),
    resumen: (r: Awaited<ReturnType<typeof ejecutarFacturacionMensual>>) =>
      `Facturación ${r.periodo} — generadas: ${r.generadas}, ya existían: ${r.existentes}, sin cobro: ${r.sin_cobro}, errores: ${r.errores}, avisos: ${r.avisos.emitidas}`,
  },
  {
    // Facturas SaaS pendientes que ya pasaron su fecha → «vencida», y avisos de pago vencido (pasada la gracia). A diario, 07:30 hora local.
    nombre: 'facturacion.vencidas',
    expresion: '30 7 * * *',
    timezone: APP_TZ,
    ejecutar: () => revisarVencimientos(pool),
    resumen: (r: Awaited<ReturnType<typeof revisarVencimientos>>) =>
      `Facturas vencidas: ${r.vencidas}, avisos de pago vencido: ${r.avisos.vencidas}`,
  },
  {
    // Evidencia del ANPR (recortes de placa y vehículo) con más de 7 días: se borra a diario a las 03:40 hora local (Sprint 10).
    nombre: 'anpr.evidencias',
    expresion: '40 3 * * *',
    timezone: APP_TZ,
    ejecutar: () => purgarEvidenciasAnpr(pool),
    resumen: (r: Awaited<ReturnType<typeof purgarEvidenciasAnpr>>) => `Evidencias del ANPR purgadas: ${r.purgadas}`,
  },
];

/** Arranca todas las tareas. Un fallo de una corrida se registra y no tumba el proceso ni a las demás. */
export const programarTareas = (tareas: TareaProgramada[] = TAREAS): ScheduledTask[] =>
  tareas.map(t =>
    cron.schedule(
      t.expresion,
      () => {
        t.ejecutar()
          .then(r => console.log(`[${t.nombre}] ${t.resumen(r as never)}`))
          .catch(err => console.error(`[${t.nombre}] Error:`, err));
      },
      { ...(t.timezone ? { timezone: t.timezone } : {}), name: t.nombre },
    ),
  );
