import Skeleton from '../ui/Skeleton';
import { cx } from '../ui/cx';
import type { Comparacion, Direccion } from './format';

/*
 * Resumen de cifras de un panel.
 *
 * Reemplaza la fila de cuatro tarjetas iguales (etiqueta en mayúsculas, ícono
 * en un recuadro, número, píldora, adorno) que se repetía en todos los paneles.
 * Ese formato no dice cuál cifra importa y llena espacio con decoración. Aquí:
 *
 *   - una cifra manda, con su gráfico debajo (la tendencia ES el contexto);
 *   - el resto va en filas, y cada trazo informa: la barra es el valor y la
 *     marca vertical el periodo anterior, o la barra es una proporción real;
 *   - la variación se escribe ("↑ 25 % frente a 366…"), sin píldoras;
 *   - una fila puede llevar una acción real (ir a verificar pagos), nunca un
 *     "Ver →" que no lleva a ningún lado.
 */

const FLECHA: Record<Direccion, string> = { sube: '↑', baja: '↓', igual: '→' };

/** "↑ 25 % frente a 366…": el signo lleva color sólo si subir o bajar tiene un juicio. */
export function Variacion({ c, className }: { c: Comparacion; className?: string }) {
  const juicio = c.pct != null && c.dir !== 'igual' && c.bueno ? (c.dir === c.bueno ? 'bien' : 'mal') : null;
  return (
    <span className={cx('text-sm text-gray-400', className)}>
      {c.pct != null && (
        <span
          className={cx(
            'mr-1.5 font-semibold tabular-nums',
            juicio === 'bien' && 'text-success-400',
            juicio === 'mal' && 'text-danger-400',
            juicio === null && 'text-gray-200',
          )}
        >
          <span aria-hidden="true">{FLECHA[c.dir]} </span>
          {c.pct}
        </span>
      )}
      {c.texto}
    </span>
  );
}

export type TonoMedidor = 'success' | 'warning' | 'danger' | 'series';

const MEDIDOR: Record<TonoMedidor, { relleno: string; pista: string }> = {
  success: { relleno: 'bg-success-500', pista: 'bg-success-500/15' },
  warning: { relleno: 'bg-warning-500', pista: 'bg-warning-500/15' },
  danger:  { relleno: 'bg-danger-500',  pista: 'bg-danger-500/15' },
  series:  { relleno: 'bg-viz-series',  pista: 'bg-viz-series/15' },
};

/** Proporción contra un total. La pista es el mismo tono, más tenue: se lee la barra entera. */
export function Medidor({ fraccion, tono, etiqueta }: { fraccion: number; tono: TonoMedidor; etiqueta: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, fraccion)) * 100);
  return (
    <div
      role="meter"
      aria-label={etiqueta}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cx('h-1.5 w-full overflow-hidden rounded-full', MEDIDOR[tono].pista)}
    >
      <div className={cx('h-full rounded-full transition-[width] duration-500 ease-out', MEDIDOR[tono].relleno)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Barra de bala: el relleno es el valor actual y la marca vertical, el
 * anterior. Se ve de un golpe si se superó o no la referencia.
 */
export function BarraComparada({ valor, anterior, etiqueta }: { valor: number; anterior: number; etiqueta: string }) {
  const escala = Math.max(valor, anterior) * 1.08 || 1;
  return (
    <div role="img" aria-label={etiqueta} title={etiqueta} className="relative h-1.5 w-full rounded-full bg-gray-500/12">
      <div
        className="h-full rounded-full bg-viz-series transition-[width] duration-500 ease-out"
        style={{ width: `${(valor / escala) * 100}%` }}
      />
      {anterior > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-gray-300 ring-2 ring-[rgb(var(--c-surface))]"
          style={{ left: `${(anterior / escala) * 100}%` }}
        />
      )}
    </div>
  );
}

export type Barra =
  | { tipo: 'comparada'; valor: number; anterior: number; etiqueta: string }
  | { tipo: 'proporcion'; fraccion: number; tono: TonoMedidor; etiqueta: string };

export interface CifraFila {
  id: string;
  etiqueta: string;
  valor: string;
  comparacion?: Comparacion;
  /** Texto secundario cuando no hay comparación ("49 de 64 · 6 en mora"). */
  nota?: string;
  barra?: Barra;
  /** Marca la fila como algo que requiere atención (ícono + color, nunca color solo). */
  atencion?: 'warning' | 'danger';
  accion?: { texto: string; onClick: () => void };
}

