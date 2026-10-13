import { Request, Response } from 'express';
import pool from '../db/pool';
import { esUuid, serverError } from '../utils/http';
import {
  ESTADOS, EstadoSuscripcion, listarPlanes, planPorId, planPorCodigo, validarPlan, crearPlan, actualizarPlan,
  suscripcionDe, asignarSuscripcion, historialDe, parsearMes, mesActual, usoDeEmpresa, visitasPorEmpresa, periodoTexto,
} from '../services/suscripciones';

/** GET /planes — catálogo. Cualquier admin ve los activos; el owner también los inactivos con ?todos=1. */
export const getPlanes = async (req: Request, res: Response) => {
  try {
    const todos = req.user!.rol === 'owner' && req.query.todos === '1';
    res.json(await listarPlanes(pool, !todos));
  } catch (error) {
    serverError(res, error, 'Error al obtener los planes');
  }
};

export const createPlan = async (req: Request, res: Response) => {
  const v = validarPlan(req.body ?? {}, false);
  if (v.ok === false) return res.status(400).json({ error: v.error });
  try {
    res.status(201).json(await crearPlan(pool, v.valores));
  } catch (error) {
    serverError(res, error, 'Error al crear el plan');
  }
};

export const updatePlan = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!esUuid(id)) return res.status(400).json({ error: 'id inválido' });
  const v = validarPlan(req.body ?? {}, true);
  if (v.ok === false) return res.status(400).json({ error: v.error });
  try {
    const plan = await actualizarPlan(pool, id, v.valores);
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
    res.json(plan);
  } catch (error) {
    serverError(res, error, 'Error al actualizar el plan');
  }
};

/**
 * Un admin_empresa solo ve lo suyo; el owner ve cualquier empresa.
 * Devuelve false (y ya respondió) si no hay acceso. Misma respuesta 404 para
 * «no existe» y «no es tuya», para no confirmar la existencia de otras empresas.
 */
const accesoAEmpresa = (req: Request, res: Response): string | null => {
  const id = req.params.id;
  if (!esUuid(id)) { res.status(400).json({ error: 'id inválido' }); return null; }
  if (req.user!.rol !== 'owner' && req.user!.empresa_id !== id) {
    res.status(404).json({ error: 'Empresa no encontrada' });
    return null;
  }
  return id;
};

/** GET /empresas/:id/suscripcion */
export const getSuscripcion = async (req: Request, res: Response) => {
  const id = accesoAEmpresa(req, res);
  if (!id) return;
  try {
    const existe = await pool.query('SELECT 1 FROM empresas WHERE id = $1', [id]);
    if (existe.rows.length === 0) return res.status(404).json({ error: 'Empresa no encontrada' });
    res.json({ suscripcion: await suscripcionDe(pool, id) });
  } catch (error) {
    serverError(res, error, 'Error al obtener la suscripción');
  }
};

