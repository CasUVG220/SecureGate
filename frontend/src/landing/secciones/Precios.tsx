import type { ReactNode } from 'react';
import { cx } from '../../components/ui/cx';
import { Icono } from '../componentes/Icono';
import { Pendiente } from '../componentes/Pendiente';
import { FICHA_TECNICA, PRECIOS } from '../contenido';
import {
  CASETAS, HOGARES, PAQUETES, PAQUETE_DESTACADO, TRAMOS, casetasDe, etiquetaTramo, formatoQ, precioDe,
  type Paquete, type TramoHogares,
} from '../planes';

interface Props {
  tramo: TramoHogares;
  onTramo: (t: TramoHogares) => void;
  paquete: Paquete;
  onPaquete: (p: Paquete) => void;
  /** «Pedir demo / cotización» con el tramo elegido: el formulario lo toma como número de hogares. */
  onPedir: (t: TramoHogares) => void;
}

const P = PRECIOS;
const listaCasetas = new Intl.ListFormat('es', { type: 'conjunction' });

/**
 * Tarifario. NO son tres tarjetas con «el más popular» en medio: es una tabla comparativa de verdad (<table>, con
 * encabezados de fila y de columna), con una regla de hogares encima hecha de radios nativos (las flechas del teclado
 * funcionan solas). En teléfono la tabla muestra un paquete a la vez y se cambia con tres botones; el tramo elegido no
 * se pierde al cambiar de paquete porque los dos estados viven en el landing.
 */
