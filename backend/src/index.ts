import './utils/asyncErrors';
// Debe ir antes de './app': carga .env y valida el entorno (aborta si es inseguro).
import './config/arranque';
import cron from 'node-cron';
import app from './app';
import { revisarEstadosMora } from './jobs/mora.job';
import { enviarRecordatoriosReservas } from './jobs/recordatoriosReservas.job';
import { expirarInvitaciones } from './jobs/invitaciones.job';
import { runMigrations } from './db/migrate';
import { APP_TZ } from './utils/reservas';

const PORT = process.env.PORT || 3000;

// Revisión diaria del ciclo de mora a las 00:05
cron.schedule('5 0 * * *', () => {
  revisarEstadosMora()
    .then(r => console.log(
      `[mora.job] Revisión completada — pendiente: ${r.movidos_a_pendiente}, mora: ${r.movidos_a_mora}`
    ))
    .catch(err => console.error('[mora.job] Error en revisión de mora:', err));
});

// Recordatorios de las reservas de mañana, a las 08:00 hora local.
// El `timezone` es imprescindible: el contenedor corre en UTC, así que sin él
// esto dispararía a las 02:00 de Guatemala.
cron.schedule('0 8 * * *', () => {
  enviarRecordatoriosReservas()
    .then(r => console.log(
      `[recordatorios.job] Recordatorios: ${r.recordatorios_enviados}, completadas: ${r.reservas_completadas}`
    ))
    .catch(err => console.error('[recordatorios.job] Error en recordatorios de reservas:', err));
}, { timezone: APP_TZ });

// Invitaciones administrativas vencidas → 'expirada', a diario a las 00:15.
cron.schedule('15 0 * * *', () => {
  expirarInvitaciones()
    .then(r => console.log(`[invitaciones.job] Invitaciones expiradas: ${r.expiradas}`))
    .catch(err => console.error('[invitaciones.job] Error al expirar invitaciones:', err));
}, { timezone: APP_TZ });

// Guarda de migraciones: pone el esquema al día antes de aceptar tráfico.
// (runMigrations documenta que no lanza, pero si la base está caída al arrancar
// `pool.connect()` sí rechaza: sin este catch era una unhandledRejection.)
runMigrations()
  .catch(err => console.error('[migrate] No se pudo conectar para migrar; el backend arranca igual:', (err as Error).message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`SecureGate Backend corriendo en puerto ${PORT}`);
    });
  });
