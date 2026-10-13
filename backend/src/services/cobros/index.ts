import type { ProveedorCobro } from './proveedor';
import { ProveedorCobroManual } from './manual';
import { ProveedorCobroVisanet } from './visanet';

export * from './proveedor';
export { ProveedorCobroManual } from './manual';
export { ProveedorCobroVisanet } from './visanet';

/**
 * Elige cómo se cobran las facturas SaaS según `COBRO_PROVEEDOR`:
 *   - `manual` (por defecto, o vacío) → transferencia/depósito confirmado por el owner.
 *   - `visanet` → punto de enchufe sin integración (falla controlada).
 * Un valor desconocido NO cae en silencio al manual: lanza, para que un error de configuración se vea.
 */
export function obtenerProveedorCobro(): ProveedorCobro {
  const nombre = (process.env.COBRO_PROVEEDOR ?? 'manual').trim().toLowerCase() || 'manual';
  if (nombre === 'manual') return new ProveedorCobroManual();
  if (nombre === 'visanet') return new ProveedorCobroVisanet();
  throw new Error(`COBRO_PROVEEDOR="${nombre}" no existe (manual | visanet)`);
}
