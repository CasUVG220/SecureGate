/**
 * Pantalla principal de la garita: header (mismo que la web), tira de
 * estado, y tres columnas: cámara · registro · recientes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, type AlertTone } from '../components/shared/Alert';
import { LogoMark } from '../components/shared/Logo';
import { Button, Card, StatusText } from '../components/ui';
import { CameraPanel } from '../components/garita/CameraPanel';
import { EstadoStrip } from '../components/garita/EstadoStrip';
import { PlacaOcrDialog } from '../components/garita/PlacaOcrDialog';
import { RecientesList } from '../components/garita/RecientesList';
import { SalidaDialog } from '../components/garita/SalidaDialog';
import { HardwareConfigDialog } from '../components/garita/HardwareConfigDialog';
import { textoApertura } from '../lib/talanquera';
import { VisitanteForm, type VisitanteFormHandle } from '../components/garita/VisitanteForm';
import { ThemeToggle } from '../context/ThemeContext';
import { useCamarasLayout } from '../hooks/useCamarasLayout';
import { mejorCandidato } from '../lib/placa';
import { resumenLectura } from '../lib/dpi';
import { esModoSalida, type Proposito } from '../lib/camaras';
import {
  api, mensajeDe, onEstadoSync,
  type AccesoActivo, type AccesoPendiente, type EstadoApp, type ResultadoApertura, type ResultadoOcr,
} from '../lib/tauri';

interface Props {
  estado: EstadoApp;
  refrescar: () => Promise<void>;
  onLogout: () => void;
}

const ICON_SYNC = 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15';
const ICON_LOGOUT = 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9';
const ICON_GATE = 'M3 21V9l9-6 9 6v12M9 21v-8h6v8';

export function GaritaPage({ estado, refrescar, onLogout }: Props) {
  const form = useRef<VisitanteFormHandle>(null);
  const [recientes, setRecientes] = useState<AccesoPendiente[]>([]);
  const [ocrResultado, setOcrResultado] = useState<ResultadoOcr | null>(null);
  const [aviso, setAviso] = useState<{ tone: AlertTone; texto: string } | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  /** Mientras se verifica un QR el escáner se pausa para no releer el mismo. */
  const [qrOcupado, setQrOcupado] = useState(false);
  /** Tarea cuya captura se está procesando: bloquea sólo ese botón. */
  const [capturando, setCapturando] = useState<Proposito | null>(null);
  /**
   * Salida en curso: la placa leída (o vacía, para escribirla a mano) y, si se eligió a
   * alguien en «Registrados en este equipo», ese acceso ya identificado.
   */
  const [salida, setSalida] = useState<{ placa: string; acceso?: AccesoActivo } | null>(null);
  const { disposicion, cambiarLayout, cambiarPanel } = useCamarasLayout();
  const [abriendo, setAbriendo] = useState(false);
  const [configHardware, setConfigHardware] = useState(false);
  const hayDriver = estado.hardware.estado !== 'sin_driver';

  /**
   * Resultado de una apertura automática. El acceso YA está registrado
   * cuando llega aquí: si el relé falló, el agente abre a mano y sigue.
   */
  const avisarApertura = useCallback((r: ResultadoApertura, contexto: string) => {
    const t = textoApertura(r);
    if (!t) return; // sin driver: no hay nada que decir
    setAviso({ tone: r.abierta ? 'ok' : 'warn', texto: `${contexto} ${t}` });
  }, []);

  /** Botón manual: abre sin registrar nada (salida de residente, mantenimiento). */
  const abrirManual = async () => {
    setAbriendo(true);
    try {
      const r = await api.hardware.abrir();
      setAviso({ tone: r.abierta ? 'ok' : 'warn', texto: textoApertura(r) ?? 'Sin hardware configurado.' });
    } catch (e) {
      setAviso({ tone: 'warn', texto: mensajeDe(e) });
    } finally {
      setAbriendo(false);
    }
  };

  const cargarRecientes = useCallback(() => {
    // Se traen más de los que se muestran: la búsqueda de la lista recorre todo el turno.
    api.garita.recientes(150).then(setRecientes).catch(() => {});
  }, []);

  useEffect(() => {
    cargarRecientes();
    let unlisten: (() => void) | undefined;
    void onEstadoSync(() => cargarRecientes()).then(u => { unlisten = u; });
    return () => unlisten?.();
  }, [cargarRecientes]);

  const capturaPlaca = async (jpeg: string) => {
    setAviso(null);
    try {
      setOcrResultado(await api.ocr.placa(jpeg));
    } catch (e) {
      setAviso({ tone: 'warn', texto: `No se pudo leer la placa (${mensajeDe(e)}). Escríbela a mano.` });
    }
  };

  const capturaDpi = async (jpeg: string) => {
    setAviso(null);
    try {
      // Local primero (sin red); el servidor remoto solo es respaldo y solo si este equipo lo permite.
      const r = await api.ocr.dpi(jpeg);
      if (!r.cui && !r.nombre_completo) {
        setAviso({ tone: 'warn', texto: 'No se pudo leer el DPI. Captúralo manualmente.' });
        return;
      }
      // Los campos quedan en el formulario para revisarlos; el aviso no repite el número ni el nombre.
      form.current?.setDesdeOcrDpi(r);
      setAviso({ tone: r.revision_obligatoria ? 'warn' : 'info', texto: `${resumenLectura(r)}${r.aviso ? ' Se usó el respaldo remoto porque la lectura local no alcanzó.' : ''}` });
    } catch (e) {
      setAviso({ tone: 'warn', texto: `Lectura de DPI no disponible (${mensajeDe(e)}). Captúralo manualmente.` });
    }
  };

  /**
   * Carril de salida: la placa se lee con el MISMO OCR local que la entrada y
   * el diálogo busca el acceso abierto. Si el OCR no da nada legible se abre
   * igual, con el campo vacío, para escribirla a mano.
   */
  const capturaSalida = async (jpeg: string) => {
    setAviso(null);
    try {
      const r = await api.ocr.placa(jpeg);
      const candidato = mejorCandidato(r.items, r.texto);
      setSalida({ placa: candidato.valida ? candidato.placa : '' });
    } catch (e) {
      setAviso({ tone: 'warn', texto: `No se pudo leer la placa de salida (${mensajeDe(e)}). Escríbela a mano.` });
      setSalida({ placa: '' });
    }
  };

  /** Una sola puerta de entrada para las capturas de cualquier panel. */
  const capturar = async (proposito: Proposito, jpeg: string) => {
    setCapturando(proposito);
    try {
      if (proposito === 'placa') await capturaPlaca(jpeg);
      else if (proposito === 'dpi') await capturaDpi(jpeg);
      else if (proposito === 'salida') await capturaSalida(jpeg);
    } finally {
      setCapturando(null);
    }
  };

  /**
   * QR leído: se verifica contra el servidor (vigencia, usos y revocación
   * viven allí) o, sin red, contra la copia local de las invitaciones de la
   * sucursal, y si es válido rellena el formulario. El escáner queda pausado
   * unos segundos para que el agente lea el aviso en vez de releer el mismo
   * código.
   */
  const capturaQr = async (idInvitacion: string) => {
    setQrOcupado(true);
    setAviso(null);
    try {
      const inv = await api.garita.verificarQr(idInvitacion);
      form.current?.setDesdeQr(inv);
      setAviso({
        tone: 'info',
        texto: `Invitación de ${inv.numero_casa} · ${inv.residente_nombre}. Revisa los datos y registra la entrada.`
          + (inv.validada_sin_conexion ? ' Validada sin conexión: el servidor la confirma al sincronizar.' : ''),
      });
    } catch (e) {
      setAviso({ tone: 'warn', texto: `QR no válido: ${mensajeDe(e)}` });
    } finally {
      // Respiro antes de volver a escanear: sin esto el mismo código se
      // releería de inmediato y el aviso parpadearía.
      window.setTimeout(() => setQrOcupado(false), 2500);
    }
  };

  const sincronizarAhora = async () => {
    setSincronizando(true);
    try {
      await api.sync.ahora();
    } catch (e) {
      setAviso({ tone: 'warn', texto: mensajeDe(e) });
    } finally {
      setSincronizando(false);
      await refrescar();
      cargarRecientes();
    }
  };

  const habilitado = (estado.licencia.estado === 'activa' || estado.licencia.estado === 'en_gracia') && !!estado.sesion.usuario;
  const enLinea = estado.sync.en_linea;

  /**
   * Modo salida: con una sola vista de cámara y la tarea «Salida», el panel de la
   * derecha deja de hablar de entradas. Con varias vistas la pantalla sigue siendo la
   * de registro y la salida es una cámara más.
   */
  const modoSalida = esModoSalida(disposicion);

  /** Salida desde «Registrados en este equipo»: el acceso ya está identificado. */
  const salidaDeLista = (a: AccesoPendiente) => {
    if (!a.registro_id) return;
    setSalida({
      placa: a.placa ?? '',
      acceso: {
        registro_id: a.registro_id,
        timestamp_entrada: a.registrado_en,
        visitante: { id: '', nombre: a.nombre_visitante, numero_dpi: a.numero_dpi },
        residente: { id: '', numero_casa: a.residente_casa ?? '—', nombre: '' },
        placa: a.placa,
      },
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* ── Header: mismo shell que la web (frontend/src/App.tsx) ── */}
      <header className="z-header flex h-16 shrink-0 items-center justify-between gap-3 border-b border-gray-700 bg-dark-800 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <LogoMark />
          <span className="min-w-0">
            <span className="block truncate text-base font-bold tracking-tight text-gray-50">SecureGate</span>
            <span className="block truncate text-2xs font-semibold uppercase tracking-wider text-gray-400">
              Garita · {estado.licencia.sucursal_nombre ?? 'Sucursal'}
            </span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <StatusText kind={estado.sync.en_linea ? 'on' : 'warn'} className="mr-2">
            {estado.sync.en_linea ? 'En línea' : 'Sin conexión'}
          </StatusText>
          <Button
            variant={hayDriver ? 'primary' : 'ghost'}
            size="sm"
            loading={abriendo}
            disabled={!habilitado}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON_GATE} /></svg>}
            onClick={() => (hayDriver ? void abrirManual() : setConfigHardware(true))}
            title={hayDriver
              ? `Abrir sin registrar entrada (${estado.hardware.nombre})`
              : 'No hay hardware de talanquera configurado: clic para configurar'}
          >
            {hayDriver ? 'Abrir talanquera' : 'Talanquera'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={sincronizando}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON_SYNC} /></svg>}
            onClick={() => void sincronizarAhora()}
          >
            Sincronizar
          </Button>
          <ThemeToggle />
          {estado.sesion.usuario && (
            <span className="ml-1 hidden max-w-40 truncate text-sm font-medium text-gray-300 lg:block">{estado.sesion.usuario.nombre}</span>
          )}
          <button
            type="button"
            onClick={onLogout}
            title="Cerrar turno"
            className="ml-1 flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-bold text-danger-400 transition-colors hover:bg-danger-500/12"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON_LOGOUT} /></svg>
            Cerrar turno
          </button>
        </div>
      </header>

      <div className="shrink-0 space-y-3 px-5 pt-4">
        <EstadoStrip estado={estado} />
        {estado.licencia.estado === 'en_gracia' && (
          <Alert tone="warn">
            Sin contacto con el servidor. Puedes seguir trabajando: los accesos se guardan aquí y se enviarán solos al volver la conexión.
          </Alert>
        )}
      </div>

      <main
        className={`grid min-h-0 flex-1 grid-cols-1 gap-4 p-5 ${
          disposicion.layout === 1
            ? 'lg:grid-cols-[minmax(0,5fr)_minmax(0,5fr)_minmax(0,4fr)]'
            : 'lg:grid-cols-[minmax(0,8fr)_minmax(0,5fr)_minmax(0,4fr)]'
        }`}
      >
        <div className="min-h-0 space-y-4 overflow-y-auto">
          <CameraPanel
            ocrDisponible={estado.ocr.disponible}
            enLinea={estado.sync.en_linea}
            disposicion={disposicion}
            onLayout={cambiarLayout}
            onPanel={cambiarPanel}
            onCaptura={capturar}
            onQr={capturaQr}
            qrPausado={qrOcupado}
            ocupado={capturando}
            onEscribirPlaca={() => form.current?.enfocarPlaca()}
            onSalidaManual={() => setSalida({ placa: '' })}
          />
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto">
          <Card
            title={modoSalida ? 'Registrar salida' : 'Registrar acceso'}
            description={modoSalida
              ? 'Escribe la placa del vehículo que sale, o elige a la persona en «Registrados en este equipo». Se cierra el acceso que sigue abierto y requiere conexión con el servidor.'
              : 'Todo lo de este formulario se decide con los datos locales; funciona sin internet.'}
          >
            {aviso && <Alert tone={aviso.tone} className="mb-4">{aviso.texto}</Alert>}
            {modoSalida && (
              <div className="space-y-3">
                <Button
                  size="lg"
                  fullWidth
                  disabled={!enLinea || !habilitado}
                  onClick={() => setSalida({ placa: '' })}
                >
                  Escribir placa de salida
                </Button>
                {(!enLinea || !habilitado) && (
                  <p role="status" className="text-xs font-medium text-warning-400">
                    {!habilitado
                      ? 'La licencia o la sesión no permiten registrar movimientos ahora.'
                      : 'Sin conexión: la salida se registra en el servidor. Si hay que levantar la pluma, usa «Abrir talanquera».'}
                  </p>
                )}
              </div>
            )}
            {/* Sigue montado (solo oculto) en modo salida: no se pierde lo que el agente ya escribió. */}
            <div className={modoSalida ? 'hidden' : undefined}>
              <VisitanteForm
                ref={form}
                habilitado={habilitado}
                onRegistrado={apertura => { cargarRecientes(); avisarApertura(apertura, 'Acceso registrado.'); }}
              />
            </div>
          </Card>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto">
          <RecientesList accesos={recientes} enLinea={enLinea} onSalida={salidaDeLista} />
          <Card title="Equipo">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-gray-400">Servidor</dt><dd className="truncate font-mono text-xs text-gray-200">{estado.api_url}</dd>
              <dt className="text-gray-400">Versión</dt><dd className="text-gray-200">{estado.version}</dd>
              <dt className="text-gray-400">Huella</dt><dd className="font-mono text-xs text-gray-200">{estado.licencia.fingerprint.slice(0, 12)}…</dd>
              <dt className="text-gray-400">Talanquera</dt>
              <dd className="flex items-center gap-2 text-gray-200">
                <StatusText kind={estado.hardware.estado === 'conectado' ? 'on' : estado.hardware.estado === 'sin_driver' ? 'off' : 'warn'}>
                  {estado.hardware.nombre}
                </StatusText>
                <button type="button" className="text-xs font-semibold text-gray-400 underline-offset-4 hover:underline" onClick={() => setConfigHardware(true)}>
                  Configurar
                </button>
              </dd>
            </dl>
          </Card>
        </div>
      </main>

      {configHardware && (
        <HardwareConfigDialog
          actual={estado.hardware}
          onCerrar={() => setConfigHardware(false)}
          onGuardada={() => { setConfigHardware(false); void refrescar(); }}
        />
      )}

      {salida !== null && (
        <SalidaDialog
          placaInicial={salida.placa}
          accesoInicial={salida.acceso}
          onCerrar={() => setSalida(null)}
          onRegistrada={(acceso, apertura) => {
            setSalida(null);
            cargarRecientes();
            const base = `Salida registrada: ${acceso.visitante.nombre} (${acceso.residente.numero_casa}).`;
            const t = textoApertura(apertura);
            setAviso({ tone: apertura.abierta || !t ? 'ok' : 'warn', texto: t ? `${base} ${t}` : base });
          }}
        />
      )}

      {ocrResultado && (
        <PlacaOcrDialog
          resultado={ocrResultado}
          onCancelar={() => setOcrResultado(null)}
          onAceptar={placa => { form.current?.setPlaca(placa); setOcrResultado(null); }}
        />
      )}
    </div>
  );
}
