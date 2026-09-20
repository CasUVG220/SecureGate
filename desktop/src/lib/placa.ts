/**
 * Placas guatemaltecas: normalización, validación y selección del mejor
 * candidato a partir del texto crudo del OCR.
 *
 * Formato vigente: prefijo de 1-3 letras (tipo de vehículo) + 3 dígitos + 3
 * letras, p. ej. `P 123ABC`, `C-458DFG`, `CD 004ABC`. Se acepta sin
 * separadores y se presenta canónico como `P123ABC`.
 *
 * El OCR confunde pares como O/0, I/1, B/8, S/5, G/6, Z/2. Como la posición
 * de cada carácter fija si debe ser letra o dígito, se corrigen esas
 * confusiones por posición y se cuenta cuántas hicieron falta: cada
 * corrección baja la confianza y obliga a revisión manual.
 */

/** Prefijos en uso (SAT). `P` particular, `C` comercial, `M` moto, `A` alquiler,
 *  `O` oficial, `U` uso agrícola/industrial, `CC/CD` consular/diplomático,
 *  `MI` misión internacional, `TC/TRC` transporte, `E` especial. */
export const PREFIJOS_CONOCIDOS = ['P', 'C', 'M', 'A', 'O', 'U', 'E', 'CC', 'CD', 'MI', 'TC', 'TRC', 'TA', 'TP'] as const;

const A_DIGITO: Record<string, string> = { O: '0', D: '0', Q: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };
const A_LETRA: Record<string, string> = { '0': 'O', '1': 'I', '8': 'B', '5': 'S', '6': 'G', '2': 'Z', '4': 'A', '7': 'T' };

export const PLACA_RE = /^([A-Z]{1,3})(\d{3})([A-Z]{3})$/;

/** Sólo A-Z y 0-9, en mayúsculas. */
export const normalizar = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** `P123ABC` → `P-123ABC` (forma legible para el agente). */
export const formatear = (placa: string): string => {
  const m = PLACA_RE.exec(normalizar(placa));
  return m ? `${m[1]}-${m[2]}${m[3]}` : normalizar(placa);
};

export const esValida = (s: string): boolean => PLACA_RE.test(normalizar(s));

export interface CandidatoPlaca {
  placa: string;
  /** Con separador, para mostrar. */
  formateada: string;
  valida: boolean;
  prefijoConocido: boolean;
  /** Cuántos caracteres se corrigieron por confusión OCR (0 = literal). */
  correcciones: number;
  /** Confianza del OCR para el fragmento del que salió (0-1). */
  confianza: number;
  /** Si el agente debe confirmar/editar antes de aceptar. */
  requiereRevision: boolean;
}

interface Fragmento {
  texto: string;
  confianza: number;
}

const corregir = (chars: string, quiereDigito: boolean): { out: string; n: number } => {
  let n = 0;
  const out = chars
    .split('')
    .map(c => {
      const esDigito = /\d/.test(c);
      if (quiereDigito === esDigito) return c;
      const mapa = quiereDigito ? A_DIGITO : A_LETRA;
      if (mapa[c]) { n++; return mapa[c]; }
      return c; // no corregible: el regex lo rechazará
    })
    .join('');
  return { out, n };
};

export const UMBRAL_CONFIANZA = 0.85;

/** Genera candidatos a partir de un texto ya normalizado. */
export function candidatosDe(texto: string, confianza: number): CandidatoPlaca[] {
  const s = normalizar(texto);
  const out: CandidatoPlaca[] = [];
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
      const prefijoConocido = (PREFIJOS_CONOCIDOS as readonly string[]).includes(pre.out);
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

const puntaje = (c: CandidatoPlaca): number =>
  (c.prefijoConocido ? 100 : 0) - c.correcciones * 10 + c.confianza * 5 - (c.placa.length - 7) * 2;

/**
 * Elige la mejor placa entre los fragmentos que devolvió el OCR. Prueba
 * primero cada fragmento por separado y luego todos concatenados (el detector
 * suele partir `P 123ABC` en dos cajas).
 *
 * Si nada tiene forma de placa devuelve el texto crudo más largo marcado como
 * inválido: el agente lo corrige a mano en vez de perder la captura.
 */
export function mejorCandidato(items: Fragmento[], textoCrudo = ''): CandidatoPlaca {
  const fragmentos = items.filter(i => normalizar(i.texto).length > 0);
  const candidatos = [
    ...fragmentos.flatMap(f => candidatosDe(f.texto, f.confianza)),
    ...candidatosDe(
      fragmentos.map(f => f.texto).join(''),
      fragmentos.length ? Math.min(...fragmentos.map(f => f.confianza)) : 0,
    ),
  ];
  // Dedupe por placa, quedándose con el mejor puntaje de cada una.
  const porPlaca = new Map<string, CandidatoPlaca>();
  for (const c of candidatos) {
    const prev = porPlaca.get(c.placa);
    if (!prev || puntaje(c) > puntaje(prev)) porPlaca.set(c.placa, c);
  }
  const ordenados = [...porPlaca.values()].sort((a, b) => puntaje(b) - puntaje(a));
  if (ordenados.length) return ordenados[0];

  const crudo = [...fragmentos.map(f => f.texto), textoCrudo]
    .map(normalizar)
    .sort((a, b) => b.length - a.length)[0] ?? '';
  return {
    placa: crudo,
    formateada: crudo,
    valida: false,
    prefijoConocido: false,
    correcciones: 0,
    confianza: fragmentos.length ? Math.max(...fragmentos.map(f => f.confianza)) : 0,
    requiereRevision: true,
  };
}
