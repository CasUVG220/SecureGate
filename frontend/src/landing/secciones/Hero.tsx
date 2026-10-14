import { MediaSlot } from '../componentes/MediaSlot';
import { Icono } from '../componentes/Icono';
import { HERO } from '../contenido';
import { CORTES, puntosSvg } from '../cortes';

export function Hero() {
  const v = HERO.video;
  return (
    <section id="inicio" aria-labelledby="titulo-hero" className="relative -mt-[var(--l-barra)] pt-[var(--l-barra)]">
      <div className="l-fondo-hero" aria-hidden="true" />

      <div className="l-contenedor relative grid items-center gap-y-12 pb-16 pt-8 sm:pt-12 lg:grid-cols-12 lg:gap-x-10 lg:pb-28 lg:pt-20">
        <div className="lg:col-span-6">
          <h1 id="titulo-hero" className="l-entrada text-mega font-extrabold text-tinta">
            {HERO.titular} <span className="l-subrayado">{HERO.remate}</span>
          </h1>
          <p className="l-entrada mt-7 max-w-[42ch] text-entrada text-tinta-suave" style={{ ['--l-retardo' as string]: '110ms' }}>
            {HERO.bajada}
          </p>
          <div className="l-entrada mt-10 flex flex-wrap items-center gap-3" style={{ ['--l-retardo' as string]: '220ms' }}>
            <a href="#contacto" className="l-boton l-boton-primario">
              Pedir demo
              <Icono nombre="flecha" tamano={18} className="l-flecha" />
            </a>
            <a href="#precios" className="l-boton l-boton-secundario">
              Ver precios
            </a>
          </div>
        </div>

        <div className="l-hero-medio l-entrada-lateral lg:col-span-6" style={{ ['--l-retardo' as string]: '160ms' }}>
          {/* Contorno desplazado detrás del video: profundidad de plano técnico, sin sombra ni desenfoque. */}
          <svg className="l-hero-fantasma" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polygon points={puntosSvg(CORTES.hero)} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </svg>
          <MediaSlot
            archivo={v.poster}
            video={{ mp4: v.mp4, webm: v.webm }}
            ancho={v.ancho}
            alto={v.alto}
            alt={v.alt}
            recorte={CORTES.hero}
            recorteMovil={CORTES.heroMovil}
            prioridad
            // En escritorio el bloque se recorta a 3:2 para acompañar la altura del titular (el archivo sigue siendo 16:9).
            className="lg:!aspect-[3/2]"
          />
        </div>
      </div>
    </section>
  );
}
