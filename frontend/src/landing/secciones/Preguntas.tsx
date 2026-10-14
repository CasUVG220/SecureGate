import { Icono } from '../componentes/Icono';
import { Pendiente } from '../componentes/Pendiente';
import { PREGUNTAS } from '../contenido';

/**
 * Preguntas frecuentes con <details>/<summary> nativos: se abren con teclado y lector de pantalla sin JavaScript, y
 * cada una se abre sola (no es un acordeón que cierra las demás: quien compara respuestas las quiere abiertas).
 * El encabezado queda fijo a la izquierda en escritorio.
 */
export function Preguntas() {
  return (
    <section id="preguntas" aria-labelledby="titulo-preguntas" className="py-24 lg:py-36">
      <div className="l-contenedor grid gap-12 lg:grid-cols-12">
        <div data-revelar className="lg:sticky lg:top-[calc(var(--l-barra)+2.5rem)] lg:col-span-4 lg:self-start">
          <h2 id="titulo-preguntas" className="text-titulo font-extrabold">Preguntas frecuentes</h2>
          <p className="mt-5 max-w-[30ch] text-cuerpo text-tinta-suave">
            ¿Otra pregunta?{' '}
            <a href="#contacto" className="font-semibold text-tinta underline underline-offset-4">Escribinos</a>.
          </p>
        </div>

        <div data-revelar className="border-t border-linea-fuerte lg:col-span-7 lg:col-start-6">
          {PREGUNTAS.map(p => (
            <details key={p.pregunta} className="l-pregunta group border-b border-linea-fuerte">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-6 font-titular text-entrada font-bold text-tinta">
                {p.pregunta}
                <span className="l-mas mt-1.5" aria-hidden="true" />
              </summary>
              <div className="max-w-medida pb-7 text-cuerpo text-tinta-suave">
                {p.respuesta && <p>{p.respuesta}</p>}
                {p.pendiente && <p className={p.respuesta ? 'mt-3' : ''}><Pendiente>{p.pendiente}</Pendiente></p>}
                {p.enlace && (
                  <p className="mt-4">
                    <a href={p.enlace.href} className="inline-flex items-center gap-1.5 font-semibold text-tinta underline underline-offset-4">
                      <Icono nombre="documento" tamano={16} />
                      {p.enlace.texto}
                    </a>
                  </p>
                )}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
