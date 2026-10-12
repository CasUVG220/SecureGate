/**
 * T2 — interfaz `ProveedorPago`: la pasarela simulada se comporta como siempre y el adaptador de Visanet falla de forma
 * controlada (sin inventar una integración que no se pudo verificar).
 */
import {
  ProveedorNoConfiguradoError, ProveedorSimulado, ProveedorVisanet, obtenerProveedorPago, simularAutorizacionTarjeta,
} from '../services/pagos';

const entorno = { ...process.env };
afterEach(() => { process.env = { ...entorno }; });

describe('ProveedorSimulado', () => {
  const p = new ProveedorSimulado();

  it('se identifica como simulado', () => {
    expect(p.nombre).toBe('simulado');
    expect(p.simulado).toBe(true);
  });

  it('aprueba todo menos las tarjetas cuyo número termina en 1 (regla de siempre)', async () => {
    expect((await p.autorizar({ montoCentavos: 85000, ultimos4: '4444', referenciaInterna: 'r1' })).estado).toBe('aprobado');
    expect((await p.autorizar({ montoCentavos: 85000, ultimos4: '0001', referenciaInterna: 'r2' })).estado).toBe('rechazado');
    expect(simularAutorizacionTarjeta('4321')).toBe('rechazado');
    expect(simularAutorizacionTarjeta('4322')).toBe('aprobado');
  });

  it('un rechazo trae motivo y NO es una excepción', async () => {
    const r = await p.autorizar({ montoCentavos: 100, ultimos4: '0001', referenciaInterna: 'r' });
    expect(r.motivo).toMatch(/emisor/);
  });

  it('consultarEstado y reembolsar funcionan sin guardar estado', async () => {
    const ok = await p.autorizar({ montoCentavos: 100, ultimos4: '4444', referenciaInterna: 'r' });
    const no = await p.autorizar({ montoCentavos: 100, ultimos4: '0001', referenciaInterna: 'r' });
    expect(await p.consultarEstado(ok.idTransaccion!)).toEqual({ estado: 'aprobado' });
    expect(await p.consultarEstado(no.idTransaccion!)).toEqual({ estado: 'rechazado' });
    expect(await p.consultarEstado('otra-cosa')).toEqual({ estado: 'desconocido' });
    expect((await p.reembolsar!(ok.idTransaccion!, 100)).reembolsado).toBe(true);
    expect((await p.reembolsar!(no.idTransaccion!, 100)).reembolsado).toBe(false);
  });
});

describe('ProveedorVisanet (sin integración)', () => {
  const p = new ProveedorVisanet();

  it('no es simulado y toda operación falla con ProveedorNoConfiguradoError', async () => {
    expect(p.simulado).toBe(false);
    for (const op of [
      () => p.autorizar(), () => p.consultarEstado(), () => p.reembolsar(),
    ]) {
      await expect(op()).rejects.toBeInstanceOf(ProveedorNoConfiguradoError);
    }
  });

  it('el mensaje manda a la documentación y no filtra credenciales', async () => {
    process.env.VISANET_SECRET_KEY = 'no-debe-aparecer';
    const e = (await p.autorizar().catch(x => x)) as Error;
    expect(e.message).toMatch(/docs\/visanet_integracion\.md/);
    expect(e.message).not.toContain('no-debe-aparecer');
  });
});

describe('obtenerProveedorPago', () => {
  it('sin banderas: null (el controlador responde 501)', () => {
    delete process.env.PAGOS_TARJETA_SIMULADA; delete process.env.PAGOS_PROVEEDOR;
    expect(obtenerProveedorPago()).toBeNull();
  });
  it('PAGOS_TARJETA_SIMULADA=true: la simulada', () => {
    delete process.env.PAGOS_PROVEEDOR; process.env.PAGOS_TARJETA_SIMULADA = 'true';
    expect(obtenerProveedorPago()).toBeInstanceOf(ProveedorSimulado);
  });
  it('PAGOS_PROVEEDOR=visanet gana sobre la bandera simulada (nunca se cae a la simulada por accidente)', () => {
    process.env.PAGOS_TARJETA_SIMULADA = 'true'; process.env.PAGOS_PROVEEDOR = ' Visanet ';
    expect(obtenerProveedorPago()).toBeInstanceOf(ProveedorVisanet);
  });
  it('un valor desconocido de PAGOS_PROVEEDOR no activa nada por sí solo', () => {
    delete process.env.PAGOS_TARJETA_SIMULADA; process.env.PAGOS_PROVEEDOR = 'stripe';
    expect(obtenerProveedorPago()).toBeNull();
  });
});
