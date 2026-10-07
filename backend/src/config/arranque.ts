import dotenv from 'dotenv';
import { validarEntorno } from './env';

dotenv.config();

// Falla rápido y en voz alta si el entorno no es seguro (secreto JWT público o
// ausente en producción, CORS sin allowlist…). Ver config/env.ts.
try {
  validarEntorno();
} catch (err) {
  console.error(`[env] ${(err as Error).message}`);
  process.exit(1);
}
