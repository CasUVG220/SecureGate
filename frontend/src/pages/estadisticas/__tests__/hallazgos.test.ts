import { describe, expect, it } from 'vitest';
import { translations } from '../../../i18n/translations';
import { calcularHallazgos, franjaPico, rellenar } from '../hallazgos';
import { estadisticasFixture } from './fixture';

const t = (k: string, f?: string) => translations.es[k] ?? f ?? k;
const textos = (e = estadisticasFixture()) => calcularHallazgos(e, t, 'es').map(h => h.texto);

describe('calcularHallazgos', () => {
  it('traduce los números del periodo a frases', () => {
    const out = textos();
    expect(out).toContain('Las visitas subieron 25% frente al periodo anterior (125 contra 100).');
    expect(out).toContain('El momento de más movimiento es el sábado entre 18:00 y 19:00: conviene tener la garita reforzada a esa hora.');
    expect(out).toContain('Se recaudaron Q2,400, 20% menos que en el periodo anterior.');
    expect(out).toContain('2 pagos por Q750 esperan verificación.');
    expect(out).toContain('3 residentes en mora (15% del padrón); el saldo pendiente total es Q1,350.');
    expect(out).toContain('2 solicitudes del periodo siguen abiertas, sin atender.');
  });

  it('usa el singular cuando corresponde', () => {
    const e = estadisticasFixture();
    e.cartera.mora = 1;
    e.solicitudes.por_estado.abierto = 1;
    e.pagos.por_estado.pendiente = { cantidad: 1, monto: 300 };
    const out = textos(e);
    expect(out.some(x => x.startsWith('Un residente en mora'))).toBe(true);
    expect(out).toContain('Una solicitud del periodo sigue abierta, sin atender.');
    expect(out).toContain('Un pago por Q300 espera verificación.');
  });

  it('sin actividad no inventa tendencias ni hora pico', () => {
    const e = estadisticasFixture();
    e.accesos = { ...e.accesos, total: 0, total_anterior: 0, por_franja: Array.from({ length: 7 }, () => Array(24).fill(0)) };
    e.pagos = { ...e.pagos, recaudado: 0 };
    const hallazgos = calcularHallazgos(e, t, 'es');
    expect(hallazgos.find(h => h.id === 'visitas')?.texto).toBe('No hubo visitas registradas en este periodo.');
    expect(hallazgos.find(h => h.id === 'pico')).toBeUndefined();
    expect(hallazgos.find(h => h.id === 'recaudado')?.texto).toBe('No hubo pagos aprobados en este periodo.');
  });

  it('las alertas de seguridad llevan tono de peligro', () => {
    const e = estadisticasFixture();
    e.accesos.no_autorizados = 2;
    const h = calcularHallazgos(e, t, 'es').find(x => x.id === 'no-autorizados');
    expect(h).toEqual({ id: 'no-autorizados', tono: 'danger', texto: 'Hubo 2 entradas no autorizadas.' });
  });

  it('funciona en inglés', () => {
    const tEn = (k: string, f?: string) => translations.en[k] ?? f ?? k;
    const out = calcularHallazgos(estadisticasFixture(), tEn, 'en').map(h => h.texto);
    expect(out).toContain('Visits rose 25% versus the previous period (125 vs. 100).');
    expect(out[1]).toContain('Saturday between 18:00 and 19:00');
  });
});

describe('utilidades', () => {
  it('franjaPico devuelve la celda con más visitas', () => {
    expect(franjaPico(estadisticasFixture().accesos.por_franja)).toEqual({ dia: 5, hora: 18, total: 9 });
  });

  it('rellenar deja intactas las variables desconocidas', () => {
    expect(rellenar('{a} y {b}', { a: 1 })).toBe('1 y {b}');
  });
});

describe('traducciones', () => {
  it('es y en tienen exactamente las mismas claves de estadísticas', () => {
    const claves = (l: 'es' | 'en') => Object.keys(translations[l]).filter(k => k.startsWith('stats.')).sort();
    expect(claves('en')).toEqual(claves('es'));
  });
});
