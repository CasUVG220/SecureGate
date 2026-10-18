/**
 * Placas guatemaltecas en el sidecar del ANPR: **copia en JavaScript** de `desktop/src/lib/placa.ts` (la que usa la captura por
 * clic en la pantalla de la garita). Mismo formato, mismas correcciones por posición, mismo puntaje.
 *
 * Por qué una copia y no la misma fuente: el sidecar es Node CommonJS empaquetado aparte y no compila TypeScript. Para que no se
 * separen, `desktop/src/lib/__tests__/placa.paridad.test.ts` compara las dos sobre el mismo corpus: si alguien cambia una sin la
 * otra, esa prueba falla.
 *
 * Formato vigente: prefijo de 1-3 letras + 3 dígitos + 3 letras (`P 123ABC`); canónica `P123ABC`. Las confusiones del OCR (O/0,
 * I/1, B/8, S/5, G/6, Z/2…) se corrigen por posición y se CUENTAN: una lectura corregida nunca abre sola (ver docs/anpr_continuo.md).
 */
'use strict';

const PREFIJOS_CONOCIDOS = Object.freeze(['P', 'C', 'M', 'A', 'O', 'U', 'E', 'CC', 'CD', 'MI', 'TC', 'TRC', 'TA', 'TP']);

const A_DIGITO = Object.freeze({ O: '0', D: '0', Q: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' });
const A_LETRA = Object.freeze({ 0: 'O', 1: 'I', 8: 'B', 5: 'S', 6: 'G', 2: 'Z', 4: 'A', 7: 'T' });

const PLACA_RE = /^([A-Z]{1,3})(\d{3})([A-Z]{3})$/;
const UMBRAL_CONFIANZA = 0.85;

/** Sólo A-Z y 0-9, en mayúsculas. */
const normalizar = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** `P123ABC` → `P-123ABC`. */
const formatear = (placa) => {
  const m = PLACA_RE.exec(normalizar(placa));
  return m ? `${m[1]}-${m[2]}${m[3]}` : normalizar(placa);
};

const esValida = (s) => PLACA_RE.test(normalizar(s));

function corregir(chars, quiereDigito) {
  let n = 0;
  const out = chars
    .split('')
    .map((c) => {
      const esDigito = /\d/.test(c);
      if (quiereDigito === esDigito) return c;
      const mapa = quiereDigito ? A_DIGITO : A_LETRA;
      if (mapa[c]) { n++; return mapa[c]; }
      return c;
    })
    .join('');
  return { out, n };
}

/** Candidatos a partir de un texto (ya normalizado o no). */
function candidatosDe(texto, confianza) {
  const s = normalizar(texto);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    for (const pl of [3, 2, 1]) {
      const fin = i + pl + 6;
      if (fin > s.length) continue;
      const pre = corregir(s.slice(i, i + pl), false);
      const dig = corregir(s.slice(i + pl, i + pl + 3), true);
      const let_ = corregir(s.slice(i + pl + 3, fin), false);
      const placa = pre.out + dig.out + let_.out;
      if (!PLACA_RE.test(placa)) continue;
      const correcciones = pre.n + dig.n + let_.n;
      const prefijoConocido = PREFIJOS_CONOCIDOS.includes(pre.out);
      out.push({
        placa,
        formateada: formatear(placa),
        valida: true,
        prefijoConocido,
        correcciones,
        confianza,
        requiereRevision: !prefijoConocido || correcciones > 0 || confianza < UMBRAL_CONFIANZA,
      });
    }
  }
  return out;
}

const puntaje = (c) => (c.prefijoConocido ? 100 : 0) - c.correcciones * 10 + c.confianza * 5 - (c.placa.length - 7) * 2;

/** La mejor placa entre los fragmentos del OCR (cada uno y todos juntos); si nada sirve, el texto crudo marcado inválido. */
function mejorCandidato(items, textoCrudo = '') {
  const fragmentos = items.filter((i) => normalizar(i.texto).length > 0);
  const candidatos = [
    ...fragmentos.flatMap((f) => candidatosDe(f.texto, f.confianza)),
    ...candidatosDe(
      fragmentos.map((f) => f.texto).join(''),
      fragmentos.length ? Math.min(...fragmentos.map((f) => f.confianza)) : 0,
    ),
  ];
  const porPlaca = new Map();
  for (const c of candidatos) {
    const prev = porPlaca.get(c.placa);
    if (!prev || puntaje(c) > puntaje(prev)) porPlaca.set(c.placa, c);
  }
  const ordenados = [...porPlaca.values()].sort((a, b) => puntaje(b) - puntaje(a));
  if (ordenados.length) return ordenados[0];

  const crudo = [...fragmentos.map((f) => f.texto), textoCrudo]
    .map(normalizar)
    .sort((a, b) => b.length - a.length)[0] ?? '';
  return {
    placa: crudo,
    formateada: crudo,
    valida: false,
    prefijoConocido: false,
    correcciones: 0,
    confianza: fragmentos.length ? Math.max(...fragmentos.map((f) => f.confianza)) : 0,
    requiereRevision: true,
  };
}

module.exports = { PREFIJOS_CONOCIDOS, PLACA_RE, UMBRAL_CONFIANZA, normalizar, formatear, esValida, candidatosDe, mejorCandidato };
