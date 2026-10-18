/**
 * Configuración de los carriles del ANPR (Sprint 10). Se guarda en la base cifrada de ESTE equipo (como la talanquera y las
 * cámaras): es del puesto, no del agente de turno.
 *
 * Por carril: nombre, cámara IP fija, sentido, modo (un carril nuevo nace APAGADO; al activarlo el modo propuesto es
 * Automático), el área de la imagen donde se mira (se dibuja con clics sobre una foto de la cámara), umbrales avanzados y el
 * actuador de la barrera con su prueba.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Button, Input, Modal, Select, StatusText } from '../ui';
import { Alert } from '../shared/Alert';
import {
  ACTUADOR_TEXTO, carrilNuevo, MAX_PUNTOS_ROI, MODO_AL_ACTIVAR, MODO_TEXTO, problemaRoi, problemaUrlRele, puntoDeClic,
  puntosSvg, RELE_DEFECTO, SENTIDO_TEXTO,
} from '../../lib/anpr';
import {
  api, mensajeDe,
  type CamaraRed, type Carril, type ConfigActuador, type MetodoHttp, type ModoCarril, type SentidoCarril, type UmbralesCarril,
} from '../../lib/tauri';

interface Props {
  onCerrar: () => void;
  /** Se guardó o eliminó un carril: la pantalla vuelve a pedir el estado. */
  onCambio: () => void;
}

