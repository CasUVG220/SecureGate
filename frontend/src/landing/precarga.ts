/**
 * Póster del hero: es el LCP del landing en cuanto existe el archivo. main.tsx lo precarga en `/` ANTES de pedir el
 * chunk del landing, para que la descarga vaya en paralelo con el JavaScript y no después de pintar. Este módulo no
 * importa nada: entra en el bundle de arranque y tiene que ser mínimo.
 */
export const POSTER_HERO = 'hero-poster.jpg';

export function precargarPosterDelHero(): void {
  const enlace = Object.assign(document.createElement('link'), {
    rel: 'preload',
    as: 'image',
    href: `/landing/${POSTER_HERO}`,
  });
  enlace.setAttribute('fetchpriority', 'high');
  document.head.appendChild(enlace);
}
