/**
 * Pasarela de pago con tarjeta (T2).
 *
 * El controlador de pagos habla SOLO con esta interfaz; no sabe si detrás hay la pasarela simulada o un procesador real.
 * Hoy hay dos implementaciones:
 *   - `ProveedorSimulado` (`simulado.ts`): la regla determinística de siempre (el último dígito 1 se rechaza).
 *   - `ProveedorVisanet` (`visanet.ts`): adaptador SIN integración, falla con `ProveedorNoConfiguradoError`.
 *     Qué falta para integrarlo: `docs/visanet_integracion.md`.
 *
 * Contrato:
 *   - `autorizar` NUNCA recibe el número completo de la tarjeta ni el CVV (hoy se validan y se quedan en el navegador).
 *     Cuando exista el procesador real, la captura de datos de tarjeta deberá ir en el formulario alojado o el SDK del
 *     procesador (alcance PCI) y aquí llegará un token; esta interfaz no cambia de forma: se agrega el campo `token`.
 *   - El dinero viaja en CENTAVOS enteros.
 *   - Un rechazo del emisor NO es una excepción: es `{ estado: 'rechazado' }`. Las excepciones son para lo que no
 *     es del emisor (no configurado, red, tiempo agotado).
 */

export interface SolicitudAutorizacion {
  montoCentavos: number;
  ultimos4: string;
  titular?: string;
  /** Identificador propio para idempotencia/conciliación (no es un dato de la tarjeta). */
  referenciaInterna: string;
}

export interface ResultadoAutorizacion {
  estado: 'aprobado' | 'rechazado';
  /** Identificador de la transacción en el procesador (para consultar o reembolsar). */
  idTransaccion?: string;
  /** Motivo legible del rechazo, si el procesador lo da. Nunca datos de la tarjeta. */
  motivo?: string;
}

export interface EstadoTransaccion {
  estado: 'aprobado' | 'rechazado' | 'reembolsado' | 'pendiente' | 'desconocido';
}

export interface ResultadoReembolso {
  reembolsado: boolean;
  idReembolso?: string;
}

export interface ProveedorPago {
  /** Nombre corto para la bitácora de auditoría: `simulado`, `visanet`. */
  readonly nombre: string;
  /** ¿Es una pasarela de prueba? Marca `pagos.es_simulado`. */
  readonly simulado: boolean;
  autorizar(s: SolicitudAutorizacion): Promise<ResultadoAutorizacion>;
  consultarEstado(idTransaccion: string): Promise<EstadoTransaccion>;
  /** Opcional: no todo procesador/contrato lo permite. */
  reembolsar?(idTransaccion: string, montoCentavos: number): Promise<ResultadoReembolso>;
}

/** El proveedor elegido no tiene integración o credenciales. El controlador lo traduce a 503 y lo audita. */
export class ProveedorNoConfiguradoError extends Error {
  constructor(public readonly proveedor: string, mensaje: string) {
    super(mensaje);
    this.name = 'ProveedorNoConfiguradoError';
  }
}
