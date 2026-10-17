/**
 * Zona de interés (ROI) de un carril: un polígono con coordenadas NORMALIZADAS (0–1 sobre el ancho y el alto del cuadro), así
 * la misma configuración sirve para el sub-stream de 640×360 y para el principal de 1920×1080.
 *
 * Lo que pasa fuera del ROI (la calle, la banqueta, el carril de al lado) no despierta el pipeline ni cuenta como vehículo.
 */
'use strict';

/** Todo el cuadro: el ROI por defecto de un carril recién creado. */
const CUADRO_COMPLETO = Object.freeze([[0, 0], [1, 0], [1, 1], [0, 1]]);

/**
 * Valida y normaliza un polígono: al menos 3 vértices, cada uno `[x, y]` (o `{x, y}`) con números finitos dentro de [0, 1].
 * Lanza con un mensaje claro si no sirve: un ROI mal escrito no debe convertirse en «todo el cuadro» sin que nadie se entere.
 */
function normalizarPoligono(puntos) {
  if (puntos == null) return CUADRO_COMPLETO.map(p => [...p]);
  if (!Array.isArray(puntos) || puntos.length < 3) throw new Error('El ROI necesita al menos 3 puntos');
  if (puntos.length > 32) throw new Error('El ROI admite como máximo 32 puntos');
  return puntos.map((p, i) => {
    const x = Array.isArray(p) ? p[0] : p && p.x;
    const y = Array.isArray(p) ? p[1] : p && p.y;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      throw new Error(`Punto ${i + 1} del ROI fuera de rango (deben ser valores entre 0 y 1)`);
    }
    return [x, y];
  });
}

/** Punto dentro del polígono (regla par-impar). Coordenadas en el mismo sistema que el polígono. */
function puntoEnPoligono(x, y, poligono) {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i];
    const [xj, yj] = poligono[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Máscara de píxeles (1 = dentro) para un cuadro de `ancho`×`alto`, muestreando el centro de cada píxel. */
function mascara(poligono, ancho, alto) {
  const m = new Uint8Array(ancho * alto);
  for (let y = 0; y < alto; y++) {
    const ny = (y + 0.5) / alto;
    for (let x = 0; x < ancho; x++) {
      if (puntoEnPoligono((x + 0.5) / ancho, ny, poligono)) m[y * ancho + x] = 1;
    }
  }
  return m;
}

/**
 * Qué fracción de una caja (en píxeles de un cuadro `ancho`×`alto`) cae dentro del ROI, muestreando una rejilla de 5×5 puntos.
 * Sirve para filtrar detecciones: un vehículo del carril de al lado que apenas roza el ROI no cuenta.
 */
function fraccionDentro(caja, poligono, ancho, alto) {
  const N = 5;
  let dentro = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const px = (caja.x + ((i + 0.5) / N) * caja.w) / ancho;
      const py = (caja.y + ((j + 0.5) / N) * caja.h) / alto;
      if (puntoEnPoligono(px, py, poligono)) dentro++;
    }
  }
  return dentro / (N * N);
}

module.exports = { CUADRO_COMPLETO, normalizarPoligono, puntoEnPoligono, mascara, fraccionDentro };
