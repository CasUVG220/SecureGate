/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * El job corre desatendido todos los días y escribe notificaciones que el
 * residente ve. Dos riesgos concretos:
 *
 *   1. Duplicar avisos. Marcar la reserva como avisada e insertar el anuncio
 *      tienen que ser una sola sentencia (CTE modificadora); si fueran dos,
 *      dos réplicas del backend notificarían dos veces la misma reserva.
 *   2. Notificar el día equivocado. Las columnas guardan hora local pero NOW()
 *      en el contenedor es UTC: sin AT TIME ZONE, "mañana" se corre un día
 *      durante seis horas de cada jornada.
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import { enviarRecordatoriosReservas } from '../jobs/recordatoriosReservas.job';

const mockPool = pool as unknown as { connect: jest.Mock };

function makeClient(recordatorios = 0, completadas = 0, fallar = false) {
  const query = jest.fn((sql: string) => {
    if (fallar && sql.includes('WITH pendientes')) {
      return Promise.reject(new Error('fallo de base de datos'));
    }
    if (sql.includes('WITH pendientes')) {
      return Promise.resolve({ rows: [], rowCount: recordatorios });
    }
    if (sql.includes("SET estado = 'completada'")) {
      return Promise.resolve({ rows: [], rowCount: completadas });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return { query, release: jest.fn() };
}

const sqlsDe = (c: { query: jest.Mock }) => c.query.mock.calls.map(x => x[0] as string);
const sqlRecordatorio = (c: { query: jest.Mock }) =>
  sqlsDe(c).find(s => s.includes('WITH pendientes'))!;

describe('enviarRecordatoriosReservas', () => {
  it('sólo avisa de reservas confirmadas cuya fecha es mañana', async () => {
    const client = makeClient(3);
    mockPool.connect.mockResolvedValue(client);

    const resumen = await enviarRecordatoriosReservas();

    const sql = sqlRecordatorio(client);
    expect(sql).toContain("r.estado = 'confirmada'");
    expect(sql).toContain('::date + 1');
    expect(resumen.recordatorios_enviados).toBe(3);
  });

  it('calcula "mañana" en hora local y no contra NOW() en UTC', async () => {
    const client = makeClient();
    mockPool.connect.mockResolvedValue(client);

    await enviarRecordatoriosReservas();

    expect(sqlRecordatorio(client)).toContain('AT TIME ZONE');
  });

  it('es idempotente: filtra por recordatorio_enviado y lo marca en la MISMA sentencia', async () => {
    const client = makeClient(2);
    mockPool.connect.mockResolvedValue(client);

    await enviarRecordatoriosReservas();

    const sql = sqlRecordatorio(client);
    expect(sql).toContain('r.recordatorio_enviado = FALSE');
    expect(sql).toContain('SET recordatorio_enviado = TRUE');
    // Una sola sentencia: la CTE modificadora hace atómicos marcar + notificar
    expect(sql.indexOf('WITH pendientes')).toBeLessThan(sql.indexOf('INSERT INTO anuncios'));
  });

  it('inserta anuncios personales (residente_id) sin usuario actuante', async () => {
    const client = makeClient(1);
    mockPool.connect.mockResolvedValue(client);

    await enviarRecordatoriosReservas();

    const sql = sqlRecordatorio(client);
    expect(sql).toContain('INSERT INTO anuncios');
    expect(sql).toContain('p.residente_id');
    expect(sql).toContain('Recordatorio: tienes reservado');
    // creado_por va NULL: el cron no tiene usuario que lo origine
    expect(sql).toMatch(/'importante',\s*NOW\(\),\s*\(p\.fecha \+ p\.hora_fin\),\s*NULL/);
  });

  it('no avisa de reservas en otros estados', async () => {
    const client = makeClient();
    mockPool.connect.mockResolvedValue(client);

    await enviarRecordatoriosReservas();

    const sql = sqlRecordatorio(client);
    expect(sql).not.toContain("'pendiente_aprobacion'");
    expect(sql).not.toContain("'cancelada'");
  });

  it('cierra como completadas las reservas confirmadas que ya terminaron', async () => {
    const client = makeClient(0, 5);
    mockPool.connect.mockResolvedValue(client);

    const resumen = await enviarRecordatoriosReservas();

    const sql = sqlsDe(client).find(s => s.includes("SET estado = 'completada'"))!;
    expect(sql).toContain("estado = 'confirmada'");
    expect(sql).toContain('(fecha + hora_fin) <');
    expect(sql).toContain('AT TIME ZONE');
    expect(resumen.reservas_completadas).toBe(5);
  });

  it('hace ROLLBACK, propaga el error y libera el cliente si algo falla', async () => {
    const client = makeClient(0, 0, true);
    mockPool.connect.mockResolvedValue(client);

    await expect(enviarRecordatoriosReservas()).rejects.toThrow('fallo de base de datos');

    const sqls = sqlsDe(client);
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });
});
