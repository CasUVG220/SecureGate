/**
 * Tareas programadas con node-cron 4.x (S-14, SCRUM-129).
 *
 * Se subió de la 3.x (que arrastraba un `uuid` vulnerable) a la 4.x. Si una expresión o una opción dejara de ser válida
 * en la versión nueva, las tareas diarias (mora, recordatorios, invitaciones vencidas) no correrían y nada lo avisaría
 * al arrancar. Aquí se comprueba que cada una se programa, a la hora correcta de su zona, y que una corrida fallida
 * se registra sin tumbar nada.
 */
jest.mock('../jobs/mora.job', () => ({ revisarEstadosMora: jest.fn().mockResolvedValue({ movidos_a_pendiente: 2, movidos_a_mora: 1 }) }));
jest.mock('../jobs/recordatoriosReservas.job', () => ({ enviarRecordatoriosReservas: jest.fn().mockResolvedValue({ recordatorios_enviados: 3, reservas_completadas: 4 }) }));
jest.mock('../jobs/invitaciones.job', () => ({ expirarInvitaciones: jest.fn().mockResolvedValue({ expiradas: 5 }) }));
jest.mock('../db/pool', () => ({ __esModule: true, default: {} }));
jest.mock('../services/facturacion', () => ({
  ejecutarFacturacionMensual: jest.fn().mockResolvedValue({ periodo: '2026-09', generadas: 2, existentes: 1, sin_cobro: 3, errores: 0, total_centavos: 0, avisos: { emitidas: 2, vencidas: 0, sin_destinatarios: 0, errores: 0 } }),
  revisarVencimientos: jest.fn().mockResolvedValue({ vencidas: 4, avisos: { emitidas: 0, vencidas: 1, sin_destinatarios: 0, errores: 0 } }),
}));

import cron from 'node-cron';
import { TAREAS, programarTareas, type TareaProgramada } from '../jobs/programacion';

const activas: Array<{ stop: () => void; destroy: () => void }> = [];
afterEach(() => { activas.splice(0).forEach(t => { t.stop(); t.destroy(); }); jest.restoreAllMocks(); });
const programar = (tareas?: TareaProgramada[]) => { const r = programarTareas(tareas); activas.push(...r); return r; };

describe('tareas programadas', () => {
  it('hay cinco y cada expresión es válida para la versión instalada de node-cron', () => {
    expect(TAREAS.map(t => t.nombre)).toEqual(['mora.job', 'recordatorios.job', 'invitaciones.job', 'facturacion.mensual', 'facturacion.vencidas']);
    for (const t of TAREAS) expect([t.nombre, cron.validate(t.expresion)]).toEqual([t.nombre, true]);
  });

  it('las que llevan zona corren a la hora de Guatemala aunque el contenedor esté en UTC', () => {
    const [, recordatorios, invitaciones, mensual, vencidas] = programar();
    expect(recordatorios.getNextRun()!.getUTCHours()).toBe(14);      // 08:00 Guatemala (UTC-6)
    expect(recordatorios.getNextRun()!.getUTCMinutes()).toBe(0);
    expect(invitaciones.getNextRun()!.getUTCHours()).toBe(6);        // 00:15 Guatemala
    expect(invitaciones.getNextRun()!.getUTCMinutes()).toBe(15);
    // Facturación: día 1 a las 01:20 de Guatemala (= 07:20 UTC) y revisión diaria a las 07:30 de Guatemala (= 13:30 UTC).
    const m = mensual.getNextRun()!;
    expect([m.getUTCDate(), m.getUTCHours(), m.getUTCMinutes()]).toEqual([1, 7, 20]);
    expect([vencidas.getNextRun()!.getUTCHours(), vencidas.getNextRun()!.getUTCMinutes()]).toEqual([13, 30]);
  });

  it('cada corrida registra su resultado con el nombre de la tarea', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const tareas = programar();
    await Promise.all(tareas.map(t => t.execute()));
    await new Promise(r => setImmediate(r));
    const lineas = log.mock.calls.map(c => String(c[0]));
    expect(lineas).toContain('[mora.job] Revisión completada — pendiente: 2, mora: 1');
    expect(lineas).toContain('[recordatorios.job] Recordatorios: 3, completadas: 4');
    expect(lineas).toContain('[invitaciones.job] Invitaciones expiradas: 5');
    expect(lineas).toContain('[facturacion.mensual] Facturación 2026-09 — generadas: 2, ya existían: 1, sin cobro: 3, errores: 0, avisos: 2');
    expect(lineas).toContain('[facturacion.vencidas] Facturas vencidas: 4, avisos de pago vencido: 1');
  });

  it('una corrida que falla se registra y no lanza ni afecta a las demás', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const rota: TareaProgramada = { nombre: 'rota.job', expresion: '* * * * *', ejecutar: () => Promise.reject(new Error('base caída')), resumen: () => '' };
    const [tarea] = programar([rota]);
    await expect(tarea.execute()).resolves.not.toThrow();
    await new Promise(r => setImmediate(r));
    expect(error).toHaveBeenCalledWith('[rota.job] Error:', expect.objectContaining({ message: 'base caída' }));
  });
});
