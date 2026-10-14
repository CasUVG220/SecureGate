import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { cx } from '../../components/ui/cx';
import { resolveBaseUrl } from '../../services/baseUrl';
import { Icono } from '../componentes/Icono';
import { Pendiente } from '../componentes/Pendiente';
import { validarContacto, type CampoContacto, type DatosContacto, type ErroresContacto } from '../componentes/validacionContacto';
import { CONTACTO } from '../contenido';
import type { TramoHogares } from '../planes';

type Estado =
  | { tipo: 'listo' }
  | { tipo: 'enviando' }
  | { tipo: 'exito' }
  | { tipo: 'error'; mensaje: string };

const VACIO: DatosContacto = { nombre: '', residencial: '', hogares: '', telefono: '', email: '', mensaje: '' };
const C = CONTACTO;

/** «50255551234» → «+502 5555 1234» (solo para leerlo; el enlace usa los dígitos). */
const telefonoLegible = (digitos: string) =>
  digitos.length === 11 && digitos.startsWith('502') ? `+502 ${digitos.slice(3, 7)} ${digitos.slice(7)}` : `+${digitos}`;

/**
 * Formulario «Pedir demo» → POST /api/contacto, sin recargar. Estados: enviando (botón ocupado), éxito y error, con el
 * mensaje en una región `aria-live` que además recibe el foco. Los errores de campo van junto a cada campo
 * (aria-invalid + aria-describedby), y los del servidor (400) se pintan igual. El campo `sitio_web` es la trampa para
 * robots: fuera de la pantalla, fuera del orden de tabulación y oculto a lectores de pantalla.
 *
 * `tramoSugerido`: el número de hogares que la persona eligió en la tabla de precios. Se usa mientras no toque el
 * select; nunca se impone el tramo por defecto de la tabla.
 */
