import { useState } from 'react';
import { cx } from '../ui/cx';
import ChartTooltip from './ChartTooltip';
import { cubeta } from './format';
import { useAncho } from './useAncho';

export interface HeatmapProps {
  /** 7 filas (lunes → domingo) × 24 horas. */
  matriz: number[][];
  /** Nombres cortos de los días, lunes primero. */
  dias: string[];
  /** Nombres completos, para el tooltip. */
  diasLargos: string[];
  formatoValor: (n: number) => string;
  etiquetas: { menos: string; mas: string; sinMovimiento: string };
  ariaLabel: string;
}

/*
 * Escala secuencial de un solo tono: más movimiento = más intenso. El paso 0
 * (sin movimiento) es neutro para no confundir "nada" con "poco". Las clases
 * van literales para que Tailwind las encuentre.
 */
const TONO = [
  'bg-gray-500/10',
  'bg-viz-seq-1',
  'bg-viz-seq-2',
  'bg-viz-seq-3',
  'bg-viz-seq-4',
  'bg-viz-seq-5',
] as const;

const hora = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;

/**
 * ¿Cuándo llegan las visitas? Día de la semana × hora del día.
 *
 * Por debajo de ~560 px las 24 columnas no caben con un área tocable, así que
 * se agrupan en franjas de 3 horas (8 columnas): se pierde detalle, no lectura.
 */
export default function Heatmap({ matriz, dias, diasLargos, formatoValor, etiquetas, ariaLabel }: HeatmapProps) {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [activa, setActiva] = useState<{ d: number; c: number } | null>(null);

  const horasPorCelda = ancho < 560 ? 3 : 1;
  const columnas = 24 / horasPorCelda;
  const celdas = matriz.map(fila =>
    Array.from({ length: columnas }, (_, c) =>
      fila.slice(c * horasPorCelda, (c + 1) * horasPorCelda).reduce((a, b) => a + b, 0)),
  );
  const max = Math.max(0, ...celdas.flat());

  // El pico se marca con un anillo: es lo que el texto de hallazgos nombra.
  const iPico = max > 0 ? celdas.flat().indexOf(max) : -1;
  const pico = iPico >= 0 ? { d: Math.floor(iPico / columnas), c: iPico % columnas } : null;
  const esPico = (d: number, c: number) => pico?.d === d && pico?.c === c;

  // Hora rotulada cada 3 columnas; agrupadas de 3 en 3, todas.
  const rotulo = (c: number) => horasPorCelda > 1 || c % 3 === 0;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mov: Record<string, [number, number]> = {
      ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0],
    };
    if (e.key in mov) {
      e.preventDefault();
      const [dd, dc] = mov[e.key];
      setActiva(a => {
        const base = a ?? { d: 0, c: 0 };
        return { d: Math.min(6, Math.max(0, base.d + dd)), c: Math.min(columnas - 1, Math.max(0, base.c + dc)) };
      });
    } else if (e.key === 'Escape') {
      setActiva(null);
    }
  };

  // Posición del tooltip calculada de la rejilla (etiqueta de 2.75 rem + columnas iguales).
  const colEtiqueta = 44;
  const gap = 2;
  const altoFila = 26;
  const anchoCelda = (ancho - colEtiqueta - gap * columnas) / columnas;
  const xCelda = (c: number) => colEtiqueta + gap + c * (anchoCelda + gap) + anchoCelda / 2;
  const yCelda = (d: number) => 22 + d * (altoFila + gap);

  const textoCelda = (d: number, c: number) => {
    const desde = c * horasPorCelda;
    return `${diasLargos[d]}, ${hora(desde)}–${hora(desde + horasPorCelda)}`;
  };

  return (
    <div>
      <div
        ref={ref}
        className="relative w-full min-w-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--c-surface))]"
        tabIndex={0}
        role="group"
        aria-roledescription="mapa de calor"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        onFocus={() => setActiva(a => a ?? pico ?? { d: 0, c: 0 })}
        onBlur={() => setActiva(null)}
        onPointerLeave={() => setActiva(null)}
      >
        <div
          className="grid items-center"
          style={{ gridTemplateColumns: `${colEtiqueta - gap}px repeat(${columnas}, minmax(0, 1fr))`, gap }}
          aria-hidden="true"
        >
          {/* Encabezado de horas */}
          <span />
          {Array.from({ length: columnas }, (_, c) => (
            <span key={c} className="h-5 overflow-visible whitespace-nowrap text-2xs tabular-nums text-gray-400">
              {rotulo(c) ? String(c * horasPorCelda).padStart(2, '0') : ''}
            </span>
          ))}

          {celdas.map((fila, d) => (
            <div key={dias[d]} className="contents">
              <span className="pr-2 text-right text-2xs font-semibold text-gray-400">{dias[d]}</span>
              {fila.map((v, c) => {
                const nivel = cubeta(v, max);
                const esActiva = activa?.d === d && activa?.c === c;
                return (
                  <span
                    key={c}
                    onPointerEnter={() => setActiva({ d, c })}
                    className={cx(
                      'block h-[26px] rounded-[3px] transition-[box-shadow,transform] duration-100',
                      TONO[nivel],
                      esPico(d, c) && 'ring-2 ring-gray-100 ring-offset-1 ring-offset-[rgb(var(--c-surface))]',
                      esActiva && 'relative z-[1] scale-110 shadow-md ring-2 ring-gray-50',
                    )}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {activa && (
          <ChartTooltip
            titulo={textoCelda(activa.d, activa.c)}
            filas={[{
              llave: TONO[cubeta(celdas[activa.d][activa.c], max)],
              valor: formatoValor(celdas[activa.d][activa.c]),
              etiqueta: '',
              forma: 'cuadro',
            }]}
            x={xCelda(activa.c)}
            y={activa.d < 2 ? yCelda(activa.d) + altoFila : yCelda(activa.d)}
            anchoContenedor={ancho}
            debajo={activa.d < 2}
          />
        )}

        <p className="sr-only" aria-live="polite">
          {activa ? `${textoCelda(activa.d, activa.c)}: ${formatoValor(celdas[activa.d][activa.c])}` : ''}
        </p>
      </div>

      {/* Leyenda de escala: la intensidad nunca va sin su clave. */}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-2xs text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className={cx('h-3 w-3 rounded-[3px]', TONO[0])} aria-hidden="true" />
          {etiquetas.sinMovimiento}
        </span>
        <span className="flex items-center gap-1.5">
          {etiquetas.menos}
          {TONO.slice(1).map(t => <span key={t} className={cx('h-3 w-5 rounded-[3px]', t)} aria-hidden="true" />)}
          {etiquetas.mas}
        </span>
      </div>
    </div>
  );
}