/** PUT /empresas/:id/suscripcion — solo owner: asigna plan y/o estado. Escribe el histórico. */
export const putSuscripcion = async (req: Request, res: Response) => {
  const id = accesoAEmpresa(req, res);
  if (!id) return;
  const { plan_id, plan_codigo, estado, motivo } = (req.body ?? {}) as Record<string, unknown>;
  if (estado !== undefined && !ESTADOS.includes(estado as EstadoSuscripcion)) {
    return res.status(400).json({ error: `estado inválido (${ESTADOS.join(', ')})` });
  }
  if (motivo !== undefined && (typeof motivo !== 'string' || motivo.length > 300)) {
    return res.status(400).json({ error: 'motivo inválido (texto de hasta 300 caracteres)' });
  }
  if (plan_id !== undefined && !esUuid(plan_id)) return res.status(400).json({ error: 'plan_id inválido' });
  if (plan_codigo !== undefined && typeof plan_codigo !== 'string') return res.status(400).json({ error: 'plan_codigo inválido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const empresa = await client.query('SELECT 1 FROM empresas WHERE id = $1', [id]);
    if (empresa.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Empresa no encontrada' }); }

    const plan = plan_id !== undefined ? await planPorId(client, plan_id as string)
      : plan_codigo !== undefined ? await planPorCodigo(client, plan_codigo as string) : null;
    if ((plan_id !== undefined || plan_codigo !== undefined) && (!plan || !plan.activo)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Plan no encontrado o inactivo' });
    }
    const existente = await suscripcionDe(client, id);
    if (!existente && !plan) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La empresa no tiene suscripción: indica plan_id o plan_codigo' });
    }
    if (!plan && estado === undefined) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Indica plan_id/plan_codigo y/o estado' });
    }

    await asignarSuscripcion(client, {
      empresaId: id, plan: plan ?? undefined, estado: estado as EstadoSuscripcion | undefined,
      motivo: motivo as string | undefined, usuarioId: req.user!.id,
    });
    await client.query('COMMIT');
    res.json({ suscripcion: await suscripcionDe(pool, id) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    serverError(res, error, 'Error al actualizar la suscripción');
  } finally {
    client.release();
  }
};

/** GET /empresas/:id/suscripcion/historial */
export const getHistorialSuscripcion = async (req: Request, res: Response) => {
  const id = accesoAEmpresa(req, res);
  if (!id) return;
  try {
    res.json(await historialDe(pool, id));
  } catch (error) {
    serverError(res, error, 'Error al obtener el historial');
  }
};

/** GET /empresas/:id/uso?mes=YYYY-MM — consumo del mes calendario (America/Guatemala). */
export const getUsoEmpresa = async (req: Request, res: Response) => {
  const id = accesoAEmpresa(req, res);
  if (!id) return;
  let mes;
  if (req.query.mes !== undefined) {
    mes = parsearMes(req.query.mes);
    if (!mes) return res.status(400).json({ error: 'mes inválido: usa el formato AAAA-MM' });
  }
  try {
    const existe = await pool.query('SELECT 1 FROM empresas WHERE id = $1', [id]);
    if (existe.rows.length === 0) return res.status(404).json({ error: 'Empresa no encontrada' });
    res.json(await usoDeEmpresa(pool, id, mes));
  } catch (error) {
    serverError(res, error, 'Error al obtener el consumo');
  }
};

/** GET /planes/uso?mes=YYYY-MM — solo owner: consumo de todas las empresas con suscripción. */
export const getUsoTodas = async (req: Request, res: Response) => {
  let mes;
  if (req.query.mes !== undefined) {
    mes = parsearMes(req.query.mes);
    if (!mes) return res.status(400).json({ error: 'mes inválido: usa el formato AAAA-MM' });
  }
  try {
    const m = mes ?? await mesActual(pool);
    const [visitas, filas] = await Promise.all([
      visitasPorEmpresa(pool, m),
      pool.query(
        `SELECT e.id AS empresa_id, e.nombre, s.estado, p.codigo AS plan, p.visitas_incluidas,
                p.precio_visita_extra_centavos::float8 AS precio_extra
           FROM empresas e
           LEFT JOIN suscripciones s ON s.empresa_id = e.id
           LEFT JOIN planes p ON p.id = s.plan_id
          ORDER BY e.nombre`),
    ]);
    res.json({
      periodo: periodoTexto(m),
      empresas: filas.rows.map(f => {
        const v = visitas.get(f.empresa_id) ?? 0;
        const exc = f.visitas_incluidas === null ? 0 : Math.max(0, v - f.visitas_incluidas);
        return {
          empresa_id: f.empresa_id, nombre: f.nombre, estado: f.estado, plan: f.plan, visitas: v,
          incluidas: f.visitas_incluidas, excedente: exc, excedente_centavos: exc * (f.precio_extra ?? 0),
        };
      }),
    });
  } catch (error) {
    serverError(res, error, 'Error al obtener el consumo');
  }
};
