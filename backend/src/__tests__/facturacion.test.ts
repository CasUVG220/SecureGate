/**
 * U · Facturación SaaS (unitarias, sin base) — T11
 * Los ejemplos de cálculo de docs/saas_nucleo.md salen de aquí: cuota, excedente, mes parcial, prueba y cancelación.
 * Todo en centavos enteros.
 */
import {
  calcularFactura, ventanaDeCobro, dinero, numeroTexto, sumarDias, mesAnterior, diasDelMes, fechaEnGuatemala, configFacturacion,
  type PlanParaCalculo,
} from '../services/facturacion';
import { ProveedorNoConfiguradoError } from '../services/pagos/proveedor';
import { ErrorCobro, ProveedorCobroManual, ProveedorCobroVisanet, obtenerProveedorCobro } from '../services/cobros';

const basico: PlanParaCalculo = { codigo: 'basico', nombre: 'Básico', precio_mensual_centavos: 25000, visitas_incluidas: 500, precio_visita_extra_centavos: 50 };

describe('calcularFactura — ejemplos', () => {
  it('mes completo dentro de lo incluido: solo la cuota', () => {
    const c = calcularFactura(basico, 30, 30, 480);
    expect(c).toMatchObject({ cuota_centavos: 25000, excedente_visitas: 0, excedente_centavos: 0, total_centavos: 25000, parcial: false });
    expect(c.lineas).toEqual([{ concepto: 'Cuota del plan Básico', cantidad: 1, precio_unitario_centavos: 25000, monto_centavos: 25000 }]);
  });

  it('justo en el límite incluido no hay excedente; una visita más cuesta Q0.50', () => {
    expect(calcularFactura(basico, 31, 31, 500).total_centavos).toBe(25000);
    expect(calcularFactura(basico, 31, 31, 501)).toMatchObject({ excedente_visitas: 1, excedente_centavos: 50, total_centavos: 25050 });
  });

  it('con excedente: 620 visitas, 120 de más a Q0.50 = Q60.00 → total Q310.00', () => {
    const c = calcularFactura(basico, 31, 31, 620);
    expect(c).toMatchObject({ cuota_centavos: 25000, excedente_visitas: 120, excedente_centavos: 6000, total_centavos: 31000 });
    expect(c.lineas[1]).toEqual({ concepto: 'Visitas adicionales (620 registradas, 500 incluidas)', cantidad: 120, precio_unitario_centavos: 50, monto_centavos: 6000 });
  });

  it('mes parcial: junio (30 días) con 20 días facturados prorratea la cuota y lo incluido', () => {
    // 25 000 × 20 / 30 = 16 666,67 → 16 667. Incluidas: 500 × 20 / 30 = 333,33 → 334 (hacia arriba). 400 visitas → 66 de más × 50 = 3 300.
    const c = calcularFactura(basico, 30, 20, 400);
    expect(c).toMatchObject({ cuota_centavos: 16667, visitas_incluidas: 334, excedente_visitas: 66, excedente_centavos: 3300, total_centavos: 19967, parcial: true });
    expect(c.lineas[0].concepto).toBe('Cuota del plan Básico (20 de 30 días)');
    expect(c.lineas[0].precio_unitario_centavos).toBe(25000);
  });

  it('febrero de 28 días con 14 facturados es exactamente la mitad', () => {
    expect(calcularFactura(basico, 28, 14, 0)).toMatchObject({ cuota_centavos: 12500, visitas_incluidas: 250, total_centavos: 12500 });
  });

  it('un solo día: 25 000 / 31 = 806,45 → 806; incluidas 500/31 = 16,13 → 17', () => {
    expect(calcularFactura(basico, 31, 1, 0)).toMatchObject({ cuota_centavos: 806, visitas_incluidas: 17 });
  });

  it('el redondeo manda las mitades hacia arriba, sin errores de coma flotante', () => {
    const p = { ...basico, precio_mensual_centavos: 1 };
    expect(calcularFactura(p, 30, 15, 0).cuota_centavos).toBe(1);        // 0,5 → 1
    expect(calcularFactura({ ...basico, precio_mensual_centavos: 3 }, 30, 15, 0).cuota_centavos).toBe(2);   // 1,5 → 2
    expect(calcularFactura({ ...basico, precio_mensual_centavos: 0 }, 30, 15, 0).cuota_centavos).toBe(0);
  });

  it('el total siempre es la suma exacta de cuota y excedente (enteros)', () => {
    for (let dias = 1; dias <= 31; dias++) for (const visitas of [0, 7, 333, 5000]) {
      const c = calcularFactura({ ...basico, precio_mensual_centavos: 99999, precio_visita_extra_centavos: 33 }, 31, dias, visitas);
      expect(Number.isInteger(c.total_centavos)).toBe(true);
      expect(c.total_centavos).toBe(c.cuota_centavos + c.excedente_centavos);
      expect(c.lineas.reduce((a, l) => a + l.monto_centavos, 0)).toBe(c.total_centavos);
    }
  });

  it('rechaza decimales, negativos y días imposibles', () => {
    expect(() => calcularFactura({ ...basico, precio_mensual_centavos: 250.5 }, 30, 30, 0)).toThrow();
    expect(() => calcularFactura(basico, 30, 30, -1)).toThrow();
    expect(() => calcularFactura(basico, 30, 0, 0)).toThrow();
    expect(() => calcularFactura(basico, 30, 31, 0)).toThrow();
    expect(() => calcularFactura(basico, 30, 10.5, 0)).toThrow();
  });
});