export function Contacto({ tramoSugerido }: { tramoSugerido: TramoHogares | null }) {
  const [datos, setDatos] = useState<DatosContacto>(VACIO);
  const [hogaresPropio, setHogaresPropio] = useState<string | null>(null);
  const [errores, setErrores] = useState<ErroresContacto>({});
  const [estado, setEstado] = useState<Estado>({ tipo: 'listo' });
  const resultado = useRef<HTMLDivElement>(null);
  const trampa = useRef<HTMLInputElement>(null);
  const id = useId();

  const hogares = hogaresPropio ?? (tramoSugerido === null ? '' : String(tramoSugerido));
  const enviando = estado.tipo === 'enviando';

  // El foco va al mensaje de resultado en cuanto aparece (éxito o error).
  useEffect(() => {
    if (estado.tipo === 'exito' || estado.tipo === 'error') resultado.current?.focus();
  }, [estado]);

  const cambiar = (campo: CampoContacto, valor: string) => {
    setDatos(d => ({ ...d, [campo]: valor }));
    if (campo === 'hogares') setHogaresPropio(valor);
    if (errores[campo]) setErrores(e => ({ ...e, [campo]: undefined }));
  };

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (enviando) return;
    const completo = { ...datos, hogares };
    const locales = validarContacto(completo);
    if (Object.keys(locales).length > 0) {
      setErrores(locales);
      setEstado({ tipo: 'error', mensaje: C.mensajes.invalido });
      return;
    }
    setErrores({});
    setEstado({ tipo: 'enviando' });
    try {
      const r = await fetch(`${resolveBaseUrl()}/api/contacto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: completo.nombre.trim(),
          residencial: completo.residencial.trim(),
          hogares: completo.hogares,
          telefono: completo.telefono.trim(),
          email: completo.email.trim(),
          mensaje: completo.mensaje.trim(),
          sitio_web: trampa.current?.value ?? '',
        }),
      });
      if (r.status === 201) {
        setDatos(VACIO);
        setHogaresPropio(null);
        setEstado({ tipo: 'exito' });
        return;
      }
      if (r.status === 400) {
        const cuerpo = (await r.json().catch(() => ({}))) as { campos?: ErroresContacto };
        setErrores(cuerpo.campos ?? {});
        setEstado({ tipo: 'error', mensaje: C.mensajes.invalido });
        return;
      }
      setEstado({ tipo: 'error', mensaje: r.status === 429 ? C.mensajes.limite : C.mensajes.error });
    } catch {
      setEstado({ tipo: 'error', mensaje: C.mensajes.error });
    }
  };

  const campo = (nombre: CampoContacto) => ({
    id: `${id}-${nombre}`,
    name: nombre,
    'aria-invalid': errores[nombre] ? true : undefined,
    'aria-describedby': errores[nombre] ? `${id}-${nombre}-error` : undefined,
  });

  return (
    <section id="contacto" aria-labelledby="titulo-contacto" className="bg-lienzo-hondo py-24 lg:py-36">
      <div className="l-contenedor grid gap-14 lg:grid-cols-12">
        <div data-revelar className="lg:col-span-5">
          <h2 id="titulo-contacto" className="text-titulo font-extrabold">{C.titulo}</h2>
          <p className="mt-6 max-w-[44ch] text-entrada text-tinta-suave">{C.bajada}</p>

          <div className="mt-12 border-t border-linea-fuerte pt-8">
            <h3 className="font-titular text-entrada font-bold">¿Preferís escribirnos?</h3>
            <dl className="mt-5 space-y-6">
              <DatoDirecto
                etiqueta="WhatsApp"
                valor={C.whatsapp && telefonoLegible(C.whatsapp)}
                pendiente="número de WhatsApp"
                accion={
                  C.whatsapp ? (
                    <a href={`https://wa.me/${C.whatsapp}`} target="_blank" rel="noopener noreferrer" className="l-boton l-boton-secundario min-h-11 px-4 text-detalle">
                      <Icono nombre="mensaje" tamano={17} />
                      Abrir WhatsApp
                    </a>
                  ) : (
                    <button type="button" disabled className="l-boton l-boton-secundario min-h-11 cursor-not-allowed px-4 text-detalle opacity-50">
                      <Icono nombre="mensaje" tamano={17} />
                      Abrir WhatsApp
                    </button>
                  )
                }
              />
              <DatoDirecto etiqueta="Correo" valor={C.correo} pendiente="correo de contacto" />
            </dl>
          </div>
        </div>

        <div data-revelar className="lg:col-span-6 lg:col-start-7">
          <form noValidate onSubmit={enviar} aria-busy={enviando} className="rounded-lg bg-papel p-6 shadow-[0_1px_2px_rgb(var(--l-tinta)/0.06),0_18px_40px_-24px_rgb(var(--l-tinta)/0.35)] sm:p-9">
            <div
              ref={resultado}
              tabIndex={-1}
              role={estado.tipo === 'error' ? 'alert' : 'status'}
              aria-live={estado.tipo === 'error' ? 'assertive' : 'polite'}
              className={cx(
                'outline-none',
                (estado.tipo === 'exito' || estado.tipo === 'error') && 'mb-7 rounded-md border-l-4 px-4 py-3 text-detalle font-medium focus-visible:outline-2',
                estado.tipo === 'exito' && 'border-exito bg-exito/10 text-tinta',
                estado.tipo === 'error' && 'border-error bg-error/5 text-tinta',
              )}
            >
              {estado.tipo === 'exito' && C.mensajes.exito}
              {estado.tipo === 'error' && estado.mensaje}
            </div>

            <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
              <Campo etiqueta="Nombre" error={errores.nombre} errorId={`${id}-nombre-error`} htmlFor={`${id}-nombre`} className="sm:col-span-2">
                <input {...campo('nombre')} type="text" autoComplete="name" maxLength={100} required value={datos.nombre} onChange={e => cambiar('nombre', e.target.value)} className="l-campo" />
              </Campo>
              <Campo etiqueta="Residencial" error={errores.residencial} errorId={`${id}-residencial-error`} htmlFor={`${id}-residencial`}>
                <input {...campo('residencial')} type="text" autoComplete="organization" maxLength={150} required value={datos.residencial} onChange={e => cambiar('residencial', e.target.value)} className="l-campo" />
              </Campo>
              <Campo etiqueta="Número de hogares" error={errores.hogares} errorId={`${id}-hogares-error`} htmlFor={`${id}-hogares`}>
                <select {...campo('hogares')} required value={hogares} onChange={e => cambiar('hogares', e.target.value)} className="l-campo l-campo-select">
                  <option value="" disabled>Elegí una opción</option>
                  {C.hogares.map(h => <option key={h.valor} value={h.valor}>{h.texto}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Teléfono o WhatsApp" error={errores.telefono} errorId={`${id}-telefono-error`} htmlFor={`${id}-telefono`}>
                <input {...campo('telefono')} type="tel" inputMode="tel" autoComplete="tel" maxLength={20} required value={datos.telefono} onChange={e => cambiar('telefono', e.target.value)} className="l-campo" />
              </Campo>
              <Campo etiqueta="Correo" error={errores.email} errorId={`${id}-email-error`} htmlFor={`${id}-email`}>
                <input {...campo('email')} type="email" autoComplete="email" maxLength={254} required value={datos.email} onChange={e => cambiar('email', e.target.value)} className="l-campo" />
              </Campo>
              <Campo etiqueta="Mensaje" opcional error={errores.mensaje} errorId={`${id}-mensaje-error`} htmlFor={`${id}-mensaje`} className="sm:col-span-2">
                <textarea {...campo('mensaje')} rows={4} maxLength={1000} value={datos.mensaje} onChange={e => cambiar('mensaje', e.target.value)} className="l-campo resize-y" />
              </Campo>
            </div>

            {/* Trampa para robots: una persona no la ve ni llega a ella con el teclado. */}
            <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
              <label htmlFor={`${id}-sitio_web`}>Sitio web</label>
              <input ref={trampa} id={`${id}-sitio_web`} name="sitio_web" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
            </div>

            <button type="submit" disabled={enviando} className="l-boton l-boton-primario mt-8 w-full disabled:cursor-wait disabled:opacity-70 sm:w-auto">
              {enviando ? 'Enviando…' : 'Enviar solicitud'}
              {!enviando && <Icono nombre="flecha" tamano={18} className="l-flecha" />}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function Campo({ etiqueta, opcional = false, error, errorId, htmlFor, className, children }: {
  etiqueta: string; opcional?: boolean; error?: string; errorId: string; htmlFor: string; className?: string; children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-2 block text-detalle font-semibold text-tinta">
        {etiqueta}
        {opcional && <span className="font-normal text-tinta-suave"> (opcional)</span>}
      </label>
      {children}
      {error && (
        <p id={errorId} className="mt-2 text-detalle font-medium text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Dato de contacto copiable: el texto se puede seleccionar y además hay un botón «Copiar». */
function DatoDirecto({ etiqueta, valor, pendiente, accion }: { etiqueta: string; valor: string | null; pendiente: string; accion?: ReactNode }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    if (!valor) return;
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* Sin permiso para el portapapeles: el texto sigue ahí para copiarlo a mano. */
    }
  };
  return (
    <div>
      <dt className="l-rotulo text-tinta-suave">{etiqueta}</dt>
      <dd className="mt-2 flex flex-wrap items-center gap-3">
        {valor ? (
          <>
            <span className="select-all font-cifra text-entrada font-medium text-tinta">{valor}</span>
            <button type="button" onClick={copiar} className="inline-flex min-h-11 items-center gap-1.5 rounded px-3 text-detalle font-semibold text-tinta hover:bg-tinta/5">
              <Icono nombre={copiado ? 'listo' : 'copiar'} tamano={16} />
              <span aria-live="polite">{copiado ? 'Copiado' : 'Copiar'}</span>
            </button>
          </>
        ) : (
          <Pendiente>{pendiente}</Pendiente>
        )}
        {accion}
      </dd>
    </div>
  );
}
