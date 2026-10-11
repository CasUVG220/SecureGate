/**
 * Siembra para las pruebas de integración/regresión (portada de
 * backend/securitytest/seed.js, directo por SQL contra el Postgres de prueba).
 *
 * Cada llamada crea datos NUEVOS con un sufijo aleatorio: dos archivos de test
 * (o dos pruebas) nunca comparten filas ni correos, así no se interfieren. La
 * base se vacía por completo en el globalSetup de cada ejecución.
 *
 * Las contraseñas se guardan con crypt(..., gen_salt('bf', 4)): el login de la app
 * compara con crypt(), que respeta el costo del hash guardado, y el costo 4 hace
 * el seed rápido (producción usa 12).
 */
import { randomBytes, createHash } from 'crypto';
import { q, uno } from './db';
import { PASSWORD } from './auth';

export type Rol = 'owner' | 'admin_empresa' | 'admin_sucursal' | 'agente' | 'residente';

export interface Fixtures {
  sufijo: string;
  empresas: { A: string; B: string };
  sucursales: { A1: string; A2: string; B1: string };
  email: Record<string, string>;
  usuarios: Record<string, string>;      // clave → usuarios.id
  residentes: { A1: string; A2: string; B1: string };
  anuncios: { A1: string; A2: string; B1: string };
  areas: { A1: string; A2: string; B1: string };
  /** Licencias sin activar: código de activación y huella (fingerprint) a usar. */
  licencias: Record<'A1' | 'B1', { id: string; codigo: string; fingerprint: string }>;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const sembrar = async (): Promise<Fixtures> => {
  const s = randomBytes(5).toString('hex');
  const mail = (k: string) => `${k}.${s}@inttest.local`.toLowerCase(); // el login normaliza a minúsculas

  const empresa = async (n: string) =>
    (await uno<{ id: string }>('INSERT INTO empresas (nombre, nit) VALUES ($1, $2) RETURNING id', [`INT Empresa ${n} ${s}`, `NIT-${n}-${s}`]))!.id;
  const sucursal = async (e: string, n: string) =>
    (await uno<{ id: string }>(
      `INSERT INTO sucursales (empresa_id, nombre, direccion, tipo) VALUES ($1, $2, 'INT dirección', 'residencial') RETURNING id`,
      [e, `INT Sucursal ${n} ${s}`]))!.id;

  const eA = await empresa('A'); const eB = await empresa('B');
  const A1 = await sucursal(eA, 'A1'); const A2 = await sucursal(eA, 'A2'); const B1 = await sucursal(eB, 'B1');

  const email: Record<string, string> = {};
  const usuarios: Record<string, string> = {};
  const usuario = async (k: string, rol: Rol, suc: string | null, emp: string | null) => {
    email[k] = mail(k);
    usuarios[k] = (await uno<{ id: string }>(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id, empresa_id, activo)
       VALUES ($1, $2, crypt($3, gen_salt('bf', 4)), $4, $5, $6, TRUE) RETURNING id`,
      [`INT ${k}`, email[k], PASSWORD, rol, suc, emp]))!.id;
  };
  await usuario('owner', 'owner', null, null);
  await usuario('adminEmpA', 'admin_empresa', null, eA);
  await usuario('adminSucA1', 'admin_sucursal', A1, null);
  await usuario('agenteA1', 'agente', A1, null);
  await usuario('resA1', 'residente', A1, null);
  await usuario('adminSucA2', 'admin_sucursal', A2, null);
  await usuario('resA2', 'residente', A2, null);
  await usuario('adminEmpB', 'admin_empresa', null, eB);
  await usuario('adminSucB1', 'admin_sucursal', B1, null);
  await usuario('agenteB1', 'agente', B1, null);
  await usuario('resB1', 'residente', B1, null);

  const residente = async (k: string, suc: string, casa: string) =>
    (await uno<{ id: string }>(
      `INSERT INTO residentes (usuario_id, sucursal_id, numero_casa, estado_pago, saldo_pendiente, telefono)
       VALUES ($1, $2, $3, 'pendiente', 0, '50255550000') RETURNING id`,
      [usuarios[k], suc, `${casa}-${s}`]))!.id;
  const residentes = {
    A1: await residente('resA1', A1, 'INT-A1'),
    A2: await residente('resA2', A2, 'INT-A2'),
    B1: await residente('resB1', B1, 'INT-B1'),
  };

  const anuncio = async (suc: string, autor: string, n: string) =>
    (await uno<{ id: string }>(
      `INSERT INTO anuncios (sucursal_id, titulo, contenido, creado_por) VALUES ($1, $2, 'INT contenido', $3) RETURNING id`,
      [suc, `INT-anuncio-${n}-${s}`, usuarios[autor]]))!.id;
  const anuncios = {
    A1: await anuncio(A1, 'adminSucA1', 'A1'), A2: await anuncio(A2, 'adminSucA2', 'A2'), B1: await anuncio(B1, 'adminSucB1', 'B1'),
  };

  const area = async (suc: string, n: string) =>
    (await uno<{ id: string }>(
      `INSERT INTO areas_comunes (sucursal_id, nombre, descripcion) VALUES ($1, $2, 'INT') RETURNING id`,
      [suc, `INT-area-${n}-${s}`]))!.id;
  const areas = { A1: await area(A1, 'A1'), A2: await area(A2, 'A2'), B1: await area(B1, 'B1') };

  const licencia = async (suc: string, n: 'A1' | 'B1', creador: string) => {
    const codigo = `INT${n}${s}`.toUpperCase();
    const id = (await uno<{ id: string }>(
      `INSERT INTO licencias_dispositivo (sucursal_id, codigo_activacion, etiqueta, creado_por)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [suc, codigo, `INT-lic-${n}-${s}`, usuarios[creador]]))!.id;
    return { id, codigo, fingerprint: sha(`int-fp-${n}-${s}`) };
  };
  const licencias = { A1: await licencia(A1, 'A1', 'adminSucA1'), B1: await licencia(B1, 'B1', 'adminSucB1') };

  return {
    sufijo: s, empresas: { A: eA, B: eB }, sucursales: { A1, A2, B1 }, email, usuarios,
    residentes, anuncios, areas, licencias,
  };
};

export { q };
