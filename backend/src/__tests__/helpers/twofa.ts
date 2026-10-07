import request from 'supertest';
import type { Express } from 'express';
import { codigoTotp, pasoDe } from '../../utils/twofa';
import { q, uno } from './db';
import { bearer, login, PASSWORD } from './auth';

/**
 * Código TOTP de ahora (`pasos` = intervalos de 30 s hacia adelante o atrás; la app acepta ±1). Usa la misma implementación
 * que el servidor, validada aparte contra los vectores del RFC en `twofa.test.ts`.
 */
export const totp = (secreto: string, pasos = 0): string => codigoTotp(secreto, pasoDe() + pasos);

/**
 * Un código TOTP ya usado no vale otra vez (anti-reutilización). Las pruebas que encadenan varias operaciones con el
 * mismo código del paso actual olvidan el último paso aceptado para poder pedir otro.
 */
export const liberarPaso = (usuarioId: string): Promise<unknown> =>
  q('UPDATE usuario_2fa SET ultimo_paso = NULL WHERE usuario_id = $1', [usuarioId]);

export interface AdminDePrueba { id: string; email: string; token: string }

/** Un administrador nuevo (propio de la prueba, para no tocar el segundo factor de los usuarios sembrados) con sesión abierta. */
export const adminNuevo = async (
  app: Express, rol: 'admin_sucursal' | 'admin_empresa', sucursalId: string | null, empresaId: string | null, sufijo: string,
): Promise<AdminDePrueba> => {
  const email = `dp.${sufijo}.${Math.random().toString(36).slice(2, 8)}@inttest.local`;
  const fila = await uno<{ id: string }>(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id, empresa_id, activo)
     VALUES ('INT dos pasos', $1, crypt($2, gen_salt('bf', 4)), $3, $4, $5, TRUE) RETURNING id`,
    [email, PASSWORD, rol, sucursalId, empresaId]);
  const s = await login(app, email);
  if (s.status !== 200) throw new Error(`no se pudo abrir sesión de ${email}: ${s.status} ${JSON.stringify(s.body)}`);
  return { id: fila!.id, email, token: s.token! };
};

export interface DosPasosActivos { secreto: string; codigos: string[] }

/** Recorre el flujo real (iniciar → confirmar) y deja el segundo factor activo. */
export const activarDosPasos = async (app: Express, a: AdminDePrueba): Promise<DosPasosActivos> => {
  const ini = await request(app).post('/api/auth/2fa/iniciar').set(bearer(a.token)).send({});
  if (ini.status !== 200) throw new Error(`iniciar: ${ini.status} ${JSON.stringify(ini.body)}`);
  const conf = await request(app).post('/api/auth/2fa/confirmar').set(bearer(a.token)).send({ password: PASSWORD, codigo: totp(ini.body.secreto) });
  if (conf.status !== 200) throw new Error(`confirmar: ${conf.status} ${JSON.stringify(conf.body)}`);
  await liberarPaso(a.id);
  return { secreto: ini.body.secreto, codigos: conf.body.codigos_recuperacion };
};
