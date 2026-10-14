import { useEffect, useRef, useState } from 'react';
import { cx } from '../../components/ui/cx';
import { Icono } from '../componentes/Icono';
import { useSeccionActiva } from '../componentes/useSeccionActiva';
import { NAVEGACION, RUTA_INGRESAR } from '../contenido';

const IDS = NAVEGACION.map(n => n.id);

/**
 * Barra fija: logo, cuatro enlaces, «Ingresar» (a la app) y «Pedir demo» (al formulario). Transparente sobre el hero y
 * con fondo y filete en cuanto la página baja. En teléfono los enlaces van en un panel que se abre con «Menú» (con
 * texto, no un ícono suelto: el público son administradores, no todos acostumbrados a la hamburguesa).
 */
export function Navegacion() {
  const activa = useSeccionActiva(IDS);
  const [abierto, setAbierto] = useState(false);
  const [despegada, setDespegada] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const tope = useRef<HTMLDivElement>(null);

  // Un centinela de 1 px arriba de todo: cuando sale de la vista, la barra toma fondo. Sin escuchar el scroll.
  useEffect(() => {
    const el = tope.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observador = new IntersectionObserver(([e]) => setDespegada(!e.isIntersecting));
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setAbierto(false);
      boton.current?.focus();
    };
    // Al pasar a escritorio el panel sobra: los enlaces ya están en la barra.
    const amplio = window.matchMedia?.('(min-width: 1024px)');
    const alCambiar = () => { if (amplio?.matches) setAbierto(false); };
    document.addEventListener('keydown', alTeclear);
    amplio?.addEventListener('change', alCambiar);
    return () => {
      document.removeEventListener('keydown', alTeclear);
      amplio?.removeEventListener('change', alCambiar);
    };
  }, [abierto]);

  return (
    <>
      <div ref={tope} className="absolute inset-x-0 top-0 h-px" aria-hidden="true" />
      <header
        className={cx(
          'sticky top-0 z-40 transition-colors duration-200',
          despegada || abierto ? 'bg-lienzo/95 shadow-[0_1px_0_rgb(var(--l-linea))]' : 'bg-transparent',
        )}
      >
        <div className="l-contenedor flex h-[var(--l-barra)] items-center gap-3">
          <a href="#inicio" className="flex shrink-0 items-center gap-2.5 rounded-sm text-tinta no-underline">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-logo text-logo-tinta">
              <Icono nombre="escudo" tamano={18} grosor={2.5} />
            </span>
            <span className="font-titular text-entrada font-extrabold tracking-[-0.02em]">SecureGate</span>
          </a>

          <nav aria-label="Secciones" className="ml-auto hidden lg:block">
            <ul className="flex items-center gap-8">
              {NAVEGACION.map(n => (
                <li key={n.id}>
                  <a
                    href={`#${n.id}`}
                    aria-current={activa === n.id ? 'location' : undefined}
                    className={cx(
                      'l-enlace-nav text-detalle no-underline transition-colors',
                      activa === n.id ? 'font-semibold text-tinta' : 'font-medium text-tinta-suave hover:text-tinta',
                    )}
                  >
                    {n.texto}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-2 lg:ml-8 lg:gap-6">
            <a
              href={RUTA_INGRESAR}
              className="hidden border-l border-linea-fuerte pl-6 text-detalle font-semibold text-tinta no-underline hover:underline lg:inline"
            >
              Ingresar
            </a>
            <a href="#contacto" className="l-boton l-boton-primario min-h-10 px-3.5 text-detalle sm:px-4">
              Pedir demo
            </a>
            <button
              ref={boton}
              type="button"
              aria-expanded={abierto}
              aria-controls="l-menu"
              onClick={() => setAbierto(v => !v)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded px-2.5 text-detalle font-semibold text-tinta hover:bg-tinta/5 lg:hidden"
            >
              {abierto && <Icono nombre="cerrar" tamano={16} />}
              {abierto ? 'Cerrar' : 'Menú'}
            </button>
          </div>
        </div>

        <div id="l-menu" hidden={!abierto} className="border-t border-linea bg-lienzo lg:hidden">
          <nav aria-label="Secciones" className="l-contenedor pb-4 pt-2">
            <ul>
              {NAVEGACION.map(n => (
                <li key={n.id} className="border-b border-linea">
                  <a href={`#${n.id}`} onClick={() => setAbierto(false)} className="block py-3.5 font-titular text-entrada font-bold text-tinta no-underline">
                    {n.texto}
                  </a>
                </li>
              ))}
              <li>
                <a href={RUTA_INGRESAR} className="block py-3.5 text-cuerpo font-semibold text-tinta-suave no-underline">
                  Ingresar a SecureGate
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </header>
    </>
  );
}