export function Precios({ tramo, onTramo, paquete, onPaquete, onPedir }: Props) {
  const casetas = casetasDe(tramo);
  const aMedida = tramo === '1000+';

  return (
    <section id="precios" aria-labelledby="titulo-precios" className="bg-lienzo-hondo py-24 lg:py-36">
      <div className="l-contenedor">
        <div data-revelar className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <h2 id="titulo-precios" className="text-titulo font-extrabold lg:col-span-5">{P.titulo}</h2>
          <p className="max-w-medida text-entrada text-tinta-suave lg:col-span-6 lg:col-start-7">{P.bajada}</p>
        </div>

        <fieldset data-revelar className="relative mt-14 lg:mt-20">
          <legend className="font-titular text-entrada font-bold">Número de hogares</legend>
          <p className="l-rotulo mt-1 text-tinta-suave sm:absolute sm:right-0 sm:top-1.5 sm:mt-0" aria-live="polite">
            {casetas === null ? 'Casetas: a medida' : `Cálculo con ${casetas} ${casetas === 1 ? 'caseta' : 'casetas'}`}
          </p>
          <div className="l-regla mt-6 grid grid-cols-6">
            {TRAMOS.map(t => (
              <label key={t} className="l-regla-paso group relative cursor-pointer pt-7">
                <input
                  type="radio"
                  name="hogares"
                  value={String(t)}
                  checked={tramo === t}
                  onChange={() => onTramo(t)}
                  className="peer sr-only"
                />
                <span className="l-regla-marca" aria-hidden="true" />
                <span
                  className={cx(
                    'mt-3 block rounded-sm pr-2 font-cifra text-detalle tabular-nums leading-tight transition-colors',
                    'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-tinta',
                    tramo === t ? 'font-medium text-tinta' : 'text-tinta-suave group-hover:text-tinta',
                  )}
                >
                  {etiquetaTramo(t)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Teléfono: un paquete a la vez. */}
        <div role="group" aria-label="Paquete que se muestra" className="mt-12 grid grid-cols-3 gap-1 rounded-md bg-linea p-1 md:hidden">
          {PAQUETES.map(p => (
            <button
              key={p}
              type="button"
              aria-pressed={paquete === p}
              onClick={() => onPaquete(p)}
              className={cx(
                'min-h-11 rounded font-texto text-detalle font-semibold transition-colors',
                paquete === p ? 'bg-papel text-tinta shadow-[0_1px_2px_rgb(var(--l-tinta)/0.12)]' : 'text-tinta-suave',
              )}
            >
              {P.paquetes[p].nombre}
            </button>
          ))}
        </div>

        <div data-revelar data-paquete={paquete} className="l-tarifa mt-4 md:mt-12">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Precios para {etiquetaTramo(tramo)} hogares{casetas !== null && `, cálculo con ${casetas} ${casetas === 1 ? 'caseta' : 'casetas'}`}, en quetzales con IVA incluido
            </caption>
            <thead>
              <tr>
                <td />
                {PAQUETES.map(p => (
                  <th key={p} scope="col" data-col={p} className={cx('l-tarifa-paquete', PAQUETE_DESTACADO === p && 'l-tarifa-destacado')}>
                    {PAQUETE_DESTACADO === p && <span className="l-rotulo mb-2 block text-tinta-suave">El más pedido</span>}
                    <span className="block font-titular text-subtitulo font-bold text-tinta">{P.paquetes[p].nombre}</span>
                    <span className="mt-1 block text-detalle font-normal text-tinta-suave">{P.paquetes[p].resumen}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Fila titulo="Primer pago" monto>
                {p => (aMedida ? <AMedida /> : formatoQ(precioDe(p, tramo)!.primerPago))}
              </Fila>
              <Fila titulo="Mensualidad" monto>
                {p => (aMedida ? <AMedida /> : formatoQ(precioDe(p, tramo)!.mensualidad))}
              </Fila>
              <Fila titulo="Equipo">
                {p => p === 'licencia' ? (
                  <>
                    Lo pone la residencial y debe cumplir la{' '}
                    <a href={FICHA_TECNICA} className="inline-flex items-center gap-1 font-semibold text-tinta underline underline-offset-2">
                      ficha técnica mínima{' '}<span className="sr-only">(PDF)</span>
                      <Icono nombre="documento" tamano={15} />
                    </a>
                  </>
                ) : (
                  <>
                    <span className="block font-semibold text-tinta">{p === 'compra' ? 'Propiedad de la residencial' : 'Propiedad de SecureGate'}</span>
                    <ul className="mt-2 space-y-1">
                      {P.equipo.map(e => <li key={e} className="l-tarifa-item">{e}</li>)}
                    </ul>
                  </>
                )}
              </Fila>
              <Fila titulo="Instalación">{p => P.filas.instalacion[p]}</Fila>
              <Fila titulo="Software, soporte y actualizaciones">{p => P.filas.software[p]}</Fila>
              <Fila titulo="Mantenimiento del equipo">{p => P.filas.mantenimiento[p]}</Fila>
              <Fila titulo="Contrato mínimo">
                {p => P.filas.contrato[p] ?? <Pendiente>contrato mínimo de {P.paquetes[p].nombre}</Pendiente>}
              </Fila>
            </tbody>
          </table>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-12">
          <div className="max-w-medida space-y-2 text-detalle text-tinta-suave lg:col-span-7">
            <p className="font-semibold text-tinta">{P.notaIva}</p>
            <p>
              Cálculo con {listaCasetas.format(CASETAS.map(String))} casetas para{' '}
              {listaCasetas.format(HOGARES.map(h => etiquetaTramo(h)))} hogares. {P.notaReferencial}
            </p>
          </div>
          <div className="lg:col-span-5 lg:justify-self-end">
            <a href="#contacto" onClick={() => onPedir(tramo)} className="l-boton l-boton-primario">
              {aMedida ? 'Pedir cotización a medida' : `Pedir demo para ${etiquetaTramo(tramo)} hogares`}
              <Icono nombre="flecha" tamano={18} className="l-flecha" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function AMedida() {
  return <span className="font-texto text-cuerpo font-semibold text-tinta">{P.aMedida}</span>;
}

function Fila({ titulo, monto = false, children }: { titulo: string; monto?: boolean; children: (p: Paquete) => ReactNode }) {
  return (
    <tr className="border-t border-linea-fuerte">
      <th scope="row" className="w-[38%] py-5 pr-4 align-top text-detalle font-semibold text-tinta md:w-[22%]">{titulo}</th>
      {PAQUETES.map(p => (
        <td
          key={p}
          data-col={p}
          className={cx(
            'py-5 pr-6 align-top',
            monto ? 'font-cifra text-entrada font-medium tabular-nums text-tinta md:text-cifra' : 'text-detalle text-tinta-suave',
          )}
        >
          {children(p)}
        </td>
      ))}
    </tr>
  );
}
