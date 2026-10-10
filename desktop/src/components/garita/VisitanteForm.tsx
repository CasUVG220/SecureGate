/**
 * Formulario de registro de acceso. Es a la vez el flujo normal y el
 * fallback manual (punto 8 del sprint): siempre está visible y editable.
 *
 * `capturado_manualmente` = el DPI NO salió del OCR. Se enciende solo al
 * teclear el número y el agente puede forzarlo; viaja hasta el backend para
 * auditoría.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type FormEvent } from 'react';
import { Alert } from '../shared/Alert';
import { Button, Input, Textarea } from '../ui';
import { api, mensajeDe, type Evaluacion, type InvitacionQr, type Residente, type ResultadoApertura } from '../../lib/tauri';
import { esValida, formatear, normalizar } from '../../lib/placa';
import { diaCorto } from '../../lib/tiempo';

export interface VisitanteFormHandle {
  /** Rellena la placa (desde el OCR). */
  setPlaca: (placa: string) => void;
  /** Rellena nombre + DPI desde el OCR de DPI. */
  setDesdeOcrDpi: (nombre: string, numeroDpi: string) => void;
  /** Rellena el formulario con una invitación QR ya verificada. */
  setDesdeQr: (inv: InvitacionQr) => void;
  /** Lleva el cursor al campo de la placa (alternativa a la cámara: «Escribir placa»). */
  enfocarPlaca: () => void;
}

interface Props {
  habilitado: boolean;
  /** El acceso ya quedó guardado; `apertura` dice si la talanquera abrió. */
  onRegistrado: (apertura: ResultadoApertura) => void;
}

const DPI_RE = /^\d{13}$/;

/** Campos que el agente teclea a ojo: más altos, monoespaciados y separados. */
const CAMPO_GRANDE = 'min-h-control-lg font-mono text-lg tracking-widest';
const ICON_SEARCH = 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35';

