import type { ProveedorPago } from './proveedor';
import { ProveedorSimulado } from './simulado';
import { ProveedorVisanet } from './visanet';

export * from './proveedor';
export { ProveedorSimulado, simularAutorizacionTarjeta } from './simulado';
export { ProveedorVisanet, MENSAJE_VISANET_PENDIENTE } from './visanet';

/**
 * Elige la pasarela de tarjeta según el entorno.
 *
 *  - `PAGOS_PROVEEDOR=visanet` → adaptador de Visanet (hoy falla de forma controlada: no hay integración).
 *  - `PAGOS_TARJETA_SIMULADA=true` → pasarela simulada (docker-compose de desarrollo y pruebas).
 *  - cualquier otro caso → `null`: el pago con tarjeta no está disponible (el controlador responde 501).
 *
 * `PAGOS_TARJETA_SIMULADA` y las guardas de `scripts/deploy.sh` no cambian: producción nunca puede tenerla activa.
 */
export function obtenerProveedorPago(): ProveedorPago | null {
  if ((process.env.PAGOS_PROVEEDOR ?? '').trim().toLowerCase() === 'visanet') return new ProveedorVisanet();
  if (process.env.PAGOS_TARJETA_SIMULADA === 'true') return new ProveedorSimulado();
  return null;
}
