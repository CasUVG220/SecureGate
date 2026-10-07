import { describe, it, expect } from 'vitest';
import { DosPasosError } from '../services/api';
import { mensajeDosPasos, textoCodigosRecuperacion } from '../utils/dosPasos';
import { translations } from '../i18n/translations';

const t = (clave: string, respaldo?: string) => translations.es[clave] ?? respaldo ?? clave;
const tEn = (clave: string, respaldo?: string) => translations.en[clave] ?? respaldo ?? clave;

describe('mensajeDosPasos', () => {
  it('traduce los códigos de error del backend al idioma elegido', () => {
    expect(mensajeDosPasos(new DosPasosError('x', 'CODIGO_INCORRECTO', 400), t)).toMatch(/El código no es correcto/);
    expect(mensajeDosPasos(new DosPasosError('x', 'CODIGO_INCORRECTO', 400), tEn)).toMatch(/That code is not correct/);
    expect(mensajeDosPasos(new DosPasosError('x', 'PASSWORD_INCORRECTA', 400), t)).toBe('La contraseña no es correcta.');
    expect(mensajeDosPasos(new DosPasosError('x', 'DESAFIO_INVALIDO', 401), t)).toMatch(/venció/);
  });

  it('el bloqueo dice los minutos de espera (redondeados hacia arriba, mínimo 1)', () => {
    expect(mensajeDosPasos(new DosPasosError('x', 'BLOQUEADO', 429, 900), t)).toContain('15 minutos');
    expect(mensajeDosPasos(new DosPasosError('x', 'BLOQUEADO', 429, 61), t)).toContain('2 minutos');
    expect(mensajeDosPasos(new DosPasosError('x', 'BLOQUEADO', 429, 5), t)).toContain('1 minutos');
    expect(mensajeDosPasos(new DosPasosError('x', 'BLOQUEADO', 429), t)).toContain('15 minutos');
  });

  it('un código desconocido cae al mensaje del servidor; sin mensaje, a uno genérico', () => {
    expect(mensajeDosPasos(new DosPasosError('Ya está activa', 'YA_ACTIVA', 409), t)).toBe('Ya está activa');
    expect(mensajeDosPasos(new DosPasosError('', 'OTRO', 500), t)).toBe(translations.es['twofa.err.generic']);
    expect(mensajeDosPasos(new Error('Sin conexión'), t)).toBe('Sin conexión');
    expect(mensajeDosPasos('algo', t)).toBe(translations.es['twofa.err.generic']);
  });
});

describe('textoCodigosRecuperacion', () => {
  it('lleva el correo, la advertencia y un código por línea', () => {
    const texto = textoCodigosRecuperacion(['AAAAA-BBBBB', 'CCCCC-DDDDD'], 'ana@empresa.com', t);
    const lineas = texto.split('\n');
    expect(lineas[0]).toBe('SecureGate — códigos de recuperación de ana@empresa.com');
    expect(texto).toContain('Cada código sirve una sola vez');
    expect(lineas).toContain('AAAAA-BBBBB');
    expect(lineas).toContain('CCCCC-DDDDD');
  });
});
