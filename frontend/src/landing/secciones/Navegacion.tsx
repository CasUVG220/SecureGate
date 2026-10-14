import { useEffect, useRef, useState } from 'react';
import { cx } from '../../components/ui/cx';
import { Icono } from '../componentes/Icono';
import { useSeccionActiva } from '../componentes/useSeccionActiva';
import { NAVEGACION, RUTA_INGRESAR } from '../contenido';

const IDS = NAVEGACION.map(n => n.id);

/**
 * Barra fija en el azul SecureGate (el marino del tema oscuro de la app): logo, cuatro enlaces, «Ingresar» (a la app) y
 * «Pedir demo» (al formulario). Sobre la barra azul, «Pedir demo» va invertido —blanco con texto azul— para no perderse
 * en su propio color; en el resto de la página es azul con texto blanco. En teléfono los enlaces van en un panel que se
 * abre con «Menú» (con texto, no un ícono suelto: el público son administradores, no todos acostumbrados a la
 * hamburguesa). `l-oscuro` cambia el anillo de foco a blanco.
 */
export function Navegacion() {
  const activa = useSeccionActiva(IDS);
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);

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
    <header className="l-oscuro sticky top-0 z-40 bg-marca text-papel">
      <div className="l-contenedor flex h-[var(--l-barra)] items-center gap-3">
        <a href="#inicio" className="flex shrink-0 items-center gap-2.5 rounded-sm text-papel no-underline">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-logo text-logo-tinta ring-1 ring-papel/20">
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
                    activa === n.id ? 'font-semibold text-papel' : 'font-medium text-noche-texto hover:text-papel',
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
            className="hidden border-l border-papel/25 pl-6 text-detalle font-semibold text-papel no-underline hover:underline lg:inline"
          >
            Ingresar
          </a>
          <a href="#contacto" className="l-boton min-h-10 bg-papel px-3.5 text-detalle text-marca hover:bg-lienzo-hondo sm:px-4">
            Pedir demo
          </a>
          <button
            ref={boton}
            type="button"
            aria-expanded={abierto}
            aria-controls="l-menu"
            onClick={() => setAbierto(v => !v)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded px-2.5 text-detalle font-semibold text-papel hover:bg-papel/10 lg:hidden"
          >
            {abierto && <Icono nombre="cerrar" tamano={16} />}
            {abierto ? 'Cerrar' : 'Menú'}
          </button>
        </div>
      </div>

      <div id="l-menu" hidden={!abierto} className="border-t border-papel/15 bg-marca lg:hidden">
        <nav aria-label="Secciones" className="l-contenedor pb-4 pt-2">
          <ul>
            {NAVEGACION.map(n => (
              <li key={n.id} className="border-b border-papel/15">
                <a href={`#${n.id}`} onClick={() => setAbierto(false)} className="block py-3.5 font-titular text-entrada font-bold text-papel no-underline">
                  {n.texto}
                </a>
              </li>
            ))}
            <li>
              <a href={RUTA_INGRESAR} className="block py-3.5 text-cuerpo font-semibold text-noche-texto no-underline">
                Ingresar a SecureGate
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
