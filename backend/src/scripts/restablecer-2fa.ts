/**
 * Restablece la verificación en dos pasos de UNA cuenta desde la consola del servidor (SCRUM-123).
 *
 * Es la salida de emergencia para quien perdió el teléfono Y los códigos de recuperación y no tiene a nadie por encima en
 * la aplicación: el owner. (Los demás administradores los restablece su superior desde «Usuarios».) Hay que tener acceso
 * al servidor y a su base de datos, que es justo lo que protege este paso:
 *
 *   CUENTA_EMAIL=ana@empresa.com npm run cuenta:restablecer-2fa
 *
 * Borra el secreto y los códigos de recuperación, cierra las sesiones abiertas de la cuenta y deja una fila en
 * `audit_logs` (TWOFA_RESTABLECIDO, vía consola) para que el restablecimiento no pase sin rastro. La persona entra
 * después sólo con su contraseña y puede volver a activarla.
 */
import dotenv from 'dotenv';
import pool from '../db/pool';

dotenv.config();

async function main(): Promise<void> {
  const email = process.env.CUENTA_EMAIL?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Define CUENTA_EMAIL con el correo de la cuenta.');
  }

  const cuenta = await pool.query<{ id: string; sucursal_id: string | null }>('SELECT id, sucursal_id FROM usuarios WHERE email = $1', [email]);
  if (cuenta.rows.length === 0) throw new Error(`No existe una cuenta con el correo ${email}.`);
  const { id, sucursal_id } = cuenta.rows[0];

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query('DELETE FROM usuario_2fa_recuperacion WHERE usuario_id = $1', [id]);
    const borrada = await cliente.query('DELETE FROM usuario_2fa WHERE usuario_id = $1', [id]);
    if (borrada.rowCount === 0) {
      await cliente.query('ROLLBACK');
      console.log(`${email} no tiene la verificación en dos pasos configurada; no se cambió nada.`);
      return;
    }
    await cliente.query('UPDATE refresh_tokens SET revoked = TRUE WHERE usuario_id = $1 AND revoked = FALSE', [id]);
    await cliente.query(
      `INSERT INTO audit_logs (usuario_id, accion, tabla_afectada, registro_id, sucursal_id, status_code, datos_nuevos)
       VALUES (NULL, 'TWOFA_RESTABLECIDO', 'usuario_2fa', $1, $2, 200, $3::jsonb)`,
      [id, sucursal_id, JSON.stringify({ via: 'consola', sesiones_cerradas: true })],
    );
    await cliente.query('COMMIT');
    console.log(`Verificación en dos pasos restablecida para ${email}. Sus sesiones abiertas se cerraron.`);
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    cliente.release();
  }
}

main()
  .catch(err => { console.error(`[cuenta:restablecer-2fa] ${(err as Error).message}`); process.exitCode = 1; })
  .finally(() => pool.end());
