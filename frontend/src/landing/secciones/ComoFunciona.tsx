import type { CSSProperties } from 'react';
import { PLACA_EJEMPLO } from '../../utils/placa';
import { COMO_FUNCIONA } from '../contenido';

const C = COMO_FUNCIONA;

/** Los campos del registro de ejemplo, en el orden en que se leen, con el paso que los produce. */
const REGISTRO = [
  { campo: 'hora', etiqueta: 'Hora', valor: C.ejemplo.hora },
  { campo: 'hora', etiqueta: 'Garita', valor: C.ejemplo.garita },
  { campo: 'placa', etiqueta: 'Placa', valor: PLACA_EJEMPLO },
  { campo: 'autorizó', etiqueta: 'Visita a', valor: C.ejemplo.destino },
  { campo: 'autorizó', etiqueta: 'Autorizó', valor: C.ejemplo.autorizo },
  { campo: 'resultado', etiqueta: 'Resultado', valor: C.ejemplo.resultado },
] as const;

const numero = (i: number) => String(i + 1).padStart(2, '0');
const pasoDe = (campo: string) => C.pasos.findIndex(p => p.campo === campo);

/**
 * La única sección oscura de la página (el azul noche del tema oscuro de la app). Cuatro pasos sobre una línea que se
 * llena de izquierda a derecha al entrar en pantalla, y debajo el registro que dejan: cada campo dice qué paso lo puso.
 */
export function ComoFunciona() {
  return (
    <section id="como-funciona" aria-labelledby="titulo-como" className="l-oscuro l-banda-oscura bg-noche text-noche-texto">
      <div className="l-contenedor pb-24 pt-[calc(var(--l-rampa)+4.5rem)] lg:pb-32 lg:pt-[calc(var(--l-rampa)+6rem)]">
        <header data-revelar className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <h2 id="titulo-como" className="text-titulo font-extrabold text-papel lg:col-span-5">{C.titulo}</h2>
          <p className="max-w-medida text-entrada text-noche-tenue lg:col-span-6 lg:col-start-7">{C.bajada}</p>
        </header>

        <ol className="mt-16 grid gap-y-12 sm:grid-cols-2 lg:mt-20 lg:grid-cols-4">
          {C.pasos.map((p, i) => (
            <li key={p.titulo} data-revelar className="l-paso pr-6 lg:pr-8" style={{ '--l-retardo': `${i * 120}ms` } as CSSProperties}>
              <span className="block font-cifra text-numeral font-medium text-noche-tenue" aria-hidden="true">{numero(i)}</span>
              <span className="l-paso-linea" aria-hidden="true" />
              <h3 className="mt-7 text-subtitulo font-bold text-papel">
                <span className="sr-only">Paso {i + 1}: </span>{p.titulo}
              </h3>
              <p className="mt-3 max-w-[34ch] text-detalle text-noche-tenue">{p.texto}</p>
              <p className="mt-5 font-cifra text-rotulo text-noche-tenue">
                <span className="text-acento">→</span> registra: <span className="text-noche-texto">{p.campo}</span>
              </p>
            </li>
          ))}
        </ol>

        <figure data-revelar className="mt-20 border-t border-noche-linea pt-8 lg:mt-24">
          <figcaption className="l-rotulo text-noche-tenue">{C.ejemplo.rotulo}</figcaption>
          <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-noche-linea font-cifra md:grid-cols-3 lg:grid-cols-6">
            {REGISTRO.map(r => (
              <div key={r.etiqueta} className="bg-noche-alta px-4 py-4">
                <dt className="flex items-baseline justify-between gap-2 text-rotulo text-noche-tenue">
                  {r.etiqueta}
                  <span className="text-acento" aria-label={`del paso ${pasoDe(r.campo) + 1}`}>{numero(pasoDe(r.campo))}</span>
                </dt>
                <dd className="mt-2 text-detalle font-medium text-papel">{r.valor}</dd>
              </div>
            ))}
          </dl>
        </figure>
      </div>
    </section>
  );
}
