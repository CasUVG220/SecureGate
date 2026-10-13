import { Request, Response } from 'express';
import pool from '../db/pool';
import { esUuid, serverError } from '../utils/http';
import {
  ESTADOS, EstadoSuscripcion, listarPlanes, planPorId, planPorCodigo, validarPlan, crearPlan, actualizarPlan,
  suscripcionDe, asignarSuscripcion, historialDe, parsearMes, mesActual, usoDeEmpresa, visitasPorEmpresa, periodoTexto, hoyEnGuatemala, proyectarMes, usoDeLimites,
} from '../services/suscripciones';
import { listarFacturas } from '../services/facturacion';
import { progresoDeEmpresa } from '../services/onboarding';
import { exportarEmpresa } from '../services/exportacion';
import { ZipStream } from '../utils/zip';

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
        `SELECT e.id AS empresa_id, e.nombre, e.activo, e.suspendida, s.estado, p.codigo AS plan, p.nombre AS plan_nombre, p.visitas_incluidas,
                p.precio_visita_extra_centavos::float8 AS precio_extra,
                COALESCE(f.pendientes, 0)::int AS facturas_pendientes, COALESCE(f.vencidas, 0)::int AS facturas_vencidas,
                COALESCE(f.monto, 0)::float8 AS pendiente_centavos
           FROM empresas e
           LEFT JOIN suscripciones s ON s.empresa_id = e.id
           LEFT JOIN planes p ON p.id = s.plan_id
           LEFT JOIN (SELECT empresa_id,
                             COUNT(*) FILTER (WHERE estado IN ('pendiente', 'vencida')) AS pendientes,
                             COUNT(*) FILTER (WHERE estado = 'vencida') AS vencidas,
                             SUM(total_centavos) FILTER (WHERE estado IN ('pendiente', 'vencida')) AS monto
                        FROM facturas_saas GROUP BY empresa_id) f ON f.empresa_id = e.id
          ORDER BY e.nombre`),
    ]);
    res.json({
      periodo: periodoTexto(m),
      empresas: filas.rows.map(f => {
        const v = visitas.get(f.empresa_id) ?? 0;
        const exc = f.visitas_incluidas === null ? 0 : Math.max(0, v - f.visitas_incluidas);
        return {
          empresa_id: f.empresa_id, nombre: f.nombre, activo: f.activo, suspendida: f.suspendida, estado: f.estado, plan: f.plan, plan_nombre: f.plan_nombre, visitas: v,
          facturas_pendientes: f.facturas_pendientes, facturas_vencidas: f.facturas_vencidas, pendiente_centavos: f.pendiente_centavos,
          incluidas: f.visitas_incluidas, excedente: exc, excedente_centavos: exc * (f.precio_extra ?? 0),
        };
      }),
    });
  } catch (error) {
    serverError(res, error, 'Error al obtener el consumo');
  }
};

/**
 * GET /empresas/:id/panel — todo lo que muestra el panel del cliente en una sola llamada: plan, consumo del mes contra lo incluido, proyección
 * de excedente, límites usados, facturas y lo que se debe. El admin de empresa solo ve la suya.
 */
export const getPanelEmpresa = async (req: Request, res: Response) => {
  const id = accesoAEmpresa(req, res);
  if (!id) return;
  try {
    const emp = await pool.query('SELECT id, nombre FROM empresas WHERE id = $1', [id]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Empresa no encontrada' });
    const [susc, uso, hoy, limites, facturas, progreso] = await Promise.all([
      suscripcionDe(pool, id), usoDeEmpresa(pool, id), hoyEnGuatemala(pool), usoDeLimites(pool, id), listarFacturas(pool, { empresaId: id, limite: 12 }),
      progresoDeEmpresa(pool, id),
    ]);
    const proyeccion = susc
      ? proyectarMes(uso.visitas, hoy.dia, hoy.diasDelMes, susc.plan.visitas_incluidas, susc.plan.precio_visita_extra_centavos)
      : null;
    const pendiente = facturas.filter(f => f.estado === 'pendiente' || f.estado === 'vencida');
    res.json({
      empresa: emp.rows[0],
      suscripcion: susc,
      uso: { ...uso, dia_del_mes: hoy.dia, dias_del_mes: hoy.diasDelMes },
      proyeccion,
      limites: {
        sucursales: { usadas: limites.sucursales, maximo: susc?.plan.max_sucursales ?? null },
        garitas: { usadas: limites.garitas, maximo: susc?.plan.max_garitas ?? null },
      },
      facturas,
      pendiente_centavos: pendiente.reduce((a, f) => a + f.total_centavos, 0),
      facturas_vencidas: facturas.filter(f => f.estado === 'vencida').length,
      progreso,
    });
  } catch (error) {
    serverError(res, error, 'Error al obtener el panel');
  }
};

/**
 * GET /empresas/:id/exportar — descarga un .zip con los datos de la empresa (CSV). Owner o el admin de ESA empresa (cruce = 404).
 * La respuesta se escribe en streaming; si algo falla a medias, la conexión se corta (el archivo incompleto no abre) y queda en el registro.
 */
export const exportarDatos = async (req: Request, res: Response) => {
  const id = accesoAEmpresa(req, res);
  if (!id) return;
  try {
    const emp = await pool.query('SELECT nombre FROM empresas WHERE id = $1', [id]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Empresa no encontrada' });
    const nombre: string = emp.rows[0].nombre;
    const slug = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'empresa';
    const fecha = new Date().toISOString().slice(0, 10);
    res.status(200);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="securegate-datos-${slug}-${fecha}.zip"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const zip = new ZipStream(res);
    const resumen = await exportarEmpresa(pool, id, nombre, zip);
    res.locals.auditoria = { archivos: resumen.archivos };
    await zip.finalizar();
  } catch (error) {
    console.error('[exportar] Falló la exportación:', (error as Error).message);
    if (!res.headersSent) serverError(res, error, 'Error al exportar los datos');
    else res.destroy(error as Error);
  }
};
