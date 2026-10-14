import type { CSSProperties } from 'react';
import { MediaSlot } from '../componentes/MediaSlot';
import { TARJETAS } from '../contenido';
import { CORTES } from '../cortes';

/**
 * Garita, portal y administración. NO son tres tarjetas iguales: anchos distintos (1 : 1.18 : 0.92), la del medio más
 * alta y desfasada hacia abajo, y cada imagen con su recorte (chaflán, rectángulo, rampa). En teléfono van en una
 * columna, sin desfase y en cuadrado, para que la columna no se vuelva interminable.
 */
const FORMA: Record<(typeof TARJETAS)[number]['clave'], { proporcion: string; recorte?: string; posicion?: string; desfase: string }> = {
  garita: { proporcion: '4 / 5', recorte: CORTES.chaflan, desfase: '' },
  portal: { proporcion: '3 / 4.15', desfase: 'md:mt-24' },
  admin: { proporcion: '1 / 1', recorte: CORTES.rampa, posicion: 'center 30%', desfase: 'md:mt-10' },
};

export function Tarjetas() {
  return (
    <section aria-labelledby="titulo-partes" className="l-contenedor pb-24 pt-4 lg:pb-36">
      <h2 id="titulo-partes" className="sr-only">Las tres partes de SecureGate</h2>
      <ul className="grid items-start gap-14 md:grid-cols-[1fr_1.18fr_0.92fr] md:gap-6 lg:gap-10">
        {TARJETAS.map((t, i) => {
          const f = FORMA[t.clave];
          return (
            <li key={t.clave} data-revelar className={f.desfase} style={{ '--l-retardo': `${i * 90}ms` } as CSSProperties}>
              <MediaSlot
                archivo={t.imagen}
                ancho={1200}
                alto={1500}
                alt={t.alt}
                proporcion={f.proporcion}
                recorte={f.recorte}
                posicion={f.posicion}
                className="max-md:!aspect-square"
              />
              <p className="l-rotulo mt-5 text-tinta-suave">{t.soporte}</p>
              <h3 className="mt-2 text-subtitulo font-bold text-tinta">{t.titulo}</h3>
              <p className="mt-2 max-w-[38ch] text-cuerpo text-tinta-suave">{t.texto}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
