/**
 * Extractor del DPI (T4, SCRUM-121): convierte las líneas que lee el OCR en CUI, nombres y apellidos, con confianza por
 * campo y la lista de correcciones hechas. Es una función PURA sobre los `items` del OCR (`{ texto, confianza, box }`):
 * se prueba sin modelos y sin imágenes, y no escribe ni imprime nada (el CUI y los nombres son datos personales).
 *
 * Qué hace
 *   1. CUI: busca la línea con 13 dígitos (formato impreso 4-5-4). Corrige confusiones POR POSICIÓN —en un CUI todo
 *      carácter es un dígito, así que una «O» es un 0, una «I» un 1, una «B» un 8, una «S» un 5…— y, si corrigió algo,
 *      exige revisión manual. Valida 13 dígitos y que los dos últimos pares sean departamento (01-22) y municipio.
 *   2. Nombres y apellidos: los ubica por las etiquetas bilingües («APELLIDOS / SURNAME», «NOMBRES / GIVEN NAMES») con
 *      coincidencia aproximada (el OCR las lee torcidas a menudo) y, si faltan, por el orden de las líneas. En un nombre
 *      todo carácter es una letra: un «0» es una «O», un «1» una «I»… (también exige revisión).
 *   3. Confianza por campo = la del OCR, rebajada por cada corrección o inferencia. Bajo el umbral → revisión obligatoria.
 *
 * Qué NO hace (pendiente, ver docs/ocr_dpi_local.md)
 *   - No verifica el dígito verificador del CUI (posición 9): no se conoce con certeza el algoritmo oficial y no se inventa.
 *     El resultado trae `verificador: 'no_verificado'`.
 *   - No valida el municipio contra el catálogo de cada departamento: solo exige 01-40 (ningún departamento tiene más de 33).
 *     El catálogo oficial de RENAP debe reemplazar esa cota.
 *   - La disposición supuesta (apellidos encima de nombres, CUI en 4-5-4) debe confirmarse con el conjunto REAL.
 */
'use strict';

// ── Umbrales (afinables con el conjunto real) ─────────────────────────────────────────────────────────────
const UMBRAL_CONFIANZA_CUI = 0.8;
const UMBRAL_CONFIANZA_NOMBRE = 0.65;
const PENALIZA_CORRECCION = 0.8;
const PENALIZA_POSICION = 0.7;
const PENALIZA_FORMATO = 0.5;
const MAX_DEPARTAMENTO = 22;
const MAX_MUNICIPIO = 40;

// ── Confusiones por posición ──────────────────────────────────────────────────────────────────────────────
/** Letra o símbolo que el OCR suele leer en lugar de un dígito, dentro de un CUI. */
const LETRA_A_DIGITO = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', '!': '1', Z: '2', S: '5', G: '6', B: '8' };
/** Dígito que el OCR suele leer en lugar de una letra, dentro de un nombre. */
const DIGITO_A_LETRA = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 6: 'G', 8: 'B' };

/** Mayúsculas sin tildes ni Ñ: el modelo de reconocimiento es del alfabeto latino básico. */
const plano = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// ── CUI ───────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Convierte un texto leído en la posición del CUI en dígitos. Devuelve `null` si no se parece a un CUI
 * (demasiadas letras que no son confusiones conocidas), o `{ digitos, correcciones }`.
 */
function corregirCui(texto) {
  const crudo = String(texto ?? '').replace(/[\s.\-_/]/g, '');
  if (crudo.length < 11 || crudo.length > 15) return null;
  let digitos = '';
  const correcciones = [];
  for (let i = 0; i < crudo.length; i++) {
    const c = plano(crudo[i]);
    if (/[0-9]/.test(c)) { digitos += c; continue; }
    const d = LETRA_A_DIGITO[c];
    if (d === undefined) return null;          // un carácter que no es dígito ni confusión conocida: no es un CUI
    digitos += d;
    correcciones.push({ campo: 'cui', posicion: i + 1, de: c, a: d });
  }
  // Un candidato con más de 3 correcciones es probablemente una palabra, no un CUI.
  if (correcciones.length > 3) return null;
  // Al menos 8 dígitos genuinos: evita que una palabra como «SOLO SOLO» pase por número.
  if (digitos.length - correcciones.length < 8) return null;
  return { digitos, correcciones };
}

