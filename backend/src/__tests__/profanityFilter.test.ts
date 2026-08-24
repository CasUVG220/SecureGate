/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * censurarTexto() es el único filtro de contenido en el chat de tickets
 * (residente ↔ admin). Un falso negativo deja pasar groserías al otro lado;
 * un falso positivo censura texto legítimo (ej. "clase", "pasar") y rompe la
 * comunicación. La detección debe ser insensible a mayúsculas/acentos pero
 * respetar límites de palabra completa.
 */
import { censurarTexto, contieneProfanidad } from '../utils/profanityFilter';

describe('censurarTexto', () => {
  it('censura groserías en español, preservando el resto del mensaje', () => {
    expect(censurarTexto('Eres un pendejo de mierda')).toBe('Eres un ******* de ******');
  });

  it('detecta groserías sin importar mayúsculas o acentos', () => {
    expect(censurarTexto('CABRÓN arregla esto')).toBe('****** arregla esto');
    expect(censurarTexto('cabron arregla esto')).toBe('****** arregla esto');
  });

  it('detecta groserías cuya forma normalizada difiere del original (ej. ñ)', () => {
    expect(censurarTexto('qué coño pasa aquí')).toBe('qué **** pasa aquí');
  });

  it('censura groserías en inglés', () => {
    expect(censurarTexto('This is fucking ridiculous, you asshole'))
      .toBe('This is ******* ridiculous, you *******');
  });

  it('no toca mensajes sin groserías', () => {
    const limpio = 'Buenas tardes, tengo un problema con mi pago de este mes.';
    expect(censurarTexto(limpio)).toBe(limpio);
  });

  it('no genera falsos positivos dentro de palabras que sólo contienen la subcadena', () => {
    expect(censurarTexto('passwordless login')).toBe('passwordless login');
    expect(censurarTexto('classic problem with the class')).toBe('classic problem with the class');
  });
});

describe('contieneProfanidad', () => {
  it('devuelve true cuando hay al menos una grosería', () => {
    expect(contieneProfanidad('puta madre, otra vez sin agua')).toBe(true);
  });

  it('devuelve false para texto limpio', () => {
    expect(contieneProfanidad('La chapa está dañada, necesito ayuda por favor')).toBe(false);
  });
});
