import { Request, Response } from 'express';
import pool from '../db/pool';
import { esUuid, serverError } from '../utils/http';
import { parsearMes } from '../services/suscripciones';
import {
  EstadoFacturaError, FacturaNoEncontradaError, MesNoCerradoError, anularFactura, ejecutarFacturacionMensual, facturaPorId, generarFacturasMensuales,
  listarFacturas, pagarFactura, revisarVencimientos, enviarAvisos,
} from '../services/facturacion';
import { ErrorCobro, METODOS_PAGO_SAAS, obtenerProveedorCobro, type MetodoPagoSaas } from '../services/cobros';
import { ProveedorNoConfiguradoError } from '../services/pagos/proveedor';

const ESTADOS = ['pendiente', 'pagada', 'vencida', 'anulada'];

/** GET /facturas-saas — owner: todas las facturas, filtrables por estado, empresa y periodo. */
export const getFacturas = async (req: Request, res: Response) => {
  const { estado, empresa_id, periodo } = req.query as Record<string, string | undefined>;
  if (estado !== undefined && !ESTADOS.includes(estado)) return res.status(400).json({ error: `estado inválido (${ESTADOS.join(', ')})` });
  if (empresa_id !== undefined && !esUuid(empresa_id)) return res.status(400).json({ error: 'empresa_id inválido' });
  if (periodo !== undefined && !parsearMes(periodo)) return res.status(400).json({ error: 'periodo inválido: usa el formato AAAA-MM' });
  try {
    res.json(await listarFacturas(pool, { estado, empresaId: empresa_id, periodo }));
  } catch (error) {
    serverError(res, error, 'Error al obtener las facturas');
  }
};

/** GET /empresas/:id/facturas — owner, o el admin de ESA empresa (cruce = 404). */
export const getFacturasDeEmpresa = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!esUuid(id)) return res.status(400).json({ error: 'id inválido' });
  if (req.user!.rol !== 'owner' && req.user!.empresa_id !== id) return res.status(404).json({ error: 'Empresa no encontrada' });
  try {
    res.json(await listarFacturas(pool, { empresaId: id }));
  } catch (error) {
    serverError(res, error, 'Error al obtener las facturas');
  }
};

/** GET /facturas-saas/:id — owner, o el admin de la empresa dueña de la factura (otra empresa = 404). */
export const getFactura = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!esUuid(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const f = await facturaPorId(pool, id, req.user!.rol === 'owner' ? undefined : (req.user!.empresa_id ?? '00000000-0000-0000-0000-000000000000'));
    if (!f) return res.status(404).json({ error: 'Factura no encontrada' });
    res.json(f);
  } catch (error) {
    serverError(res, error, 'Error al obtener la factura');
  }
};

/** POST /facturas-saas/generar — owner: corre a mano la facturación de un mes cerrado (por defecto, el anterior). Idempotente. */
export const generarFacturas = async (req: Request, res: Response) => {
  const { mes } = (req.body ?? {}) as { mes?: unknown };
  let m;
  if (mes !== undefined) {
    m = parsearMes(mes);
    if (!m) return res.status(400).json({ error: 'mes inválido: usa el formato AAAA-MM' });
  }
  try {
    if (m) {
      const generacion = await generarFacturasMensuales(pool, { mes: m });
      return res.json({ ejecutado: true, ...generacion, avisos: await enviarAvisos(pool) });
    }
    res.json({ ejecutado: true, ...(await ejecutarFacturacionMensual(pool)) });
  } catch (error) {
    if (error instanceof MesNoCerradoError) return res.status(422).json({ error: error.message });
    serverError(res, error, 'Error al generar las facturas');
  }
};

/** POST /facturas-saas/revisar-vencidas — owner: marca vencidas y manda los avisos que toquen. */
export const revisarVencidas = async (_req: Request, res: Response) => {
  try {
    res.json({ ejecutado: true, ...(await revisarVencimientos(pool)) });
  } catch (error) {
    serverError(res, error, 'Error al revisar los vencimientos');
  }
};

/** POST /facturas-saas/:id/pagar — owner: confirma el pago (transferencia/depósito/efectivo) con el proveedor de cobro. */
export const pagar = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!esUuid(id)) return res.status(400).json({ error: 'id inválido' });
  const { metodo, referencia, nota } = (req.body ?? {}) as { metodo?: unknown; referencia?: unknown; nota?: unknown };
  if (typeof metodo !== 'string' || !METODOS_PAGO_SAAS.includes(metodo as MetodoPagoSaas)) {
    return res.status(400).json({ error: `metodo inválido (${METODOS_PAGO_SAAS.join(', ')})` });
  }
  if ((referencia !== undefined && referencia !== null && typeof referencia !== 'string') || (nota !== undefined && nota !== null && typeof nota !== 'string')) {
    return res.status(400).json({ error: 'referencia y nota deben ser texto' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const factura = await pagarFactura(client, id, { metodo: metodo as MetodoPagoSaas, referencia: referencia as string | null | undefined, nota: nota as string | null | undefined },
      obtenerProveedorCobro(), req.user!.id);
    await client.query('COMMIT');
    res.json(factura);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof FacturaNoEncontradaError) return res.status(404).json({ error: error.message });
    if (error instanceof EstadoFacturaError) return res.status(409).json({ error: error.message });
    if (error instanceof ErrorCobro) return res.status(400).json({ error: error.message });
    if (error instanceof ProveedorNoConfiguradoError) return res.status(503).json({ error: error.message, proveedor: error.proveedor });
    serverError(res, error, 'Error al registrar el pago');
  } finally {
    client.release();
  }
};

/** POST /facturas-saas/:id/anular — owner: anula una factura pendiente o vencida (con motivo). */
export const anular = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!esUuid(id)) return res.status(400).json({ error: 'id inválido' });
  const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
  if (motivo.length < 3 || motivo.length > 300) return res.status(400).json({ error: 'motivo: de 3 a 300 caracteres' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const factura = await anularFactura(client, id, motivo);
    await client.query('COMMIT');
    res.json(factura);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof FacturaNoEncontradaError) return res.status(404).json({ error: error.message });
    if (error instanceof EstadoFacturaError) return res.status(409).json({ error: error.message });
    serverError(res, error, 'Error al anular la factura');
  } finally {
    client.release();
  }
};