/** Valida el CUI ya en dígitos. No verifica el dígito verificador (algoritmo oficial no verificado). */
function validarCui(digitos) {
  const problemas = [];
  if (!/^\d{13}$/.test(digitos)) {
    problemas.push('longitud');
    return { valido: false, problemas, verificador: 'no_verificado' };
  }
  const depto = Number(digitos.slice(9, 11));
  const muni = Number(digitos.slice(11, 13));
  if (depto < 1 || depto > MAX_DEPARTAMENTO) problemas.push('departamento');
  if (muni < 1 || muni > MAX_MUNICIPIO) problemas.push('municipio');
  return { valido: problemas.length === 0, problemas, departamento: depto, municipio: muni, verificador: 'no_verificado' };
}

const conGuiones = (d) => (d.length === 13 ? `${d.slice(0, 4)} ${d.slice(4, 9)} ${d.slice(9)}` : d);

/** ¿El texto tiene la forma impresa 4-5-4 (tres grupos)? */
const formato454 = (texto) => /^\s*\S{4}\s+\S{5}\s+\S{4}\s*$/.test(String(texto ?? ''));

/**
 * Une los fragmentos que el OCR separó en una misma línea (el CUI sale a menudo como «7093» «67348» «1002», tres
 * detecciones). Dos fragmentos son de la misma línea si sus centros verticales difieren menos de media altura y el hueco
 * entre ellos es corto. Devuelve líneas `{ texto, confianza (la mínima), box (la unión) }`; las de un solo fragmento no se repiten.
 */
function agruparLineas(items) {
  const conBox = items.filter((i) => i.box).sort((a, b) => a.box.x - b.box.x);
  const lineas = [];
  for (const it of conBox) {
    const linea = lineas.find((l) => {
      const ult = l.partes[l.partes.length - 1];
      const h = Math.max(it.box.h, ult.box.h);
      return Math.abs(cy(it) - cy(ult)) < h * 0.5 && it.box.x - (ult.box.x + ult.box.w) < h * 2.5 && it.box.x >= ult.box.x;
    });
    if (linea) linea.partes.push(it); else lineas.push({ partes: [it] });
  }
  return lineas.filter((l) => l.partes.length > 1).map((l) => {
    const xs = l.partes.map((p) => p.box.x), ys = l.partes.map((p) => p.box.y);
    const x2 = Math.max(...l.partes.map((p) => p.box.x + p.box.w)), y2 = Math.max(...l.partes.map((p) => p.box.y + p.box.h));
    return {
      texto: l.partes.map((p) => p.texto.trim()).join(' '),
      confianza: Math.min(...l.partes.map((p) => p.confianza)),
      box: { x: Math.min(...xs), y: Math.min(...ys), w: x2 - Math.min(...xs), h: y2 - Math.min(...ys) },
      partes: l.partes,
    };
  });
}

function elegirCui(items) {
  const candidatos = [];
  [...items, ...agruparLineas(items)].forEach((it, idx) => {
    const r = corregirCui(it.texto);
    if (!r) return;
    const v = validarCui(r.digitos);
    candidatos.push({ idx, it, ...r, ...v, f454: formato454(it.texto) });
  });
  // Mejor: 13 dígitos válidos > 13 dígitos > formato 4-5-4 > menos correcciones > más confianza.
  candidatos.sort((a, b) =>
    (b.valido - a.valido) || ((b.digitos.length === 13) - (a.digitos.length === 13)) || (b.f454 - a.f454) ||
    (a.correcciones.length - b.correcciones.length) || (b.it.confianza - a.it.confianza));
  return candidatos[0] ?? null;
}

// ── Etiquetas (coincidencia aproximada) ───────────────────────────────────────────────────────────────────
/** Distancia de edición mínima entre `patron` y cualquier subcadena de `texto` (algoritmo de Sellers). */
function distanciaSubcadena(patron, texto) {
  const m = patron.length;
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  let mejor = prev[m];
  for (let j = 1; j <= texto.length; j++) {
    const cur = [0];
    for (let i = 1; i <= m; i++) {
      cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + (patron[i - 1] === texto[j - 1] ? 0 : 1));
    }
    mejor = Math.min(mejor, cur[m]);
    prev = cur;
  }
  return mejor;
}

const ETIQUETAS = {
  apellidos: ['APELLIDOS', 'SURNAME'],
  nombres: ['NOMBRES', 'GIVEN NAMES'],
};

/** ¿Este texto es la etiqueta `clave`? Tolera ~1 error por cada 4 letras del patrón. */
function esEtiqueta(texto, clave) {
  const t = plano(texto).replace(/[^A-Z ]/g, '');
  if (t.length < 4) return false;
  const junto = t.replace(/ /g, '');             // el OCR a veces separa las letras de una etiqueta torcida («N O M B R E S»)
  return ETIQUETAS[clave].some((patron) => {
    const tope = Math.max(1, Math.floor(patron.length / 4));
    const sinEspacios = patron.replace(/ /g, '');
    return distanciaSubcadena(patron, t) <= tope || distanciaSubcadena(sinEspacios, junto) <= Math.max(1, Math.floor(sinEspacios.length / 4));
  });
}

