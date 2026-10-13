import { ProveedorNoConfiguradoError } from '../pagos/proveedor';
import { MENSAJE_VISANET_PENDIENTE } from '../pagos/visanet';
import type { ConfirmacionPago, ProveedorCobro, ResultadoCobro, SolicitudCobro } from './proveedor';

/**
 * Punto de enchufe del cobro automático con tarjeta (Visanet / NeoNet) — SIN INTEGRACIÓN (T11).
 * Mismo criterio que `pagos/visanet.ts`: no se inventó ninguna llamada. Elegirlo (`COBRO_PROVEEDOR=visanet`) hace que marcar pagos falle de forma
 * controlada (503, auditado) y nada cambie. Cuando exista contrato y credenciales, aquí va el cobro recurrente y su conciliación.
 */
export class ProveedorCobroVisanet implements ProveedorCobro {
  readonly nombre = 'visanet';
  readonly automatico = true;

  async confirmarPago(_s: SolicitudCobro, _c: ConfirmacionPago): Promise<ResultadoCobro> {
    throw new ProveedorNoConfiguradoError(this.nombre, MENSAJE_VISANET_PENDIENTE);
  }
}
