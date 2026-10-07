import { useState } from 'react';
import type { LangKey } from '../../context/LanguageContext';
import ChartTooltip, { type FilaTooltip } from './ChartTooltip';
import { fmtFechaCorta, fmtFechaLarga, indicesEtiquetas, marcasEje } from './format';
import { useAncho } from './useAncho';

/** `fecha` es la clave del punto: 'AAAA-MM-DD' por defecto, o lo que entiendan `etiquetaX`/`etiquetaDetalle`. */
export interface PuntoSerie { fecha: string; valor: number }

export interface TimeSeriesChartProps {
  datos: PuntoSerie[];
  /** Serie de comparación alineada por posición (día 1 contra día 1). */
  anterior?: number[];
  variante?: 'area' | 'columnas';
  /** Alto del área de trazado, sin contar el eje X. */
  alto?: number;
  lang: LangKey;
  formatoValor: (n: number) => string;
  formatoEje?: (n: number) => string;
  etiquetas: { actual: string; anterior?: string; maximo?: string; vacio?: string };
  ariaLabel: string;
  /** Rótulo corto del eje X (por defecto la fecha: "3 sep"). */
  etiquetaX?: (i: number) => string;
  /** Título del tooltip (por defecto la fecha larga: "mié, 3 sep"). */
  etiquetaDetalle?: (i: number) => string;
}

const M = { arriba: 18, derecha: 12, abajo: 28 };
const COLUMNA_MAX = 24;

/** Columna con el extremo de datos redondeado (4 px) y la base recta. */
const columna = (x: number, ancho: number, yTope: number, base: number): string => {
  const r = Math.min(4, ancho / 2, base - yTope);
  const i = x - ancho / 2;
  const d = x + ancho / 2;
  return `M${i},${base}V${yTope + r}Q${i},${yTope} ${i + r},${yTope}H${d - r}Q${d},${yTope} ${d},${yTope + r}V${base}Z`;
};

/**
 * Serie diaria: área (conteos que fluyen día a día) o columnas (montos que
 * llegan en eventos). El periodo anterior se dibuja en gris, detrás: el color
 * queda para la serie que importa y la gris da la referencia.
 *
 * Interacción: la cruceta busca el día más cercano al puntero (nadie apunta a
 * una línea de 2 px), y con el foco las flechas recorren los días.
 */
