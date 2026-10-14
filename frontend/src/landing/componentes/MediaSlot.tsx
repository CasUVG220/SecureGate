import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { cx } from '../../components/ui/cx';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { Icono } from './Icono';
import { puntosSvg } from '../cortes';

/**
 * Hueco de medios del landing.
 *
 * Carga un archivo de `public/landing/` y, si no está, muestra un hueco sobrio con el nombre del archivo que falta y
 * sus medidas: así la página se puede revisar (y publicar) antes de tener las fotos y el video definitivos, sin que
 * nadie confunda el hueco con una imagen rota. Quien reemplaza los archivos no toca código (ver docs/landing.md).
 *
 * - Siempre con `width`/`height` del archivo y `aspect-ratio` en la caja: el espacio queda reservado antes de cargar.
 * - `loading="lazy"` salvo `prioridad` (el póster del hero, que es el LCP).
 * - `recorte`: polígono en porcentajes ("0 0, 100 0, 100 100, 0 100"). Se aplica como `clip-path` y el hueco dibuja
 *   su contorno con la misma forma. `recorteMovil` lo cambia por debajo de 768 px.
 * - Video (`video`): `<video autoplay muted loop playsinline preload="metadata" poster>` sobre el póster. Con
 *   `prefers-reduced-motion: reduce` no se monta el video: queda el póster. Un video que se mueve solo más de 5 s
 *   necesita una forma de pararlo (WCAG 2.2.2), por eso lleva botón de pausa.
 */
export const RUTA_MEDIOS = '/landing/';

type Estado = 'cargando' | 'listo' | 'falta';

interface Props {
  /** Archivo dentro de public/landing/. En el video, es el póster. */
  archivo: string;
  /** Medidas del archivo en px (las recomendadas en docs/landing.md). */
  ancho: number;
  alto: number;
  /** Texto alternativo: describe lo que muestra la imagen. */
  alt: string;
  /** Proporción de la caja cuando recorta el archivo (p. ej. '1 / 1' para mostrar cuadrado un 4:5). */
  proporcion?: string;
  recorte?: string;
  recorteMovil?: string;
  /** `object-position` del recorte. */
  posicion?: string;
  prioridad?: boolean;
  video?: { mp4: string; webm: string };
  className?: string;
}

/** "0 0, 100 0" → "polygon(0% 0%, 100% 0%)" */
const poligonoCss = (puntos?: string) =>
  puntos ? `polygon(${puntos.split(',').map(p => p.trim().split(/\s+/).map(n => `${n}%`).join(' ')).join(', ')})` : undefined;


const RECTANGULO = '0 0, 100 0, 100 100, 0 100';

/** Máximo común divisor, para escribir la proporción como la conoce quien prepara el archivo (16:9, 4:5, 3:2). */
const mcd = (a: number, b: number): number => (b === 0 ? a : mcd(b, a % b));
const proporcionLegible = (ancho: number, alto: number) => {
  const d = mcd(ancho, alto);
  return `${ancho / d}:${alto / d}`;
};

