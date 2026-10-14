import { Icono } from '../componentes/Icono';
import { Pendiente } from '../componentes/Pendiente';
import { NAVEGACION, PIE } from '../contenido';

/** Pie sobrio: marca, razón social, enlaces de la página y de la app, y el año. */
export function Pie() {
  const anio = new Date().getFullYear();
  return (
    <footer className="border-t border-linea-fuerte bg-lienzo">
      <div className="l-contenedor grid gap-10 py-14 md:grid-cols-12">
        <div className="md:col-span-5">
          <p className="flex items-center gap-2.5 font-titular text-entrada font-extrabold tracking-[-0.02em] text-tinta">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-logo text-logo-tinta">
              <Icono nombre="escudo" tamano={16} grosor={2.5} />
            </span>
            SecureGate
          </p>
          <p className="mt-4 max-w-[34ch] text-detalle text-tinta-suave">{PIE.lema}</p>
        </div>

        <nav aria-label="Pie de página" className="grid grid-cols-2 gap-8 md:col-span-6 md:col-start-7">
          <div>
            <p className="l-rotulo text-tinta-suave">Página</p>
            <ul className="mt-4 space-y-2.5 text-detalle">
              {NAVEGACION.map(n => (
                <li key={n.id}><a href={`#${n.id}`} className="text-tinta no-underline hover:underline">{n.texto}</a></li>
              ))}
              <li><a href="#contacto" className="font-semibold text-tinta no-underline hover:underline">Pedir demo</a></li>
            </ul>
          </div>
          <div>
            <p className="l-rotulo text-tinta-suave">Aplicación</p>
            <ul className="mt-4 space-y-2.5 text-detalle">
              {PIE.app.map(a => (
                <li key={a.href}><a href={a.href} className="text-tinta no-underline hover:underline">{a.texto}</a></li>
              ))}
            </ul>
          </div>
        </nav>
      </div>

      <div className="border-t border-linea">
        <p className="l-contenedor py-6 text-detalle text-tinta-suave">
          © {anio} {PIE.razonSocial ?? <Pendiente>razón social</Pendiente>}
        </p>
      </div>
    </footer>
  );
}
