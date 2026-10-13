/**
 * Cobro de las facturas SaaS (T11): cómo se confirma que una empresa pagó su factura de SecureGate.
 *
 * El módulo de facturación habla SOLO con esta interfaz. Hoy hay dos implementaciones:
 *   - `ProveedorCobroManual` (`manual.ts`): transferencia o depósito; el owner verifica el dinero y marca la factura pagada.
 *   - `ProveedorCobroVisanet` (`visanet.ts`): punto de enchufe SIN integración (falla con `ProveedorNoConfiguradoError`);
 *     qué falta: `docs/visanet_integracion.md` y `docs/saas_nucleo.md`.
 *
 * El dinero viaja en CENTAVOS enteros. Una confirmación inválida es `ErrorCobro` (400), no una excepción genérica.
 */

export const METODOS_PAGO_SAAS = ['transferencia', 'deposito', 'efectivo', 'otro'] as const;
export type MetodoPagoSaas = (typeof METODOS_PAGO_SAAS)[number];

export interface SolicitudCobro {
  facturaId: string;
  numero: number;
  empresaId: string;
  totalCentavos: number;
  moneda: string;
}

export interface ConfirmacionPago {
  metodo: MetodoPagoSaas;
  referencia?: string | null;
  nota?: string | null;
}

export interface ResultadoCobro {
  /** Referencia que se guarda en la factura (número de boleta, id de transacción…). */
  referencia: string | null;
  metodo: MetodoPagoSaas;
  nota: string | null;
}

export interface ProveedorCobro {
  /** Nombre corto para la factura y la auditoría: `manual`, `visanet`. */
  readonly nombre: string;
  /** `true` si el proveedor cobra solo (tarjeta, domiciliación); `false` si una persona confirma a mano. */
  readonly automatico: boolean;
  /** Confirma el pago de una factura. Lanza `ErrorCobro` si la confirmación es inválida. */
  confirmarPago(solicitud: SolicitudCobro, confirmacion: ConfirmacionPago): Promise<ResultadoCobro>;
}

/** La confirmación recibida no es válida (método desconocido, falta la referencia…). El controlador responde 400. */
export class ErrorCobro extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorCobro';
  }
}