/** Palabras de la tarjeta que NO son un nombre de persona. */
const PALABRAS_NO_NOMBRE = new Set([
  'REPUBLICA', 'GUATEMALA', 'DOCUMENTO', 'PERSONAL', 'IDENTIFICACION', 'EJEMPLO', 'FICTICIO', 'SOLO', 'PRUEBAS', 'FOTO', 'FECHA',
  'NACIMIENTO', 'NACIONALIDAD', 'NATIONALITY', 'GUATEMALTECA', 'GUATEMALTECO', 'SEXO', 'ESTADO', 'CIVIL', 'CUI', 'DPI',
  'APELLIDOS', 'SURNAME', 'NOMBRES', 'GIVEN', 'NAMES', 'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC',
]);

/** ¿Es una línea que parece nombre de persona? Letras y espacios, sin ser una etiqueta ni una frase de la tarjeta. */
function pareceNombre(texto) {
  const t = plano(texto).replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  if (t.length < 2) return false;
  if (/\d{3,}/.test(t)) return false;                                   // un número, no un nombre
  const palabras = t.split(' ').filter(Boolean);
  const conocidas = palabras.filter((p) => PALABRAS_NO_NOMBRE.has(p)).length;
  if (conocidas > 0 && conocidas >= Math.ceil(palabras.length / 2)) return false;
  if (esEtiqueta(texto, 'apellidos') || esEtiqueta(texto, 'nombres')) return false;
  const letras = (t.match(/[A-Z]/g) || []).length;
  return letras / t.replace(/ /g, '').length >= 0.7;                    // casi todo letras (se toleran 1-2 dígitos mal leídos)
}

/** Limpia un nombre: letras y espacios, corrigiendo dígitos que el OCR leyó en lugar de letras. */
function corregirNombre(texto) {
  const correcciones = [];
  let salida = '';
  const base = String(texto ?? '').normalize('NFC');
  let pos = 0;
  for (const ch of base) {
    pos++;
    if (/[0-9]/.test(ch)) {
      const l = DIGITO_A_LETRA[ch];
      if (l) { salida += l; correcciones.push({ campo: 'nombre', posicion: pos, de: ch, a: l }); }
      continue;                                                          // un dígito sin equivalente se descarta
    }
    if (/[\p{L} ]/u.test(ch)) salida += ch.toUpperCase();
    // signos de puntuación sueltos se descartan sin marcar corrección
  }
  return { texto: salida.replace(/\s+/g, ' ').trim(), correcciones };
}

// ── Geometría ─────────────────────────────────────────────────────────────────────────────────────────────
const cy = (it) => (it.box ? it.box.y + it.box.h / 2 : 0);
const izq = (it) => (it.box ? it.box.x : 0);

/**
 * El valor de una etiqueta es la línea con aspecto de nombre que está justo debajo de ella (misma columna, con
 * tolerancia para tarjetas torcidas) y antes de la siguiente etiqueta.
 */
function valorDebajo(etiqueta, candidatos, otrasEtiquetas) {
  const tolerancia = Math.max(70, (etiqueta.box?.w ?? 100) * 0.6);
  const limiteInferior = Math.min(...otrasEtiquetas.filter((o) => cy(o) > cy(etiqueta)).map(cy), Infinity);
  const posibles = candidatos
    .filter((c) => c !== etiqueta && cy(c) > cy(etiqueta) - (etiqueta.box?.h ?? 20) * 0.3 && cy(c) < limiteInferior + (etiqueta.box?.h ?? 20))
    .filter((c) => Math.abs(izq(c) - izq(etiqueta)) <= tolerancia)
    .sort((a, b) => cy(a) - cy(b));
  return posibles.find((c) => cy(c) > cy(etiqueta)) ?? posibles[0] ?? null;
}

// ── Extracción ────────────────────────────────────────────────────────────────────────────────────────────
/**
 * @param {Array<{texto:string, confianza:number, box?:{x:number,y:number,w:number,h:number}}>} itemsCrudos
 * @returns {{
 *   cui: string, cui_con_formato: string, cui_valido: boolean, cui_problemas: string[], departamento?: number, municipio?: number,
 *   verificador: 'no_verificado', nombres: string, apellidos: string,
 *   confianza: {cui:number, nombres:number, apellidos:number}, correcciones: Array<object>,
 *   revision_obligatoria: boolean, motivos: string[]
 * }}
 */
