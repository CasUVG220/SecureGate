import type { LangKey } from '../../context/LanguageContext';
import { cx } from '../ui/cx';
import { fmtPorcentaje } from './format';

export interface Segmento {
  id: string;
  etiqueta: string;
  valor: number;
  /** Clase de fondo literal (`bg-success-500`, `bg-viz-ord-1`…). */
  color: string;
  /** Texto secundario de la leyenda (p. ej. el monto). */
  detalle?: string;
}

interface Props {
  segmentos: Segmento[];
  lang: LangKey;
  formato: (n: number) => string;
  ariaLabel: string;
  vacio?: string;
  className?: string;
}

/**
 * Parte del todo en una sola barra apilada al 100 %. Los segmentos se separan
 * con un hueco de 2 px del color de la superficie, no con un borde. La leyenda
 * lleva valor y porcentaje, así que el color nunca es el único canal.
 */
export default function SegmentedBar({ segmentos, lang, formato, ariaLabel, vacio, className }: Props) {
  const total = segmentos.reduce((a, s) => a + s.valor, 0);
  const visibles = segmentos.filter(s => s.valor > 0);

  return (
    <div className={className}>
      <div
        role="img"
        aria-label={`${ariaLabel}: ${segmentos.map(s => `${s.etiqueta} ${formato(s.valor)}`).join(', ')}`}
        className="flex h-3 w-full gap-[2px] overflow-hidden rounded-[4px]"
      >
        {total === 0 ? (
          <span className="h-full w-full bg-gray-500/10" />
        ) : visibles.map(s => (
          <span
            key={s.id}
            title={`${s.etiqueta}: ${formato(s.valor)} (${fmtPorcentaje(s.valor / total, lang)})`}
            className={cx('h-full min-w-[3px] transition-[flex-grow] duration-500 ease-out', s.color)}
            style={{ flexGrow: s.valor, flexBasis: 0 }}
          />
        ))}
      </div>

      {total === 0 && vacio ? (
        <p className="mt-3 text-sm text-gray-400">{vacio}</p>
      ) : (
        <ul className="mt-3.5 grid grid-cols-1 gap-x-5 gap-y-2.5 sm:grid-cols-2">
          {segmentos.map(s => (
            <li key={s.id} className="flex items-start gap-2.5">
              <span className={cx('mt-1 h-2.5 w-2.5 shrink-0 rounded-sm', s.color)} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm text-gray-300">{s.etiqueta}</span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-gray-50">{formato(s.valor)}</span>
                </span>
                <span className="flex items-baseline justify-between gap-2 text-2xs text-gray-400">
                  <span className="truncate">{s.detalle ?? ''}</span>
                  <span className="shrink-0 tabular-nums">{total ? fmtPorcentaje(s.valor / total, lang) : '—'}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
