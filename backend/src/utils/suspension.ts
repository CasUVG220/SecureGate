import { Response } from 'express';
import type { Pool, PoolClient } from 'pg';

/**
 * Estado operativo de una empresa, evaluado en los puntos de entrada:
 * login, refresh de sesión y validación de licencias de garita. Si la
 * empresa está suspendida (pausa reversible del owner) o dada de baja, nadie
 * de esa empresa —admin, agente, residente, ni el equipo de garita— entra, y
 * la respuesta lleva el motivo para mostrarlo tal cual.
 *
 * El owner nunca se bloquea: no pertenece a ninguna empresa.
 */
export interface BloqueoEmpresa {
  codigo: 'empresa_suspendida' | 'empresa_inactiva';
  empresa_id: string;
  empresa_nombre: string;
  motivo: string | null;
  desde: Date | null;
}

export interface FilaEmpresaEstado {
  id: string;
  nombre: string;
  activo: boolean;
  suspendida: boolean;
  suspension_motivo: string | null;
  suspendida_en: Date | null;
}

export const HTTP_BLOQUEO = 423; // Locked

// Comparaciones explícitas: sólo bloquea lo que la base afirma (FALSE / TRUE);
// una fila sin esas columnas (p. ej. un join parcial) no se toma por baja.
export const evaluarEmpresa = (e: FilaEmpresaEstado | null | undefined): BloqueoEmpresa | null => {
  if (!e) return null;
  if (e.activo === false) {
    return { codigo: 'empresa_inactiva', empresa_id: e.id, empresa_nombre: e.nombre, motivo: null, desde: null };
  }
  if (e.suspendida === true) {
    return { codigo: 'empresa_suspendida', empresa_id: e.id, empresa_nombre: e.nombre, motivo: e.suspension_motivo, desde: e.suspendida_en };
  }
  return null;
};

/** Empresa de un usuario: directa (admin_empresa) o a través de su sucursal. */
export const bloqueoDeUsuario = async (
  db: Pool | PoolClient,
  u: { rol: string; empresa_id: string | null; sucursal_id: string | null },
): Promise<BloqueoEmpresa | null> => {
  if (u.rol === 'owner') return null;
  const r = await db.query<FilaEmpresaEstado>(
    `SELECT e.id, e.nombre, e.activo, e.suspendida, e.suspension_motivo, e.suspendida_en
     FROM empresas e
     WHERE e.id = $1
        OR ($1 IS NULL AND e.id = (SELECT empresa_id FROM sucursales WHERE id = $2))
     LIMIT 1`,
    [u.empresa_id, u.sucursal_id],
  );
  return evaluarEmpresa(r.rows[0]);
};

export const mensajeBloqueo = (b: BloqueoEmpresa): string =>
  b.codigo === 'empresa_suspendida'
    ? `Las operaciones de ${b.empresa_nombre} están suspendidas${b.motivo ? `: ${b.motivo}` : ''}. Contacta al administrador de SecureGate.`
    : `${b.empresa_nombre} ya no opera en SecureGate.`;

export const responderBloqueo = (res: Response, b: BloqueoEmpresa) =>
  res.status(HTTP_BLOQUEO).json({
    error: mensajeBloqueo(b),
    estado: 'suspendida',
    codigo: b.codigo,
    empresa: b.empresa_nombre,
    motivo: b.motivo,
    desde: b.desde,
  });