function extraerDpi(itemsCrudos) {
  const items = (itemsCrudos || []).filter((i) => i && typeof i.texto === 'string' && i.texto.trim());
  const motivos = [];
  const correcciones = [];

  // CUI
  const c = elegirCui(items);
  let cui = '', cuiValido = false, cuiProblemas = ['no_encontrado'], confCui = 0, departamento, municipio;
  if (c) {
    cui = c.digitos;
    cuiValido = c.valido;
    cuiProblemas = c.problemas;
    departamento = c.departamento;
    municipio = c.municipio;
    confCui = c.it.confianza;
    if (c.correcciones.length) { correcciones.push(...c.correcciones); confCui *= PENALIZA_CORRECCION; motivos.push('cui_corregido'); }
    if (!cuiValido) { confCui *= PENALIZA_FORMATO; motivos.push('cui_invalido'); }
  } else {
    motivos.push('cui_no_encontrado');
  }

  // Nombres y apellidos
  const usados = new Set(c ? [c.it, ...(c.it.partes || [])] : []);
  const etqApellidos = items.find((i) => !usados.has(i) && esEtiqueta(i.texto, 'apellidos'));
  const etqNombres = items.find((i) => !usados.has(i) && i !== etqApellidos && esEtiqueta(i.texto, 'nombres'));
  const etiquetas = [etqApellidos, etqNombres].filter(Boolean);
  const candidatos = items.filter((i) => !usados.has(i) && !etiquetas.includes(i) && pareceNombre(i.texto));

  let itApellidos = etqApellidos ? valorDebajo(etqApellidos, candidatos, etiquetas) : null;
  let itNombres = etqNombres ? valorDebajo(etqNombres, candidatos, etiquetas) : null;
  let porPosicionA = false, porPosicionN = false;
  // Sin etiqueta legible: por orden de aparición (apellidos primero, luego nombres), después del CUI si se encontró.
  const restantes = candidatos
    .filter((i) => i !== itApellidos && i !== itNombres && (!c || cy(i) >= cy(c.it) - 5))
    .sort((a, b) => cy(a) - cy(b));
  if (!itApellidos && restantes.length) { itApellidos = restantes.shift(); porPosicionA = true; }
  if (!itNombres && restantes.length) { itNombres = restantes.shift(); porPosicionN = true; }

  const campo = (it, porPosicion, nombre) => {
    if (!it) { motivos.push(`${nombre}_no_encontrado`); return { texto: '', conf: 0 }; }
    const r = corregirNombre(it.texto);
    let conf = it.confianza;
    if (r.correcciones.length) { correcciones.push(...r.correcciones.map((x) => ({ ...x, campo: nombre }))); conf *= PENALIZA_CORRECCION; motivos.push(`${nombre}_corregido`); }
    if (porPosicion) { conf *= PENALIZA_POSICION; motivos.push(`${nombre}_por_posicion`); }
    return { texto: r.texto, conf };
  };
  const ap = campo(itApellidos, porPosicionA, 'apellidos');
  const no = campo(itNombres, porPosicionN, 'nombres');

  if (confCui > 0 && confCui < UMBRAL_CONFIANZA_CUI) motivos.push('cui_confianza_baja');
  if (ap.texto && ap.conf < UMBRAL_CONFIANZA_NOMBRE) motivos.push('apellidos_confianza_baja');
  if (no.texto && no.conf < UMBRAL_CONFIANZA_NOMBRE) motivos.push('nombres_confianza_baja');

  const r4 = (x) => Number(x.toFixed(4));
  return {
    cui, cui_con_formato: conGuiones(cui), cui_valido: cuiValido, cui_problemas: cuiProblemas, departamento, municipio,
    verificador: 'no_verificado',
    nombres: no.texto, apellidos: ap.texto,
    confianza: { cui: r4(confCui), nombres: r4(no.conf), apellidos: r4(ap.conf) },
    correcciones,
    // Cualquier corrección, CUI inválido, campo faltante o confianza baja obliga a que una persona confirme el dato.
    revision_obligatoria: motivos.length > 0,
    motivos: [...new Set(motivos)],
  };
}

module.exports = {
  extraerDpi, agruparLineas, corregirCui, validarCui, corregirNombre, esEtiqueta, pareceNombre, distanciaSubcadena, formato454,
  UMBRAL_CONFIANZA_CUI, UMBRAL_CONFIANZA_NOMBRE, LETRA_A_DIGITO, DIGITO_A_LETRA,
};