export function AnprConfigDialog({ onCerrar, onCambio }: Props) {
  const [carriles, setCarriles] = useState<Carril[]>([]);
  const [camaras, setCamaras] = useState<CamaraRed[]>([]);
  const [editando, setEditando] = useState<Carril | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = async (elegir?: string) => {
    try {
      const [cs, cams] = await Promise.all([api.anpr.carriles(), api.camaras.listar()]);
      setCarriles(cs);
      setCamaras(cams.filter(c => c.tipo !== 'usb'));
      setEditando(cs.find(c => c.id === elegir) ?? cs[0] ?? null);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { void cargar(); }, []);

  const nuevo = () => setEditando(carrilNuevo(carriles, camaras[0]?.id ?? null));

  return (
    <Modal
      open
      onClose={onCerrar}
      title="Carriles del ANPR"
      description="Una cámara IP fija por carril. Se guarda en este equipo, cifrado."
      size="xl"
    >
      {error && <Alert tone="bad" className="mb-4">{error}</Alert>}
      <div className="grid gap-5 md:grid-cols-[200px_1fr]">
        <nav aria-label="Carriles" className="space-y-1">
          {carriles.map(c => (
            <button
              key={c.id}
              type="button"
              aria-current={editando?.id === c.id ? 'true' : undefined}
              onClick={() => setEditando(c)}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${editando?.id === c.id ? 'bg-brand-500/12 font-semibold text-gray-50' : 'text-gray-300 hover:bg-gray-500/12'}`}
            >
              {c.nombre}
              <span className="block text-2xs text-gray-400">{c.modo === 'apagado' ? 'Apagado' : MODO_TEXTO[c.modo].split(' (')[0]}</span>
            </button>
          ))}
          <Button size="sm" variant="secondary" fullWidth onClick={nuevo} disabled={cargando}>Nuevo carril</Button>
        </nav>
        <div>
          {cargando ? (
            <p className="text-sm text-gray-400">Cargando…</p>
          ) : camaras.length === 0 && !editando ? (
            <Alert tone="info">
              Primero agrega una cámara IP (Cámaras → Agregar cámara). Las cámaras USB no sirven para el ANPR: las abre la pantalla, no
              el equipo.
            </Alert>
          ) : editando ? (
            <FormCarril
              key={editando.id}
              inicial={editando}
              camaras={camaras}
              existe={carriles.some(c => c.id === editando.id)}
              onGuardado={c => { void cargar(c.id); onCambio(); }}
              onEliminado={() => { void cargar(); onCambio(); }}
              onCancelar={onCerrar}
            />
          ) : (
            <p className="text-sm text-gray-400">Crea el primer carril con «Nuevo carril».</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function FormCarril({ inicial, camaras, existe, onGuardado, onEliminado, onCancelar }: {
  inicial: Carril; camaras: CamaraRed[]; existe: boolean;
  onGuardado: (c: Carril) => void; onEliminado: () => void; onCancelar: () => void;
}) {
  const [c, setC] = useState<Carril>(inicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirmarBaja, setConfirmarBaja] = useState(false);

  const activo = c.modo !== 'apagado';
  const set = (parcial: Partial<Carril>) => { setC(x => ({ ...x, ...parcial })); setOk(null); };
  const setUmbral = (k: keyof UmbralesCarril, v: string, escala = 1) => {
    const n = v.trim() === '' ? null : Number(v) * escala;
    set({ umbrales: { ...c.umbrales, [k]: n == null || Number.isNaN(n) ? null : n } });
  };

  const problemas = useMemo(() => {
    const p: string[] = [];
    if (!c.nombre.trim()) p.push('Ponle un nombre al carril.');
    if (activo && !c.camara_id) p.push('Elige la cámara del carril antes de activarlo.');
    const roi = problemaRoi(c.roi);
    if (roi) p.push(roi);
    if (c.actuador.tipo === 'rele_http') {
      const u = problemaUrlRele(c.actuador.url);
      if (u) p.push(u);
    }
    return p;
  }, [c, activo]);

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (problemas.length) { setError(problemas[0]); return; }
    setGuardando(true);
    setError(null);
    try {
      const g = await api.anpr.guardarCarril({ ...c, nombre: c.nombre.trim() });
      setOk('Carril guardado.');
      onGuardado(g);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async () => {
    setGuardando(true);
    try {
      await api.anpr.eliminarCarril(c.id);
      onEliminado();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setGuardando(false);
      setConfirmarBaja(false);
    }
  };

  return (
    <form onSubmit={guardar} className="space-y-5" aria-label={`Carril ${c.nombre}`}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Nombre" required maxLength={60} value={c.nombre} onChange={e => set({ nombre: e.target.value })} />
        <Select label="Cámara" value={c.camara_id ?? ''} onChange={e => set({ camara_id: e.target.value || null, roi: [] })}>
          <option value="">Sin cámara</option>
          {camaras.map(cam => <option key={cam.id} value={cam.id}>{cam.nombre}</option>)}
        </Select>
        <Select label="Sentido" value={c.sentido} onChange={e => set({ sentido: e.target.value as SentidoCarril })}
          hint={c.sentido === 'salida' ? 'Cierra el acceso abierto del vehículo que sale.' : undefined}>
          {(Object.keys(SENTIDO_TEXTO) as SentidoCarril[]).map(s => <option key={s} value={s}>{SENTIDO_TEXTO[s]}</option>)}
        </Select>
      </div>

      <fieldset className="space-y-3 rounded-lg border border-gray-700 p-4">
        <legend className="px-1 text-xs font-semibold text-gray-300">Modo</legend>
        <label className="flex items-center gap-2 text-sm font-semibold text-gray-100">
          <input
            type="checkbox"
            checked={activo}
            onChange={e => set({ modo: e.target.checked ? MODO_AL_ACTIVAR : 'apagado' })}
            className="h-4 w-4 accent-brand-500"
          />
          Reconocer placas en este carril
        </label>
        {activo && (
          <div className="space-y-1.5 pl-6">
            {(['automatico', 'verificacion'] as ModoCarril[]).map(m => (
              <label key={m} className="flex items-center gap-2 text-sm text-gray-200">
                <input type="radio" name={`modo-${c.id}`} value={m} checked={c.modo === m} onChange={() => set({ modo: m })} className="accent-brand-500" />
                {MODO_TEXTO[m]}
              </label>
            ))}
            <p className="text-xs text-gray-400">
              Aun en automático, nunca abre sola con lista negra, empresa suspendida, una placa desconocida o una lectura dudosa: esas
              te llegan para verificar.
            </p>
          </div>
        )}
      </fieldset>

      <EditorRoi camaraId={c.camara_id} roi={c.roi} onRoi={roi => set({ roi })} />

      <details className="rounded-lg border border-gray-700 p-4">
        <summary className="cursor-pointer text-xs font-semibold text-gray-300">Ajustes avanzados (vacío = valor recomendado)</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Input label="Sensibilidad al movimiento" type="number" min={0.0001} max={1} step={0.001} placeholder="0.02"
            value={c.umbrales.umbral_cambio ?? ''} onChange={e => setUmbral('umbral_cambio', e.target.value)}
            hint="Fracción del área que debe cambiar (0,0001–1)." />
          <Input label="Lecturas iguales para confirmar" type="number" min={1} max={5} placeholder="3"
            value={c.umbrales.min_coincidencias ?? ''} onChange={e => setUmbral('min_coincidencias', e.target.value)} />
          <Input label="Confianza mínima" type="number" min={0.5} max={1} step={0.01} placeholder="0.90"
            value={c.umbrales.confianza_min ?? ''} onChange={e => setUmbral('confianza_min', e.target.value)} hint="Entre 0,50 y 1." />
          <Input label="Tiempo máximo de lectura (s)" type="number" min={0.5} max={60} step={0.5} placeholder="4"
            value={c.umbrales.tiempo_max_lectura_ms != null ? c.umbrales.tiempo_max_lectura_ms / 1000 : ''}
            onChange={e => setUmbral('tiempo_max_lectura_ms', e.target.value, 1000)} />
          <Input label="Cuadros por segundo con movimiento" type="number" min={0.5} max={10} step={0.5} placeholder="5"
            value={c.umbrales.fps_activo ?? ''} onChange={e => setUmbral('fps_activo', e.target.value)}
            hint="Bájalo si el equipo se pone lento." />
        </div>
      </details>

      <Actuador config={c.actuador} onConfig={actuador => set({ actuador })} />

      {problemas.length > 0 && <p role="status" className="text-xs font-medium text-warning-400">{problemas[0]}</p>}
      {error && <Alert tone="bad">{error}</Alert>}
      {ok && <Alert tone="ok">{ok}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-700 pt-4">
        <div>
          {existe && (confirmarBaja ? (
            <span className="flex items-center gap-2 text-sm text-gray-300">
              ¿Eliminar «{c.nombre}»?
              <Button size="sm" variant="danger" loading={guardando} onClick={() => void eliminar()}>Sí, eliminar</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmarBaja(false)}>No</Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmarBaja(true)}>Eliminar carril</Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancelar}>Cerrar</Button>
          <Button type="submit" loading={guardando}>Guardar</Button>
        </div>
      </div>
    </form>
  );
}

/** Área del carril: clic sobre una foto de la cámara para marcar cada punto del polígono. */
function EditorRoi({ camaraId, roi, onRoi }: { camaraId: string | null; roi: [number, number][]; onRoi: (r: [number, number][]) => void }) {
  const [foto, setFoto] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caja = useRef<HTMLDivElement>(null);

  const tomarFoto = async () => {
    if (!camaraId) return;
    setPidiendo(true);
    setError(null);
    try {
      setFoto((await api.camaras.fotograma(camaraId)).jpeg_base64);
    } catch (e) {
      setError(`No se pudo traer una imagen de la cámara: ${mensajeDe(e)}`);
    } finally {
      setPidiendo(false);
    }
  };

  const marcar = (e: MouseEvent<HTMLDivElement>) => {
    if (!caja.current || roi.length >= MAX_PUNTOS_ROI) return;
    onRoi([...roi, puntoDeClic(e.clientX, e.clientY, caja.current.getBoundingClientRect())]);
  };

  return (
    <fieldset className="space-y-3 rounded-lg border border-gray-700 p-4">
      <legend className="px-1 text-xs font-semibold text-gray-300">Área del carril</legend>
      <p className="text-xs text-gray-400">
        Marca con clics el contorno del carril (donde pasan los vehículos, sin el carril vecino ni la acera). Sin puntos se usa todo
        el cuadro.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" loading={pidiendo} disabled={!camaraId} onClick={() => void tomarFoto()}>
          {foto ? 'Tomar otra foto' : 'Tomar foto de la cámara'}
        </Button>
        <Button size="sm" variant="ghost" disabled={roi.length === 0} onClick={() => onRoi(roi.slice(0, -1))}>Deshacer punto</Button>
        <Button size="sm" variant="ghost" disabled={roi.length === 0} onClick={() => onRoi([])}>Todo el cuadro</Button>
        <StatusText kind={roi.length === 0 ? 'off' : roi.length >= 3 ? 'on' : 'warn'}>
          {roi.length === 0 ? 'Todo el cuadro' : `${roi.length} punto${roi.length === 1 ? '' : 's'}`}
        </StatusText>
      </div>
      {error && <Alert tone="warn">{error}</Alert>}
      {foto && (
        <div
          ref={caja}
          role="img"
          aria-label={`Foto de la cámara con el área marcada (${roi.length} puntos). Haz clic para agregar un punto.`}
          onClick={marcar}
          data-testid="editor-roi"
          className="relative w-full cursor-crosshair overflow-hidden rounded-lg border border-gray-700"
        >
          <img src={`data:image/jpeg;base64,${foto}`} alt="" className="block w-full select-none" draggable={false} />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
            {roi.length >= 3 && (
              <polygon points={puntosSvg(roi)} fill="rgb(var(--c-brand-400) / 0.18)" stroke="rgb(var(--c-brand-400))" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
            )}
            {roi.length > 0 && roi.length < 3 && (
              <polyline points={roi.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')} fill="none" stroke="rgb(var(--c-brand-400))" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
            )}
            {roi.map(([x, y], i) => <circle key={i} cx={x * 100} cy={y * 100} r="0.9" fill="rgb(var(--c-brand-400))" />)}
          </svg>
        </div>
      )}
    </fieldset>
  );
}

function Actuador({ config, onConfig }: { config: ConfigActuador; onConfig: (c: ConfigActuador) => void }) {
  const [probando, setProbando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const rele = config.tipo === 'rele_http' ? config : null;

  const probar = async () => {
    setProbando(true);
    setResultado(null);
    try {
      setResultado({ ok: true, texto: await api.anpr.probarActuador(config) });
    } catch (e) {
      setResultado({ ok: false, texto: mensajeDe(e) });
    } finally {
      setProbando(false);
    }
  };

  const cambiarTipo = (t: ConfigActuador['tipo']) => {
    setResultado(null);
    onConfig(t === 'rele_http' ? { ...RELE_DEFECTO } : { tipo: t });
  };

  return (
    <fieldset className="space-y-3 rounded-lg border border-gray-700 p-4">
      <legend className="px-1 text-xs font-semibold text-gray-300">Barrera</legend>
      <Select label="Qué abre cuando un residente entra solo" value={config.tipo} onChange={e => cambiarTipo(e.target.value as ConfigActuador['tipo'])}>
        {(Object.keys(ACTUADOR_TEXTO) as ConfigActuador['tipo'][]).map(t => <option key={t} value={t}>{ACTUADOR_TEXTO[t]}</option>)}
      </Select>
      {rele && (
        <div className="grid gap-4 sm:grid-cols-[1fr_120px_140px]">
          <Input label="Dirección del relé" placeholder="http://192.168.1.50/abrir" value={rele.url}
            onChange={e => onConfig({ ...rele, url: e.target.value })} hint="La que indique el integrador (IP de la red local)." />
          <Select label="Método" value={rele.metodo} onChange={e => onConfig({ ...rele, metodo: e.target.value as MetodoHttp })}>
            <option value="get">GET</option>
            <option value="post">POST</option>
          </Select>
          <Input label="Espera (s)" type="number" min={0.2} max={10} step={0.1} value={rele.timeout_ms / 1000}
            onChange={e => {
              const s = Number(e.target.value);
              onConfig({ ...rele, timeout_ms: Number.isFinite(s) ? Math.round(Math.min(10, Math.max(0.2, s)) * 1000) : rele.timeout_ms });
            }}
            hint="Se reintenta una vez." />
          {rele.metodo === 'post' && (
            <Input label="Cuerpo (opcional)" placeholder='{"relay":1}' value={rele.cuerpo ?? ''} wrapperClassName="sm:col-span-3"
              onChange={e => onConfig({ ...rele, cuerpo: e.target.value || null })} className="font-mono" />
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" loading={probando} disabled={!!rele && !!problemaUrlRele(rele.url)} onClick={() => void probar()}>
          Probar barrera
        </Button>
        {resultado && <p role="status" className={`text-xs font-medium ${resultado.ok ? 'text-success-400' : 'text-danger-400'}`}>{resultado.texto}</p>}
      </div>
      <p className="text-xs text-gray-400">Si la barrera falla, el acceso igual queda registrado y la pantalla te avisa para abrir a mano.</p>
    </fieldset>
  );
}