describe('ventanaDeCobro', () => {
  const sept = { anio: 2026, mes: 9 };
  const susc = (inicio: string, prueba: string | null = null, cancelada: string | null = null) => ({ inicio_en: inicio, prueba_hasta: prueba, cancelada_en: cancelada });

  it('suscripción de meses atrás, sin prueba ni cancelación: el mes completo', () => {
    expect(ventanaDeCobro(sept, susc('2026-01-10T12:00:00Z'))).toEqual({ desde: '2026-09-01', hasta: '2026-09-30', dias: 30 });
  });

  it('la prueba termina a mitad de mes: se cobra desde ese día (inclusive)', () => {
    expect(ventanaDeCobro(sept, susc('2026-09-01T15:00:00Z', '2026-09-15T15:00:00Z'))).toEqual({ desde: '2026-09-15', hasta: '2026-09-30', dias: 16 });
  });

  it('una prueba que sigue corriendo al cerrar el mes no se cobra', () => {
    expect(ventanaDeCobro(sept, susc('2026-09-20T15:00:00Z', '2026-10-04T15:00:00Z'))).toBeNull();
  });

  it('sin prueba, se cobra desde el día del alta', () => {
    expect(ventanaDeCobro(sept, susc('2026-09-11T20:00:00Z'))).toEqual({ desde: '2026-09-11', hasta: '2026-09-30', dias: 20 });
  });

  it('cancelada a mitad de mes: se cobra hasta ese día (inclusive); cancelada antes del mes: nada', () => {
    expect(ventanaDeCobro(sept, susc('2026-01-10T12:00:00Z', null, '2026-09-20T15:00:00Z'))).toEqual({ desde: '2026-09-01', hasta: '2026-09-20', dias: 20 });
    expect(ventanaDeCobro(sept, susc('2026-01-10T12:00:00Z', null, '2026-08-20T15:00:00Z'))).toBeNull();
  });

  it('el día se decide en hora de Guatemala, no en UTC', () => {
    // 2026-10-01 05:30 UTC = 30-sep 23:30 en Guatemala → el último día de septiembre ya se cobra.
    expect(ventanaDeCobro(sept, susc('2026-01-01T00:00:00Z', '2026-10-01T05:30:00Z'))).toEqual({ desde: '2026-09-30', hasta: '2026-09-30', dias: 1 });
    // 2026-09-01 05:59 UTC = 31-ago 23:59 en Guatemala → el alta fue en agosto: septiembre completo.
    expect(ventanaDeCobro(sept, susc('2026-09-01T05:59:00Z'))).toEqual({ desde: '2026-09-01', hasta: '2026-09-30', dias: 30 });
  });

  it('alta posterior al mes: nada', () => {
    expect(ventanaDeCobro(sept, susc('2026-10-02T15:00:00Z'))).toBeNull();
  });

  it('acepta fechas como Date (así las devuelve pg)', () => {
    expect(ventanaDeCobro(sept, { inicio_en: new Date('2026-09-25T18:00:00Z'), prueba_hasta: null, cancelada_en: null })).toEqual({ desde: '2026-09-25', hasta: '2026-09-30', dias: 6 });
  });
});

