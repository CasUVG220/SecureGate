/** Eventos de la ventana con los que dos partes de la pantalla se avisan sin conocerse. */

/** Un anuncio se marcó como leído (o llegó uno nuevo): la campana y la página de anuncios vuelven a pedir la lista. */
export const ANUNCIOS_CAMBIARON = 'sg:anuncios-cambiaron';

export type OrigenAnuncios = 'campana' | 'pagina';

/** Avisa a las demás partes; quien lo emite no se vuelve a pedir la lista a sí mismo (ya tiene el dato fresco). */
export const avisarAnunciosCambiaron = (origen: OrigenAnuncios): void => {
  window.dispatchEvent(new CustomEvent<{ origen: OrigenAnuncios }>(ANUNCIOS_CAMBIARON, { detail: { origen } }));
};

/** Escucha los cambios de las demás partes (ignora los propios). Devuelve la función que deja de escuchar. */
export const alCambiarAnuncios = (yo: OrigenAnuncios, fn: () => void): (() => void) => {
  const escuchar = (e: Event) => { if ((e as CustomEvent<{ origen?: OrigenAnuncios }>).detail?.origen !== yo) fn(); };
  window.addEventListener(ANUNCIOS_CAMBIARON, escuchar);
  return () => window.removeEventListener(ANUNCIOS_CAMBIARON, escuchar);
};