export const VisitanteForm = forwardRef<VisitanteFormHandle, Props>(function VisitanteForm({ habilitado, onRegistrado }, ref) {
  const [nombre, setNombre] = useState('');
  const [dpi, setDpi] = useState('');
  const [placa, setPlaca] = useState('');
  const [notas, setNotas] = useState('');
  const [manual, setManual] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Residente[]>([]);
  const [residente, setResidente] = useState<Residente | null>(null);
  const [evaluacion, setEvaluacion] = useState<Evaluacion | null>(null);
  /** Invitación QR en curso: viaja al backend para contar el uso. */
  const [qr, setQr] = useState<InvitacionQr | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const placaRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    setPlaca: p => setPlaca(p),
    enfocarPlaca: () => {
      placaRef.current?.focus();
      placaRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    },
    setDesdeOcrDpi: (n, d) => {
      if (n) setNombre(n);
      if (d) { setDpi(d); setManual(false); }
    },
    // El QR trae la casa y, en las individuales, el visitante. Lo que traiga
    // se rellena; lo que no, lo completa el agente. El DPI sigue marcándose
    // como manual salvo que venga en la invitación: es el dato que se audita.
    setDesdeQr: inv => {
      setQr(inv);
      setResidente({
        id: inv.residente_id,
        numero_casa: inv.numero_casa,
        nombre: inv.residente_nombre,
        estado_pago: 'al_dia',
        telefono: null,
      });
      setBusqueda('');
      setResultados([]);
      if (inv.nombre_visitante) setNombre(inv.nombre_visitante);
      if (inv.numero_dpi) { setDpi(inv.numero_dpi); setManual(false); }
      if (inv.placa) setPlaca(inv.placa);
    },
  }));

  // Búsqueda de residentes contra el espejo local (sin red).
  useEffect(() => {
    if (!busqueda.trim()) { setResultados([]); return; }
    let vivo = true;
    const t = window.setTimeout(() => {
      api.garita.buscarResidentes(busqueda).then(r => { if (vivo) setResultados(r); }).catch(() => {});
    }, 120);
    return () => { vivo = false; window.clearTimeout(t); };
  }, [busqueda]);

  // Evaluación local (blacklist / preautorización) al tener DPI o placa.
  useEffect(() => {
    const d = dpi.trim();
    const p = placa.trim();
    if (d.length < 6 && !esValida(p)) { setEvaluacion(null); return; }
    let vivo = true;
    const t = window.setTimeout(() => {
      api.garita.evaluarVisitante(d, esValida(p) ? normalizar(p) : null, residente?.id ?? null)
        .then(ev => {
          if (!vivo) return;
          setEvaluacion(ev);
          if (ev.visitante_conocido && !nombre) setNombre(ev.visitante_conocido);
        })
        .catch(() => {});
    }, 200);
    return () => { vivo = false; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpi, placa, residente?.id]);

  const limpiar = () => {
    setNombre(''); setDpi(''); setPlaca(''); setNotas(''); setManual(true);
    setBusqueda(''); setResidente(null); setEvaluacion(null); setError(null);
    setQr(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (!residente) { setError('Selecciona la casa/residente que visita.'); return; }
    if (!DPI_RE.test(dpi.trim())) { setError('El DPI debe tener 13 dígitos.'); return; }
    if (placa.trim() && !esValida(placa)) { setError('La placa no tiene un formato válido (ej. P123ABC).'); return; }
    setEnviando(true);
    try {
      const { acceso: fila, apertura } = await api.garita.registrarAcceso({
        nombre_visitante: nombre.trim(),
        numero_dpi: dpi.trim(),
        residente_id: residente.id,
        placa: placa.trim() ? normalizar(placa) : null,
        notas: notas.trim() || null,
        capturado_manualmente: manual,
        invitacion_qr_id: qr?.id ?? null,
      });
      setOk(`Acceso de ${fila.nombre_visitante} registrado para ${fila.residente_casa ?? 'la casa'}. Se sincroniza en segundo plano.`);
      limpiar();
      onRegistrado(apertura);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setEnviando(false);
    }
  };

  const bloqueado = evaluacion?.bloqueado ?? false;

  return (
    <form onSubmit={submit} className="space-y-4" aria-disabled={!habilitado}>
      {!habilitado && <Alert tone="warn">La licencia o la sesión no permiten registrar accesos ahora.</Alert>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Número de DPI"
          className={CAMPO_GRANDE}
          inputMode="numeric"
          placeholder="13 dígitos"
          value={dpi}
          onChange={e => { setDpi(e.target.value.replace(/\D/g, '').slice(0, 13)); setManual(true); }}
          error={dpi && !DPI_RE.test(dpi) ? 'Debe tener 13 dígitos' : null}
        />
        <Input
          ref={placaRef}
          label="Placa (opcional)"
          className={CAMPO_GRANDE}
          placeholder="P-123ABC"
          value={placa}
          onChange={e => setPlaca(e.target.value.toUpperCase())}
          error={placa && !esValida(placa) ? 'Formato: prefijo + 3 dígitos + 3 letras' : null}
          hint={placa && esValida(placa) ? formatear(placa) : undefined}
          spellCheck={false}
        />
      </div>

      <Input label="Nombre del visitante" value={nombre} onChange={e => setNombre(e.target.value)} required maxLength={150} />

      {qr && (
        <Alert tone="ok">
          <strong>Invitación QR válida</strong> para {qr.numero_casa} · {qr.residente_nombre}
          {qr.etiqueta ? ` · ${qr.etiqueta}` : ''}
          {qr.usos_maximos != null && ` · uso ${qr.usos_actuales + 1} de ${qr.usos_maximos}`}
          {!qr.numero_dpi && '. Pide el DPI y captúralo antes de registrar.'}
        </Alert>
      )}

      {evaluacion && (
        bloqueado
          ? <Alert tone="bad">
              <strong>{evaluacion.motivo_bloqueo === 'placa' ? 'Vehículo en lista negra:' : 'En lista negra:'}</strong>{' '}
              {evaluacion.razon_bloqueo}. No se puede registrar el acceso.
            </Alert>
          : evaluacion.preautorizado
            ? <Alert tone="ok">Visita avisada por el residente{evaluacion.preautorizacion?.fecha_fin ? ` hasta el ${diaCorto(evaluacion.preautorizacion.fecha_fin)}` : ''}.</Alert>
            : null
      )}

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-gray-300" htmlFor="busq-residente">Casa / residente que visita</label>
        {residente ? (
          <div className="sg-input flex items-center justify-between gap-3">
            <span className="truncate text-gray-100">
              <strong>{residente.numero_casa}</strong> · {residente.nombre}
              {residente.estado_pago === 'mora' && <span className="text-xs font-semibold text-warning-400"> · en mora</span>}
            </span>
            <Button variant="ghost" size="sm" onClick={() => { setResidente(null); setBusqueda(''); }}>Cambiar</Button>
          </div>
        ) : (
          <>
            <Input
              id="busq-residente"
              icon={ICON_SEARCH}
              placeholder="Buscar por casa o nombre…"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              autoComplete="off"
              hint={busqueda.trim() && resultados.length === 0 ? 'Sin coincidencias en los datos locales.' : undefined}
            />
            {resultados.length > 0 && (
              <ul className="mt-1.5 max-h-56 divide-y divide-gray-700 overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 shadow-md">
                {resultados.map(r => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-500/12 hover:text-gray-50"
                      onClick={() => { setResidente(r); setResultados([]); }}
                    >
                      <span className="truncate"><strong>{r.numero_casa}</strong> · {r.nombre}</span>
                      {r.estado_pago === 'mora' && <span className="shrink-0 text-xs font-semibold text-warning-400">en mora</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <Textarea label="Notas (opcional)" value={notas} onChange={e => setNotas(e.target.value)} maxLength={500} rows={2} />

      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-gray-200">
        <input type="checkbox" className="h-4 w-4 rounded border-gray-500 accent-brand-500" checked={manual} onChange={e => setManual(e.target.checked)} />
        DPI capturado manualmente (sin OCR) — queda marcado en auditoría
      </label>

      {error && <Alert tone="bad">{error}</Alert>}
      {ok && <Alert tone="ok">{ok}</Alert>}

      <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
        {/* El motivo de un botón apagado se lee en pantalla, no solo en el tooltip. */}
        {(!habilitado || bloqueado) && (
          <p role="status" className="mr-auto text-xs font-medium text-warning-400">
            {!habilitado
              ? 'No se puede registrar: revisa la licencia o la sesión del agente.'
              : 'No se puede registrar: el visitante o el vehículo está en la lista negra.'}
          </p>
        )}
        <Button variant="ghost" onClick={limpiar}>Limpiar</Button>
        <Button type="submit" size="lg" loading={enviando} disabled={!habilitado || bloqueado}>
          Registrar entrada
        </Button>
      </div>
    </form>
  );
});
