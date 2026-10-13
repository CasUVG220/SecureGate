import { ErrorCobro, METODOS_PAGO_SAAS, type ConfirmacionPago, type ProveedorCobro, type ResultadoCobro, type SolicitudCobro } from './proveedor';

/**
 * Cobro manual: la empresa paga por transferencia o depósito y el owner marca la factura pagada.
 * Una transferencia o un depósito exigen número de boleta/referencia: sin él no hay forma de conciliar con el banco después.
 */
export class ProveedorCobroManual implements ProveedorCobro {
  readonly nombre = 'manual';
  readonly automatico = false;

  async confirmarPago(_s: SolicitudCobro, c: ConfirmacionPago): Promise<ResultadoCobro> {
    if (!METODOS_PAGO_SAAS.includes(c.metodo)) {
      throw new ErrorCobro(`método inválido (${METODOS_PAGO_SAAS.join(', ')})`);
    }
    const referencia = typeof c.referencia === 'string' ? c.referencia.trim() : '';
    if (referencia.length > 100) throw new ErrorCobro('referencia: máximo 100 caracteres');
    if ((c.metodo === 'transferencia' || c.metodo === 'deposito') && !referencia) {
      throw new ErrorCobro('Una transferencia o un depósito necesita el número de referencia o de boleta');
    }
    const nota = typeof c.nota === 'string' ? c.nota.trim() : '';
    if (nota.length > 300) throw new ErrorCobro('nota: máximo 300 caracteres');
    return { referencia: referencia || null, metodo: c.metodo, nota: nota || null };
  }
}