export default function TimeSeriesChart({
  datos, anterior, variante: varianteSolicitada = 'area', alto = 220, lang,
  formatoValor, formatoEje = formatoValor, etiquetas, ariaLabel, etiquetaX, etiquetaDetalle,
}: TimeSeriesChartProps) {
  // Un área de un solo punto no dibuja nada (no hay con quién unir la línea): con un solo día se muestra como columna.
  const variante = varianteSolicitada === 'area' && datos.length === 1 ? 'columnas' : varianteSolicitada;
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const rotuloX = etiquetaX ?? ((i: number) => fmtFechaCorta(datos[i].fecha, lang));
  const detalle = etiquetaDetalle ?? ((i: number) => fmtFechaLarga(datos[i].fecha, lang));
  const [activo, setActivo] = useState<number | null>(null);

  const n = datos.length;
  const valores = datos.map(d => d.valor);
  const hayAnterior = !!anterior && anterior.length === n;
  const maxDato = Math.max(0, ...valores, ...(hayAnterior ? anterior! : []));
  const { marcas, tope } = marcasEje(maxDato);
  const vacio = valores.every(v => v === 0);

  // Ancho estimado de un rótulo a 11 px (≈ 7 px por carácter, con holgura para
  // la fuente de respaldo): alcanza para no recortar ni montar etiquetas.
  const anchoTexto = (txt: string) => txt.length * 7;
  // El margen izquierdo se ajusta a la marca más ancha del eje.
  const izq = Math.max(28, Math.max(...marcas.map(m => anchoTexto(formatoEje(m)))) + 12);
  const anchoTrazo = Math.max(40, ancho - izq - M.derecha);
  const base = M.arriba + alto;

  const banda = anchoTrazo / Math.max(n, 1);
  const xDe = (i: number): number =>
    variante === 'columnas' || n === 1
      ? izq + banda * (i + 0.5)
      : izq + (anchoTrazo * i) / (n - 1);
  const yDe = (v: number): number => base - (v / tope) * alto;

  const lineaDe = (serie: number[]) => serie.map((v, i) => `${i ? 'L' : 'M'}${xDe(i).toFixed(1)},${yDe(v).toFixed(1)}`).join('');

  // Hasta 366 puntos: recalcular los trazos en cada render cuesta menos que memoizarlos.
  const trazos = n
    ? (() => {
        const linea = lineaDe(valores);
        const area = `${linea}L${xDe(n - 1).toFixed(1)},${base}L${xDe(0).toFixed(1)},${base}Z`;
        return { linea, area, lineaAnterior: hayAnterior ? lineaDe(anterior!) : null };
      })()
    : null;

  const etiquetasX = indicesEtiquetas(n, anchoTrazo);
  const anchoColumna = Math.min(COLUMNA_MAX, Math.max(2, banda * 0.62));

  // Máximo del periodo: la única cifra que se rotula dentro del gráfico.
  const iMax = vacio ? -1 : valores.indexOf(Math.max(...valores));

  const indiceDesdePuntero = (clientX: number, rect: DOMRect): number => {
    const px = clientX - rect.left - izq;
    const i = variante === 'columnas' || n === 1 ? Math.floor(px / banda) : Math.round((px / anchoTrazo) * (n - 1));
    return Math.min(n - 1, Math.max(0, i));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!n) return;
    const mover: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, End: n, Home: -n };
    if (e.key in mover) {
      e.preventDefault();
      setActivo(a => Math.min(n - 1, Math.max(0, (a ?? n - 1) + mover[e.key])));
    } else if (e.key === 'Escape') {
      setActivo(null);
    }
  };

  const filasTooltip = (i: number): FilaTooltip[] => {
    const filas: FilaTooltip[] = [
      { llave: 'bg-viz-series', valor: formatoValor(valores[i]), etiqueta: etiquetas.actual, forma: variante === 'columnas' ? 'cuadro' : 'linea' },
    ];
    if (hayAnterior && etiquetas.anterior) {
      filas.push({ llave: 'bg-gray-500', valor: formatoValor(anterior![i]), etiqueta: etiquetas.anterior });
    }
    return filas;
  };

  const anuncio = activo != null && datos[activo]
    ? `${detalle(activo)}: ${filasTooltip(activo).map(f => `${f.valor} ${f.etiqueta}`).join(', ')}`
    : '';

  return (
    <div
      ref={ref}
      className="relative w-full min-w-0 select-none overflow-x-clip rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--c-surface))]"
      tabIndex={n ? 0 : -1}
      role="group"
      aria-roledescription="gráfico"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      onFocus={() => setActivo(a => a ?? (n ? n - 1 : null))}
      onBlur={() => setActivo(null)}
    >
      <svg width={ancho} height={base + M.abajo} className="block overflow-visible" aria-hidden="true">
        {/* Rejilla: capilar, sólida y un paso fuera de la superficie. */}
        {marcas.map(m => (
          <g key={m}>
            <line
              x1={izq} x2={izq + anchoTrazo} y1={yDe(m)} y2={yDe(m)}
              className={m === 0 ? 'stroke-[rgb(var(--c-border-500))]' : 'stroke-[rgb(var(--c-hairline))]'}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text x={izq - 8} y={yDe(m)} dy="0.32em" textAnchor="end" className="fill-gray-400 text-2xs tabular-nums">
              {formatoEje(m)}
            </text>
          </g>
        ))}

        {etiquetasX.map(i => {
          const txt = rotuloX(i);
          const medio = anchoTexto(txt) / 2;
          // Centrada bajo su día, salvo que se salga por un borde.
          const anchor = xDe(i) - medio < izq - 8 ? 'start' : xDe(i) + medio > ancho ? 'end' : 'middle';
          const x = anchor === 'start' ? Math.max(izq - 8, xDe(i) - medio) : anchor === 'end' ? ancho - 1 : xDe(i);
          return (
            <text key={datos[i].fecha} x={x} y={base + 18} textAnchor={anchor} className="fill-gray-400 text-2xs">
              {txt}
            </text>
          );
        })}

        {trazos && hayAnterior && trazos.lineaAnterior && (
          <path d={trazos.lineaAnterior} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className="stroke-gray-500/80" />
        )}

        {trazos && variante === 'area' && !vacio && (
          <>
            <path d={trazos.area} className="fill-viz-series/10" />
            <path d={trazos.linea} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-viz-series" />
          </>
        )}

        {variante === 'columnas' && datos.map((d, i) => d.valor > 0 && (
          <path
            key={d.fecha}
            d={columna(xDe(i), anchoColumna, yDe(d.valor), base)}
            className={activo == null || activo === i ? 'fill-viz-series' : 'fill-viz-series/45'}
          />
        ))}

        {/* Con un solo día el periodo anterior no es una línea: se marca como una raya a su altura, detrás de la columna. */}
        {n === 1 && hayAnterior && (
          <line
            x1={xDe(0) - anchoColumna / 2 - 8} x2={xDe(0) + anchoColumna / 2 + 8}
            y1={yDe(anterior![0])} y2={yDe(anterior![0])}
            strokeWidth={2} strokeLinecap="round" className="stroke-gray-500"
          />
        )}

        {/* Rótulo selectivo: sólo el máximo del periodo. */}
        {iMax >= 0 && etiquetas.maximo && activo == null && (
          <g>
            {variante === 'area' && (
              <circle cx={xDe(iMax)} cy={yDe(valores[iMax])} r={4} strokeWidth={2} className="fill-viz-series stroke-[rgb(var(--c-surface))]" />
            )}
            <text
              x={xDe(iMax)}
              y={yDe(valores[iMax]) - 9}
              textAnchor={xDe(iMax) < izq + 40 ? 'start' : xDe(iMax) > izq + anchoTrazo - 40 ? 'end' : 'middle'}
              className="fill-gray-200 text-2xs font-semibold"
            >
              {etiquetas.maximo} {formatoValor(valores[iMax])}
            </text>
          </g>
        )}

        {activo != null && (
          <g>
            <line
              x1={xDe(activo)} x2={xDe(activo)} y1={M.arriba} y2={base}
              strokeWidth={1}
              className="stroke-gray-400"
              shapeRendering="crispEdges"
            />
            {hayAnterior && (
              <circle cx={xDe(activo)} cy={yDe(anterior![activo])} r={3.5} strokeWidth={2} className="fill-gray-500 stroke-[rgb(var(--c-surface))]" />
            )}
            {variante === 'area' && (
              <circle cx={xDe(activo)} cy={yDe(valores[activo])} r={4.5} strokeWidth={2} className="fill-viz-series stroke-[rgb(var(--c-surface))]" />
            )}
          </g>
        )}

        {/* Capa de captura: todo el ancho del trazado, no sólo la línea. */}
        <rect
          x={izq} y={M.arriba} width={anchoTrazo} height={alto}
          fill="transparent"
          onPointerMove={e => {
            const svg = e.currentTarget.ownerSVGElement;
            if (svg) setActivo(indiceDesdePuntero(e.clientX, svg.getBoundingClientRect()));
          }}
          onPointerLeave={() => setActivo(null)}
        />
      </svg>

      {vacio && etiquetas.vacio && (
        <p className="pointer-events-none absolute inset-x-0 text-center text-sm font-medium text-gray-400" style={{ top: M.arriba + alto / 2 - 10 }}>
          {etiquetas.vacio}
        </p>
      )}

      {activo != null && datos[activo] && (
        <ChartTooltip
          titulo={detalle(activo)}
          filas={filasTooltip(activo)}
          x={xDe(activo)}
          y={Math.max(M.arriba, Math.min(yDe(valores[activo]), hayAnterior ? yDe(anterior![activo]) : Infinity)) - 4}
          anchoContenedor={ancho}
          debajo={Math.min(yDe(valores[activo]), hayAnterior ? yDe(anterior![activo]) : Infinity) < M.arriba + 70}
        />
      )}

      <p className="sr-only" aria-live="polite">{anuncio}</p>
    </div>
  );
}
