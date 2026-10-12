import {
  ProveedorNoConfiguradoError,
  type EstadoTransaccion, type ProveedorPago, type ResultadoAutorizacion, type ResultadoReembolso,
} from './proveedor';

/**
 * Adaptador de Visanet Guatemala — SIN INTEGRACIÓN (T2).
 *
 * No se inventaron endpoints, firmas, 3-D Secure ni webhooks: no se pudieron verificar contra la documentación oficial
 * (ver `docs/visanet_integracion.md`, que lista lo que se sabe, lo que falta y el trámite del comercio). Hasta entonces,
 * elegirlo (`PAGOS_PROVEEDOR=visanet`) hace que todo intento falle de forma controlada: el controlador responde 503
 * «no disponible todavía» y la auditoría deja la fila con el proveedor y el motivo. Nada se cobra y nada se guarda.
 *
 * Las credenciales del comercio (cuando existan) deben venir de variables de entorno / secreto, nunca del código.
 */
export const MENSAJE_VISANET_PENDIENTE =
  'La integración con Visanet está pendiente (sin credenciales ni contrato del comercio). Ver docs/visanet_integracion.md.';

export class ProveedorVisanet implements ProveedorPago {
  readonly nombre = 'visanet';
  readonly simulado = false;

  private pendiente(): never {
    throw new ProveedorNoConfiguradoError(this.nombre, MENSAJE_VISANET_PENDIENTE);
  }

  async autorizar(): Promise<ResultadoAutorizacion> { return this.pendiente(); }
  async consultarEstado(): Promise<EstadoTransaccion> { return this.pendiente(); }
  async reembolsar(): Promise<ResultadoReembolso> { return this.pendiente(); }
}
