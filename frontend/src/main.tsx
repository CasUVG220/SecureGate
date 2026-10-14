/* eslint-disable react-refresh/only-export-components -- punto de entrada: no es un módulo de componentes que se recargue en caliente */
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { esRutaLanding } from './routing/portales'
import { precargarPosterDelHero } from './landing/precarga'

/*
 * Dos entradas en el mismo index.html, elegidas UNA vez al cargar el documento:
 *
 *   /               → landing público (src/landing): su propia hoja, fuentes autoalojadas y nada de la app.
 *   cualquier otra  → la app (App.tsx) con index.css y la fuente Outfit, igual que antes.
 *
 * Las dos son chunks diferidos: quien abre el landing no descarga el bundle de la app autenticada (ni su CSS ni la
 * fuente de Google), y quien entra a /personal no descarga el landing. El landing enlaza a la app con <a href>
 * (carga completa del documento), nunca con pushState, así que esta elección no tiene que reaccionar a cambios de ruta.
 */
const Landing = lazy(() => import('./landing/Landing'))

const App = lazy(() => {
  cargarFuenteDeLaApp()
  // El título del documento es el del landing (lo leen los buscadores); en la app basta el nombre.
  document.title = 'SecureGate'
  return Promise.all([import('./App'), import('./index.css')]).then(([m]) => m)
})

/** Outfit (Google Fonts) es solo de la app: antes iba en index.html y bloqueaba el pintado también en el landing. */
function cargarFuenteDeLaApp() {
  const enlaces: Array<Record<string, string>> = [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: '' },
    { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap' },
  ]
  for (const atributos of enlaces) {
    document.head.appendChild(Object.assign(document.createElement('link'), atributos))
  }
}

const enLanding = esRutaLanding(window.location.pathname)
// El póster del hero es el LCP del landing: se pide ya, en paralelo con el chunk, y no después de pintar.
if (enLanding) precargarPosterDelHero()
const Raiz = enLanding ? Landing : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Raiz />
    </Suspense>
  </StrictMode>,
)
