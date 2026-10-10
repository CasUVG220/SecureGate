import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hoyEnZona, formatearDia, formatearDiaMes, formatearDiaSemana, formatearFecha, formatearFechaHora, formatearFechaHoraCorta,
  formatearFechaLarga, formatearHora, formatearRangoDias, idiomaActual, ZONA_APP,
} from '../fecha';

afterEach(() => { vi.unstubAllEnvs(); try { localStorage.removeItem('language'); } catch { /* sin storage */ } });

describe('instantes: siempre en la zona de la aplicación', () => {
  it('usa America/Guatemala (UTC-6, sin horario de verano), no la del navegador', () => {
    expect(ZONA_APP).toBe('America/Guatemala');
    // 2026-11-01T02:30Z ya es 31 de octubre a las 20:30 en Guatemala.
    expect(formatearFecha('2026-11-01T02:30:00Z')).toBe('31 oct 2026');
    expect(formatearHora('2026-11-01T02:30:00Z')).toBe('20:30');
    expect(formatearFechaHora('2026-11-01T02:30:00Z')).toBe('31 oct 2026, 20:30');
    // Mediodía en Guatemala = 18:00Z
    expect(formatearFecha('2026-11-01T18:00:00Z')).toBe('1 nov 2026');
  });

  it('da el mismo resultado sin importar el TZ del proceso', () => {
    for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo', 'America/Guatemala']) {
      vi.stubEnv('TZ', tz);
      expect(formatearFechaHora('2026-03-15T23:05:00Z'), tz).toBe('15 mar 2026, 17:05');
    }
  });

  it('formato explícito: día, mes abreviado y año; 24 horas', () => {
    expect(formatearFecha('2026-11-01T18:00:00Z')).toBe('1 nov 2026');
    expect(formatearFecha('2026-09-05T18:00:00Z')).toBe('5 sep 2026');      // siempre «sep», nunca «sept.»
    expect(formatearHora('2026-11-01T21:07:09Z')).toBe('15:07');
    expect(formatearHora('2026-11-01T21:07:09Z', true)).toBe('15:07:09');
    expect(formatearHora('2026-11-01T06:00:00Z')).toBe('00:00');             // medianoche, no «24:00»
    expect(formatearFechaHoraCorta('2026-11-01T21:07:00Z')).toBe('1 nov, 15:07');
  });

  it('en inglés: Nov 1, 2026', () => {
    expect(formatearFecha('2026-11-01T18:00:00Z', 'en')).toBe('Nov 1, 2026');
    expect(formatearFechaHoraCorta('2026-11-01T21:07:00Z', 'en')).toBe('Nov 1, 15:07');
  });

  it('toma el idioma guardado cuando no se pasa', () => {
    localStorage.setItem('language', 'en');
    expect(idiomaActual()).toBe('en');
    expect(formatearFecha('2026-11-01T18:00:00Z')).toBe('Nov 1, 2026');
    localStorage.setItem('language', 'es');
    expect(formatearFecha('2026-11-01T18:00:00Z')).toBe('1 nov 2026');
  });

  it('acepta Date y milisegundos', () => {
    expect(formatearFecha(new Date('2026-11-01T18:00:00Z'))).toBe('1 nov 2026');
    expect(formatearFecha(Date.parse('2026-11-01T18:00:00Z'))).toBe('1 nov 2026');
  });

  it('fecha larga de encabezado', () => {
    expect(formatearFechaLarga('2026-09-24T18:00:00Z')).toBe('jueves, 24 de septiembre');
    expect(formatearFechaLarga('2026-09-24T18:00:00Z', 'en')).toBe('Thursday, September 24');
  });

  it.each([null, undefined, '', 'no-es-fecha', NaN])('valor inválido %p → «—», nunca «Invalid Date»', v => {
    expect(formatearFecha(v as never)).toBe('—');
    expect(formatearHora(v as never)).toBe('—');
    expect(formatearFechaHora(v as never)).toBe('—');
    expect(formatearFechaHoraCorta(v as never)).toBe('—');
    expect(formatearFechaLarga(v as never)).toBe('—');
    expect(formatearDia(v as never)).toBe('—');
  });
});

describe('días de calendario (DATE): no se mueven de día por la zona', () => {
  it('medianoche UTC sigue siendo ese día (en Guatemala sería el anterior)', () => {
    expect(formatearDia('2026-12-10T00:00:00.000Z')).toBe('10 dic 2026');
    expect(formatearFecha('2026-12-10T00:00:00.000Z')).toBe('9 dic 2026');     // por eso son funciones distintas
  });

  it('medianoche local de Guatemala (06:00Z), como la entrega pg para un DATE, también', () => {
    expect(formatearDia('2026-12-10T06:00:00.000Z')).toBe('10 dic 2026');
  });

  it('acepta AAAA-MM-DD a secas y rechaza fechas imposibles', () => {
    expect(formatearDia('2026-01-05')).toBe('5 ene 2026');
    expect(formatearDia('2026-13-40')).toBe('—');
    expect(formatearDiaMes('2026-01-05')).toBe('5 ene');
    expect(formatearDiaMes('2026-01-05', 'en')).toBe('Jan 5');
  });

  it('día de la semana abreviado', () => {
    expect(formatearDiaSemana('2026-09-02')).toBe('mié, 2 sep');
    expect(formatearDiaSemana('2026-09-02', 'en')).toBe('Wed, Sep 2');
  });

  it('rangos: el año solo al final, una vez si coincide', () => {
    expect(formatearRangoDias('2026-09-03', '2026-10-02')).toBe('3 sep – 2 oct 2026');
    expect(formatearRangoDias('2025-12-20', '2026-01-10')).toBe('20 dic 2025 – 10 ene 2026');
    expect(formatearRangoDias('2026-09-03', '2026-09-03')).toBe('3 sep 2026');
    expect(formatearRangoDias('2026-09-03', null)).toBe('—');
  });
});

describe('hoyEnZona', () => {
  it('es el día de Guatemala, no el de UTC (a las 7 pm locales UTC ya está en «mañana»)', () => {
    expect(hoyEnZona(new Date('2026-10-10T01:00:00Z'))).toBe('2026-10-09');   // 7 pm del 9 en Guatemala
    expect(hoyEnZona(new Date('2026-10-10T05:59:00Z'))).toBe('2026-10-09');
    expect(hoyEnZona(new Date('2026-10-10T06:00:00Z'))).toBe('2026-10-10');   // medianoche local
    expect(hoyEnZona(new Date('2026-12-31T23:30:00Z'))).toBe('2026-12-31');
    expect(hoyEnZona(new Date('2027-01-01T05:00:00Z'))).toBe('2026-12-31');   // el año nuevo llega a las 06:00Z
  });
});
