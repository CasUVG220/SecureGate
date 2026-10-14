import type { CSSProperties } from 'react';
import { cx } from '../../components/ui/cx';
import { MediaSlot } from '../componentes/MediaSlot';
import { QUE_HACE } from '../contenido';

type Funcion = (typeof QUE_HACE.funciones)[number];
type Imagen = (typeof QUE_HACE.imagenes)[keyof typeof QUE_HACE.imagenes];

/**
 * Lista tipo hoja de especificaciones (no tarjetas): nombre a la izquierda, detalle a la derecha y el rótulo técnico
 * debajo, con filetes entre filas. Las dos imágenes van intercaladas junto a lo que ilustran, en lados opuestos y con
 * anchos distintos: las cámaras se salen hacia el borde derecho junto a las filas 1-3; el QR, más angosto, a la
 * izquierda de las filas 4-8 y fijo mientras pasan. En teléfono, cada imagen va después de su grupo.
 */
export function QueHace() {
  const f = QUE_HACE.funciones;
  const img = QUE_HACE.imagenes;
  return (
    <section id="que-hace" aria-labelledby="titulo-que-hace" className="py-24 lg:py-36">
      <div className="l-contenedor">
        <div data-revelar className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <h2 id="titulo-que-hace" className="text-titulo font-extrabold lg:col-span-6">{QUE_HACE.titulo}</h2>
          <p className="max-w-medida text-entrada text-tinta-suave lg:col-span-5 lg:col-start-8">{QUE_HACE.bajada}</p>
        </div>

        <div className="mt-14 grid gap-y-10 lg:mt-20 lg:grid-cols-12 lg:gap-x-10">
          <Especificacion filas={f.slice(0, 3)} desde={0} className="lg:col-span-7" />
          <Figura imagen={img.camaras} className="l-que-hace-camaras lg:col-span-5 lg:mt-3" />
        </div>

        <div className="mt-10 grid gap-y-10 lg:mt-0 lg:grid-cols-12 lg:gap-x-10">
          <Especificacion filas={f.slice(3)} desde={3} className="lg:col-span-7 lg:col-start-6 lg:row-start-1" />
          <Figura imagen={img.qr} className="lg:sticky lg:top-[calc(var(--l-barra)+2.5rem)] lg:col-span-4 lg:col-start-1 lg:row-start-1 lg:mt-24 lg:self-start" />
        </div>
      </div>
    </section>
  );
}

function Especificacion({ filas, desde, className }: { filas: readonly Funcion[]; desde: number; className?: string }) {
  return (
    <dl className={cx('border-t border-linea-fuerte', className)}>
      {filas.map((fila, i) => (
        <div
          key={fila.nombre}
          data-revelar
          style={{ '--l-retardo': `${i * 70}ms` } as CSSProperties}
          className="grid gap-x-8 gap-y-2 border-b border-linea py-6 md:grid-cols-[minmax(0,14rem)_1fr]"
        >
          <dt className="font-titular text-entrada font-bold leading-snug text-tinta">
            <span className="mr-2 font-cifra text-rotulo font-normal text-tinta-suave" aria-hidden="true">{String(desde + i + 1).padStart(2, '0')}</span>
            {fila.nombre}
          </dt>
          <dd className="text-cuerpo text-tinta-suave">
            <p className="max-w-medida">{fila.detalle}</p>
            <p className="l-rotulo mt-3 text-tinta">{fila.tecnica}</p>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Figura({ imagen, className }: { imagen: Imagen; className?: string }) {
  return (
    <figure data-revelar className={className}>
      <MediaSlot archivo={imagen.archivo} ancho={1500} alto={1000} alt={imagen.alt} />
      <figcaption className="l-rotulo mt-3 text-tinta-suave">{imagen.pie}</figcaption>
    </figure>
  );
}
