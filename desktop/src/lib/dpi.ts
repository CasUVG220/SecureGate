/**
 * Textos de la lectura del DPI (T5). El OCR local deja motivos técnicos; aquí se pasan a frases que entiende el agente
 * («revisa el número contra el documento»), sin jerga y sin repetir el dato personal.
 */
import type { OrigenDpi, ResultadoDpi } from './tauri';

const MOTIVOS: Record<string, string> = {
  cui_corregido: 'Había caracteres dudosos en el número (por ejemplo una letra donde va un dígito) y se corrigieron.',
  cui_invalido: 'El número no tiene el formato de un DPI de 13 dígitos.',
  cui_no_encontrado: 'No se encontró el número del DPI.',
  cui_confianza_baja: 'El número se leyó con poca seguridad.',
  nombres_corregido: 'Se corrigieron caracteres dudosos en los nombres.',
  apellidos_corregido: 'Se corrigieron caracteres dudosos en los apellidos.',
  nombres_no_encontrado: 'No se encontraron los nombres.',
  apellidos_no_encontrado: 'No se encontraron los apellidos.',
  nombres_por_posicion: 'Los nombres se adivinaron por su lugar en el documento.',
  apellidos_por_posicion: 'Los apellidos se adivinaron por su lugar en el documento.',
  nombres_confianza_baja: 'Los nombres se leyeron con poca seguridad.',
  apellidos_confianza_baja: 'Los apellidos se leyeron con poca seguridad.',
  lectura_remota_sin_confianza: 'La lectura remota no indica qué tan segura es.',
};

/** Frases para el agente, sin duplicados y sin motivos desconocidos (esos se resumen en una frase general). */
export function textosRevision(r: Pick<ResultadoDpi, 'motivos'>): string[] {
  const frases = new Set<string>();
  let desconocido = false;
  for (const m of r.motivos) {
    if (MOTIVOS[m]) frases.add(MOTIVOS[m]); else desconocido = true;
  }
  if (desconocido) frases.add('Algunos datos se leyeron con dudas.');
  return [...frases];
}

export const ETIQUETA_ORIGEN: Record<OrigenDpi, string> = {
  local: 'leído en este equipo',
  remoto: 'leído por el servicio remoto',
  manual: 'capturado manualmente',
};

/** Lo que se muestra tras leer un DPI: de dónde salió y si hay que confirmarlo. Nunca incluye el número ni el nombre. */
export function resumenLectura(r: ResultadoDpi): string {
  const base = `DPI ${ETIQUETA_ORIGEN[r.origen]}.`;
  return r.revision_obligatoria
    ? `${base} Compara el número y el nombre con el documento y confírmalos antes de registrar.`
    : `${base} Revisa el número y el nombre antes de registrar.`;
}
