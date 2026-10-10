import './utils/asyncErrors';
// Debe ir antes de './app': carga .env y valida el entorno (aborta si es inseguro).
import './config/arranque';
import app from './app';
import { programarTareas } from './jobs/programacion';
import { runMigrations } from './db/migrate';

const PORT = process.env.PORT || 3000;

// Tareas diarias (mora, recordatorios de reservas, invitaciones vencidas): ver jobs/programacion.ts.
programarTareas();

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
