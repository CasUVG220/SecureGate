/**
 * Censura de groserías para el chat de tickets (residente ↔ admin).
 * Detección por palabra completa, insensible a mayúsculas/acentos — no intenta
 * cubrir evasión con leetspeak (0/1/@...), sólo el uso normal del idioma.
 */

const PALABRAS_ES = [
  'mierda', 'mierdas', 'puta', 'putas', 'puto', 'putos', 'puteria',
  'cabron', 'cabrones', 'cabrona', 'cabronas',
  'pendejo', 'pendejos', 'pendeja', 'pendejas', 'pendejada', 'pendejadas',
  'verga', 'vergas', 'chinga', 'chingar', 'chingada', 'chingado', 'chingados', 'chingue', 'chingues',
  'joder', 'jodido', 'jodida', 'jodidos', 'jodidas',
  'coño', 'gilipollas', 'maricon', 'maricones', 'marica',
  'pinche', 'pinches', 'culero', 'culeros', 'culera',
  'imbecil', 'imbeciles', 'idiota', 'idiotas', 'estupido', 'estupidos', 'estupida', 'estupidas',
  'perra', 'perras', 'zorra', 'zorras', 'cerdo', 'cerdos',
  'hijueputa', 'hijoeputa', 'hpta',
];

const PALABRAS_EN = [
  'fuck', 'fucking', 'fucked', 'fucker', 'fuckers', 'motherfucker', 'motherfuckers',
  'shit', 'shitty', 'bullshit',
  'bitch', 'bitches', 'bastard', 'bastards',
  'asshole', 'assholes', 'dumbass', 'jackass',
  'cunt', 'cunts', 'dick', 'dickhead', 'prick',
  'slut', 'sluts', 'whore', 'whores',
  'retard', 'retarded', 'moron', 'morons',
];

const stripDiacritics = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '');

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildPattern = (): RegExp => {
  // Las palabras también se normalizan (sin acentos) porque se comparan
  // contra el texto ya normalizado — si no, "coño" nunca matchearía "cono".
  const todas = [...PALABRAS_ES, ...PALABRAS_EN].map(w => escapeRegExp(stripDiacritics(w)));
  return new RegExp(`\\b(?:${todas.join('|')})\\b`, 'gi');
};

const PATRON = buildPattern();

/**
 * Reemplaza cada mala palabra encontrada en `texto` por asteriscos del mismo
 * largo, preservando el resto del mensaje intacto (mayúsculas, acentos,
 * puntuación). La detección corre sobre una versión normalizada (minúsculas,
 * sin acentos) que se mantiene alineada en longitud con el texto original.
 */
export function censurarTexto(texto: string): string {
  const normalizado = stripDiacritics(texto).toLowerCase();
  PATRON.lastIndex = 0;
  let resultado = '';
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = PATRON.exec(normalizado)) !== null) {
    resultado += texto.slice(cursor, match.index);
    resultado += '*'.repeat(match[0].length);
    cursor = match.index + match[0].length;
  }
  resultado += texto.slice(cursor);
  return resultado;
}

export function contieneProfanidad(texto: string): boolean {
  const normalizado = stripDiacritics(texto).toLowerCase();
  PATRON.lastIndex = 0;
  return PATRON.test(normalizado);
}