export function MediaSlot({
  archivo, ancho, alto, alt, proporcion, recorte, recorteMovil, posicion, prioridad = false, video, className,
}: Props) {
  const [imagen, setImagen] = useState<Estado>('cargando');
  const [clip, setClip] = useState<Estado>('cargando');
  const [enPausa, setEnPausa] = useState(false);
  const menosMovimiento = useMediaQuery('(prefers-reduced-motion: reduce)');
  const refVideo = useRef<HTMLVideoElement>(null);

  // React pone `muted` como propiedad, no como atributo; Safari en iOS mira el atributo para permitir el autoplay.
  const montarVideo = useCallback((el: HTMLVideoElement | null) => {
    refVideo.current = el;
    if (!el) return;
    el.muted = true;
    el.defaultMuted = true;
    el.setAttribute('muted', '');
  }, []);

  const alternarPausa = () => {
    const el = refVideo.current;
    if (!el) return;
    if (el.paused) {
      void el.play()?.catch(() => undefined);
      setEnPausa(false);
    } else {
      el.pause();
      setEnPausa(true);
    }
  };

  const conVideo = Boolean(video) && !menosMovimiento && clip !== 'falta';
  const faltan = [
    ...(video && clip === 'falta' && !menosMovimiento ? [video.mp4, video.webm] : []),
    ...(imagen === 'falta' ? [archivo] : []),
  ];
  const sinNada = imagen === 'falta' && !(conVideo && clip === 'listo');

  const estilo = {
    aspectRatio: proporcion ?? `${ancho} / ${alto}`,
    '--l-recorte': poligonoCss(recorte),
    '--l-recorte-movil': poligonoCss(recorteMovil),
  } as CSSProperties;

  return (
    <div
      className={cx('relative overflow-hidden bg-lienzo-hondo', (recorte || recorteMovil) && 'l-recorte', className)}
      style={estilo}
    >
      {imagen !== 'falta' && (
        <img
          src={RUTA_MEDIOS + archivo}
          width={ancho}
          height={alto}
          alt={alt}
          loading={prioridad ? 'eager' : 'lazy'}
          fetchPriority={prioridad ? 'high' : undefined}
          decoding={prioridad ? 'sync' : 'async'}
          onLoad={() => setImagen('listo')}
          onError={() => setImagen('falta')}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: posicion }}
        />
      )}

      {video && conVideo && (
        <video
          ref={montarVideo}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={imagen === 'falta' ? undefined : RUTA_MEDIOS + archivo}
          width={ancho}
          height={alto}
          aria-hidden="true"
          tabIndex={-1}
          onPlaying={() => setClip('listo')}
          onLoadedData={() => setClip('listo')}
          className={cx(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-500',
            clip === 'listo' ? 'opacity-100' : 'opacity-0',
          )}
          style={{ objectPosition: posicion }}
        >
          <source src={RUTA_MEDIOS + video.webm} type="video/webm" />
          {/* El error del último <source> es el que dice que ninguno sirvió. */}
          <source src={RUTA_MEDIOS + video.mp4} type="video/mp4" onError={() => setClip('falta')} />
        </video>
      )}

      {faltan.length > 0 && (
        <Hueco
          faltan={faltan}
          ancho={ancho}
          alto={alto}
          alt={sinNada ? alt : undefined}
          puntos={recorte ?? RECTANGULO}
          puntosMovil={recorteMovil}
          parcial={!sinNada}
        />
      )}

      {video && conVideo && clip === 'listo' && (
        <button
          type="button"
          onClick={alternarPausa}
          className="absolute bottom-3 right-3 inline-flex min-h-10 items-center gap-2 rounded bg-noche/80 px-3 font-texto text-detalle font-medium text-noche-texto transition-colors hover:bg-noche"
          style={{ ['--l-foco' as string]: 'var(--l-papel)' }}
        >
          <Icono nombre={enPausa ? 'reproducir' : 'pausa'} tamano={16} />
          {enPausa ? 'Reproducir video' : 'Pausar video'}
        </button>
      )}
    </div>
  );
}

interface PropsHueco {
  faltan: string[];
  ancho: number;
  alto: number;
  /** Solo cuando no se ve nada: el hueco ocupa el lugar de la imagen y lleva su texto alternativo. */
  alt?: string;
  puntos: string;
  puntosMovil?: string;
  /** Falta solo una parte (el video, con el póster ya visible): aviso pequeño en vez de hueco completo. */
  parcial: boolean;
}

function Hueco({ faltan, ancho, alto, alt, puntos, puntosMovil, parcial }: PropsHueco) {
  if (parcial) {
    return (
      <p className="l-pendiente absolute right-3 top-3 bg-papel/90">
        Falta {faltan.join(' y ')}
      </p>
    );
  }

  const contorno = (p: string, clase?: string) => (
    <svg className={cx('absolute inset-2 h-[calc(100%-1rem)] w-[calc(100%-1rem)] text-tinta-suave', clase)} viewBox="0 0 100 100" preserveAspectRatio="none" overflow="visible" aria-hidden="true">
      <polygon points={puntosSvg(p)} fill="none" stroke="currentColor" strokeWidth="1.25" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
    </svg>
  );

  return (
    <div role="img" aria-label={alt} className="absolute inset-0 flex items-end p-5 sm:p-7">
      {puntosMovil ? (
        <>
          {contorno(puntosMovil, 'l-solo-movil')}
          {contorno(puntos, 'l-solo-amplio')}
        </>
      ) : contorno(puntos)}
      <div className="relative max-w-[28ch] font-cifra text-rotulo text-tinta-suave" aria-hidden="true">
        <ul className="font-medium text-tinta">
          {faltan.map(f => <li key={f}>{f}</li>)}
        </ul>
        <p className="mt-1">
          {proporcionLegible(ancho, alto)} · {ancho} × {alto} px
        </p>
        <p className="mt-1">{RUTA_MEDIOS.replace(/^\//, 'public/')}</p>
      </div>
    </div>
  );
}