describe('fechas y dinero', () => {
  it('dinero con quetzal pegado, dos decimales y separador de miles', () => {
    expect(dinero(0)).toBe('Q0.00');
    expect(dinero(5)).toBe('Q0.05');
    expect(dinero(85000)).toBe('Q850.00');
    expect(dinero(123456)).toBe('Q1,234.56');
    expect(dinero(100000000)).toBe('Q1,000,000.00');
    expect(dinero(-250)).toBe('-Q2.50');
  });
  it('número de factura correlativo con ceros', () => {
    expect(numeroTexto(1)).toBe('SG-000001');
    expect(numeroTexto(1234567)).toBe('SG-1234567');
  });
  it('sumar días cruza mes, año y bisiesto sin depender de la zona del servidor', () => {
    expect(sumarDias('2028-02-28', 2)).toBe('2028-03-01');
    expect(sumarDias('2027-02-28', 1)).toBe('2027-03-01');
    expect(sumarDias('2026-12-25', 10)).toBe('2027-01-04');
  });
  it('mes anterior y días del mes', () => {
    expect(mesAnterior({ anio: 2027, mes: 1 })).toEqual({ anio: 2026, mes: 12 });
    expect(diasDelMes({ anio: 2028, mes: 2 })).toBe(29);
    expect(diasDelMes({ anio: 2027, mes: 2 })).toBe(28);
  });
  it('fechaEnGuatemala', () => {
    expect(fechaEnGuatemala('2026-10-01T05:59:59Z')).toBe('2026-09-30');
    expect(fechaEnGuatemala('2026-10-01T06:00:00Z')).toBe('2026-10-01');
  });
});

describe('configFacturacion', () => {
  const previo = { ...process.env };
  afterEach(() => { process.env = { ...previo }; });
  it('valores por defecto y sobreescritura por entorno', () => {
    delete process.env.SAAS_DIAS_PAGO; delete process.env.SAAS_DIAS_GRACIA;
    expect(configFacturacion()).toEqual({ diasPago: 10, diasGracia: 5 });
    process.env.SAAS_DIAS_PAGO = '15'; process.env.SAAS_DIAS_GRACIA = '0';
    expect(configFacturacion()).toEqual({ diasPago: 15, diasGracia: 0 });
  });
  it('un valor inválido no rompe: vuelve al defecto', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.SAAS_DIAS_PAGO = 'diez'; process.env.SAAS_DIAS_GRACIA = '-3';
    expect(configFacturacion()).toEqual({ diasPago: 10, diasGracia: 5 });
  });
});

describe('proveedores de cobro', () => {
  const sol = { facturaId: 'f', numero: 1, empresaId: 'e', totalCentavos: 1000, moneda: 'GTQ' };
  const manual = new ProveedorCobroManual();
  const previo = { ...process.env };
  afterEach(() => { process.env = { ...previo }; });

  it('manual: transferencia y depósito exigen referencia; efectivo no', async () => {
    await expect(manual.confirmarPago(sol, { metodo: 'transferencia' })).rejects.toBeInstanceOf(ErrorCobro);
    await expect(manual.confirmarPago(sol, { metodo: 'deposito', referencia: '   ' })).rejects.toBeInstanceOf(ErrorCobro);
    expect(await manual.confirmarPago(sol, { metodo: 'transferencia', referencia: ' BAC-123 ', nota: ' ok ' })).toEqual({ referencia: 'BAC-123', metodo: 'transferencia', nota: 'ok' });
    expect(await manual.confirmarPago(sol, { metodo: 'efectivo' })).toEqual({ referencia: null, metodo: 'efectivo', nota: null });
  });
  it('manual: método desconocido y textos largos se rechazan', async () => {
    await expect(manual.confirmarPago(sol, { metodo: 'bitcoin' as never })).rejects.toThrow(/método/);
    await expect(manual.confirmarPago(sol, { metodo: 'otro', referencia: 'x'.repeat(101) })).rejects.toThrow(/referencia/);
    await expect(manual.confirmarPago(sol, { metodo: 'otro', nota: 'x'.repeat(301) })).rejects.toThrow(/nota/);
  });
  it('visanet es un punto de enchufe: falla de forma controlada', async () => {
    const v = new ProveedorCobroVisanet();
    expect(v.automatico).toBe(true);
    await expect(v.confirmarPago(sol, { metodo: 'otro' })).rejects.toBeInstanceOf(ProveedorNoConfiguradoError);
  });
  it('el selector usa manual por defecto, acepta visanet y no traga un nombre desconocido', () => {
    delete process.env.COBRO_PROVEEDOR;
    expect(obtenerProveedorCobro().nombre).toBe('manual');
    process.env.COBRO_PROVEEDOR = ' VISANET ';
    expect(obtenerProveedorCobro().nombre).toBe('visanet');
    process.env.COBRO_PROVEEDOR = 'stripe';
    expect(() => obtenerProveedorCobro()).toThrow(/stripe/);
  });
});
