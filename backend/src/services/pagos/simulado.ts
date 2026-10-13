import type {
  EstadoTransaccion, ProveedorPago, ResultadoAutorizacion, ResultadoReembolso, SolicitudAutorizacion,
} from './proveedor';

/**
 * Pasarela simulada (la de siempre, ahora detrás de `ProveedorPago`).
 *
 * La regla es determinística a propósito, para poder demostrar los dos caminos sin depender del azar: una tarjeta cuyo
 * número termina en 1 se rechaza y cualquier otra se aprueba. Sin estado: el identificador de la transacción lleva el
 * resultado (`SIM-<ultimos4>-A|R`), así `consultarEstado` y `reembolsar` funcionan sin guardar nada.
 */
export function simularAutorizacionTarjeta(ultimos4: string): 'aprobado' | 'rechazado' {
  return ultimos4.endsWith('1') ? 'rechazado' : 'aprobado';
}

export class ProveedorSimulado implements ProveedorPago {
  readonly nombre = 'simulado';
  readonly simulado = true;

  async autorizar(s: SolicitudAutorizacion): Promise<ResultadoAutorizacion> {
    const estado = simularAutorizacionTarjeta(s.ultimos4);
    return {
      estado,
      idTransaccion: `SIM-${s.ultimos4}-${estado === 'aprobado' ? 'A' : 'R'}`,
      motivo: estado === 'rechazado' ? 'Rechazado por el emisor (simulación)' : undefined,
    };
  }

  async consultarEstado(idTransaccion: string): Promise<EstadoTransaccion> {
    const m = /^SIM-\d{4}-(A|R)$/.exec(idTransaccion);
    if (!m) return { estado: 'desconocido' };
    return { estado: m[1] === 'A' ? 'aprobado' : 'rechazado' };
  }

  async reembolsar(idTransaccion: string, montoCentavos: number): Promise<ResultadoReembolso> {
    const aprobada = /^SIM-\d{4}-A$/.test(idTransaccion) && montoCentavos > 0;
    return { reembolsado: aprobada, idReembolso: aprobada ? `${idTransaccion}-REEMB` : undefined };
  }
}
