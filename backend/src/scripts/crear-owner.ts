/**
 * Crea (o restablece) la cuenta `owner` de una instalación nueva.
 *
 * Reemplaza a las cuentas demo que antes sembraba init.sql: en producción no hay
 * ninguna cuenta con contraseña conocida, así que el primer owner se crea así,
 * una sola vez y a mano:
 *
 *   OWNER_EMAIL=ana@empresa.com OWNER_PASSWORD='una-clave-larga-1' \
 *   OWNER_NOMBRE='Ana Pérez' npm run owner:crear
 *
 * La contraseña sólo viaja por variable de entorno (no queda en el historial del
 * shell si la exportas desde un archivo protegido) y pasa la misma política que
 * el resto de cuentas. Si el correo ya existe como owner, se actualiza su clave.
 */
import dotenv from 'dotenv';
import pool from '../db/pool';
import { validarPassword, BCRYPT_COST } from '../utils/password';

dotenv.config();

async function main(): Promise<void> {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  const nombre = process.env.OWNER_NOMBRE?.trim() || 'Owner SecureGate';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Define OWNER_EMAIL con un correo válido.');
  }
  const problema = validarPassword(password, email);
  if (problema) throw new Error(`OWNER_PASSWORD: ${problema}`);

  const r = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
     VALUES ($1, $2, crypt($3, gen_salt('bf', ${BCRYPT_COST})), 'owner', TRUE)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, activo = TRUE, rol = 'owner'
       WHERE usuarios.rol = 'owner'
     RETURNING id, email`,
    [nombre, email, password],
  );
  if (r.rows.length === 0) {
    throw new Error(`El correo ${email} ya pertenece a una cuenta que no es owner; usa otro.`);
  }
  console.log(`Owner listo: ${r.rows[0].email}`);
}

main()
  .catch(err => { console.error(`[owner:crear] ${(err as Error).message}`); process.exitCode = 1; })
  .finally(() => pool.end());