export interface CifraPrincipal {
  etiqueta: string;
  valor: string;
  comparacion?: Comparacion;
  nota?: React.ReactNode;
  grafico?: React.ReactNode;
}

const ALERTA = 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01';

function Fila({ f }: { f: CifraFila }) {
  return (
    <li className="flex min-w-0 flex-1 flex-col justify-center gap-2.5 px-5 py-4 sm:px-6">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-gray-300">
          {f.atencion && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                 className={cx('shrink-0', f.atencion === 'danger' ? 'text-danger-400' : 'text-warning-400')}>
              <path d={ALERTA} />
            </svg>
          )}
          <span className="truncate">{f.etiqueta}</span>
        </span>
        <span className="shrink-0 text-xl font-semibold tabular-nums tracking-tight text-gray-50">{f.valor}</span>
      </div>
      {f.barra && (f.barra.tipo === 'comparada'
        ? <BarraComparada valor={f.barra.valor} anterior={f.barra.anterior} etiqueta={f.barra.etiqueta} />
        : <Medidor fraccion={f.barra.fraccion} tono={f.barra.tono} etiqueta={f.barra.etiqueta} />)}
      {(f.comparacion || f.nota || f.accion) && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {f.comparacion ? <Variacion c={f.comparacion} className="text-xs" /> : <span className="text-xs text-gray-400">{f.nota}</span>}
          {f.accion && (
            <button
              type="button"
              onClick={f.accion.onClick}
              className="shrink-0 rounded text-xs font-semibold text-gray-200 underline decoration-gray-500/50 underline-offset-4 transition-colors hover:text-gray-50 hover:decoration-gray-300"
            >
              {f.accion.texto}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export default function ResumenCifras({ principal, filas, ariaLabel, className }: {
  principal: CifraPrincipal;
  filas: CifraFila[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <section
      aria-label={ariaLabel}
      className={cx(
        'sg-card grid overflow-hidden',
        filas.length > 0 && 'lg:grid-cols-[minmax(0,1.65fr)_minmax(17rem,1fr)]',
        className,
      )}
    >
      <div className="min-w-0 p-5 sm:p-6">
        <h2 className="text-sm font-medium text-gray-400">{principal.etiqueta}</h2>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="text-[2.75rem] font-semibold leading-none tracking-tight text-gray-50">{principal.valor}</p>
          {principal.comparacion && <Variacion c={principal.comparacion} />}
        </div>
        {principal.nota && <div className="mt-2 text-sm text-gray-400">{principal.nota}</div>}
        {principal.grafico && <div className="mt-5">{principal.grafico}</div>}
      </div>

      {filas.length > 0 && (
        <ul className="flex flex-col divide-y divide-[rgb(var(--c-hairline))] border-t border-[rgb(var(--c-hairline))] lg:border-l lg:border-t-0">
          {filas.map(f => <Fila key={f.id} f={f} />)}
        </ul>
      )}
    </section>
  );
}

/** Esqueleto con la misma forma: la pantalla no salta cuando llegan los datos. */
export function ResumenCifrasEsqueleto({ filas = 3, grafico = true }: { filas?: number; grafico?: boolean }) {
  return (
    <div
      role="status"
      aria-label="Cargando"
      className={cx('sg-card grid overflow-hidden', filas > 0 && 'lg:grid-cols-[minmax(0,1.65fr)_minmax(17rem,1fr)]')}
    >
      <div className="space-y-3 p-5 sm:p-6">
        <Skeleton height="0.8rem" width="30%" />
        <Skeleton height="2.5rem" width="45%" />
        {grafico && <Skeleton height="10rem" className="mt-4" />}
      </div>
      {filas > 0 && (
        <div className="divide-y divide-[rgb(var(--c-hairline))] border-t border-[rgb(var(--c-hairline))] lg:border-l lg:border-t-0">
          {Array.from({ length: filas }).map((_, i) => (
            <div key={i} className="space-y-2.5 px-5 py-5 sm:px-6">
              <div className="flex justify-between"><Skeleton height="0.8rem" width="40%" /><Skeleton height="1.2rem" width="20%" /></div>
              <Skeleton height="0.375rem" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
