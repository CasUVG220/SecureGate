/**
 * Una vista previa: su cámara, su guía de encuadre y su acción.
 *
 * Cada panel abre su propio dispositivo, así que con el layout de cuatro hay
 * cuatro cámaras encendidas a la vez. Es lo que pide una garita con carril de
 * entrada, mostrador y carril de salida; a cambio consume bus USB, y por eso
 * el agente puede bajar a dos o una desde la configuración.
 */
import { useEffect, useState } from 'react';
import { Button, Input, StatusText, cx } from '../ui';
import { useCamera } from '../../hooks/useCamera';
import { useCamaraRed } from '../../hooks/useCamaraRed';
import { useQrScanner } from '../../hooks/useQrScanner';
import { useQrScannerRed } from '../../hooks/useQrScannerRed';
import { camaraDeRedPara, estadoLegible } from '../../lib/camarasRed';
import type { CamaraRed } from '../../lib/tauri';
import {
  GUIA_PROPOSITO, NOMBRE_PROPOSITO, PROPOSITOS, ROTULO_PROPOSITO,
  asignacionHuerfana, idDeCodigoManual, resolverDispositivo,
  type AsignacionCamaras, type Camara, type Proposito,
} from '../../lib/camaras';

export const ICONO_PROPOSITO: Record<Proposito, string> = {
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3z',
  placa: 'M3 7h18v10H3zM7 11h2M11 11h6M7 14h10',
  dpi: 'M3 5h18v14H3zM7 9a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM6 15c0-1.7 1.3-3 3-3s3 1.3 3 3M14 9h4M14 13h4',
  salida: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
};

const ICON_CAMERA_OFF = 'M1 1l22 22M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34M12 17a4 4 0 0 1-4-4m1.17-2.83A4 4 0 0 1 16 13';

export const Icono = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** Qué necesita cada tarea para poder pulsar su botón. */
export const ACCION: Record<Proposito, { rotulo: string; requiere: 'ocr' | 'red' | null; pista: string }> = {
  // Sin red se valida contra la copia local de las invitaciones (SCRUM-126): ya no necesita el servidor.
  qr: { rotulo: '', requiere: null, pista: 'Se lee solo: muestra el QR a la cámara.' },
  placa: { rotulo: 'Leer placa', requiere: 'ocr', pista: 'Se lee en este equipo, sin internet.' },
  // El DPI se lee en este equipo (OCR local, sin internet); la foto se procesa en memoria y no sale del equipo.
  dpi: { rotulo: 'Leer DPI', requiere: 'ocr', pista: 'Se lee en este equipo, sin internet. La foto no se guarda.' },
  salida: { rotulo: 'Dar salida', requiere: 'red', pista: 'Lee la placa y cierra el acceso abierto.' },
};

interface Props {
  proposito: Proposito;
  camaras: Camara[];
  /** Cámaras IP y celulares guardadas (T8): si la tarea tiene una asignada, se usa en vez de la USB. */
  camarasRed?: CamaraRed[];
  asignacion: AsignacionCamaras;
  ocrDisponible: boolean;
  enLinea: boolean;
  /** Layout con más de un panel: se compacta y aparece el selector de tarea. */
  compacto: boolean;
  ocupado: boolean;
  onCaptura: (p: Proposito, jpegBase64: string) => Promise<void>;
  onQr: (idInvitacion: string) => Promise<void>;
  qrPausado: boolean;
  onCambiarProposito: (p: Proposito) => void;
  onConfigurar: () => void;
  /** Se llama al abrir la cámara, para releer los nombres de los dispositivos. */
  onCamaraLista: () => void;
  /** Alternativa a la cámara de placa: lleva el cursor al campo de la placa del formulario. */
  onEscribirPlaca?: () => void;
  /** Alternativa a la cámara de salida: abre el diálogo de salida con la placa vacía. */
  onSalidaManual?: () => void;
}

/**
 * Por qué no se puede pulsar el botón de la cámara, escrito para el agente. Antes el
 * botón se apagaba sin decir nada (el motivo solo estaba en el tooltip) y sin cámara
 * no había otra manera de dar una salida o registrar una placa.
 */
export function motivoDeshabilitado(
  p: { requiere: 'ocr' | 'red' | null },
  e: { activa: boolean; iniciando: boolean; ocupado: boolean; ocrDisponible: boolean; enLinea: boolean },
): string | null {
  if (e.ocupado) return null;
  if (!e.activa) return e.iniciando ? 'Abriendo la cámara…' : 'No hay cámara disponible en este panel.';
  if (p.requiere === 'ocr' && !e.ocrDisponible) return 'El OCR local no está disponible en este equipo.';
  if (p.requiere === 'red' && !e.enLinea) return 'Sin conexión: esta acción necesita el servidor.';
  return null;
}

export function CameraPane({
  proposito, camaras, camarasRed = [], asignacion, ocrDisponible, enLinea, compacto, ocupado,
  onCaptura, onQr, qrPausado, onCambiarProposito, onConfigurar, onCamaraLista,
  onEscribirPlaca, onSalidaManual,
}: Props) {
  const [codigo, setCodigo] = useState('');
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);
  const deviceId = resolverDispositivo(proposito, asignacion, camaras);
  // Cámara IP o celular asignada a esta tarea. Si cae, el agente puede pasarse a la webcam de este equipo sin salir de la pantalla.
  const camaraRed = camaraDeRedPara(proposito, camarasRed);
  const [usarWebcam, setUsarWebcam] = useState(false);
  const porRed = !!camaraRed && !usarWebcam;
  const cam = useCamera(!porRed, deviceId);
  const red = useCamaraRed(porRed ? camaraRed! : null);
  const vivoRed = porRed && red.estado?.estado === 'conectada';
  const activa = porRed ? vivoRed : cam.estado === 'activa';
  const legible = porRed ? estadoLegible(red.estado) : null;

  useEffect(() => { if (cam.estado === 'activa' && !porRed) onCamaraLista(); }, [cam.estado, porRed, onCamaraLista]);

  useQrScanner(cam.videoRef, proposito === 'qr' && activa && !porRed && !qrPausado, id => { void onQr(id); });
  useQrScannerRed(camaraRed?.id ?? null, proposito === 'qr' && vivoRed && !qrPausado, id => { void onQr(id); });

  const capturar = async () => {
    const jpeg = porRed ? await red.capturar() : cam.capturar();
    if (jpeg) await onCaptura(proposito, jpeg);
  };

  const verificarCodigo = (e: React.FormEvent) => {
    e.preventDefault();
    const id = idDeCodigoManual(codigo);
    if (!id) {
      setErrorCodigo('El código no tiene el formato correcto. Cópialo completo, tal como aparece bajo el QR de la invitación.');
      return;
    }
    setErrorCodigo(null);
    setCodigo('');
    void onQr(id);
  };

  const accion = ACCION[proposito];
  const bloqueado = accion.requiere === 'ocr' ? !ocrDisponible : accion.requiere === 'red' ? !enLinea : false;
  const iniciando = porRed ? (red.estado == null || red.estado.estado === 'conectando') : cam.estado === 'iniciando';
  const motivo = motivoDeshabilitado(accion, { activa, iniciando, ocupado, ocrDisponible, enLinea });
  const guia = GUIA_PROPOSITO[proposito];
  const huerfana = !porRed && asignacionHuerfana(proposito, asignacion, camaras);

  return (
    <section className="flex min-w-0 flex-col" aria-label={NOMBRE_PROPOSITO[proposito]}>
      {/* Encabezado: qué tarea mira este panel. Con un solo panel son
          pestañas grandes; con varios, un selector compacto por panel. */}
      {compacto ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          <select
            aria-label={`Tarea de este panel (${NOMBRE_PROPOSITO[proposito]})`}
            value={proposito}
            onChange={e => onCambiarProposito(e.target.value as Proposito)}
            className="sg-input h-8 min-h-0 w-auto max-w-full py-0 text-xs font-semibold"
          >
            {PROPOSITOS.map(p => <option key={p} value={p}>{NOMBRE_PROPOSITO[p]}</option>)}
          </select>
          {activa
            ? <StatusText kind="on" className="shrink-0">En vivo</StatusText>
            : <StatusText kind="warn" className="shrink-0">{legible ? legible.corto : 'Manual'}</StatusText>}
        </div>
      ) : (
        <div className="mb-4 flex items-center gap-3">
          <div role="tablist" aria-label="Tarea de la cámara" className="flex min-w-0 flex-1 gap-1 rounded-lg bg-gray-500/10 p-1">
            {PROPOSITOS.map(p => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={proposito === p}
                onClick={() => onCambiarProposito(p)}
                className={cx(
                  'flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-semibold transition-colors',
                  proposito === p ? 'bg-brand-500 text-brand-ink' : 'text-gray-400 hover:text-gray-200',
                )}
              >
                <Icono d={ICONO_PROPOSITO[p]} size={16} />
                {ROTULO_PROPOSITO[p]}
              </button>
            ))}
          </div>
          {activa
            ? <StatusText kind="on" className="shrink-0">En vivo</StatusText>
            : <StatusText kind="warn" className="shrink-0">{legible ? legible.corto : 'Modo manual'}</StatusText>}
        </div>
      )}

      <div className="sg-camera">
        {/* El <video> siempre está montado para poder adjuntarle el stream. */}
        <video ref={cam.videoRef} playsInline muted className={activa && !porRed ? 'block' : 'hidden'} />
        {/* Cámara IP o celular: el puente local entrega la imagen como MJPEG (nunca una URL con credenciales). */}
        {vivoRed && red.urlVista && <img src={red.urlVista} alt={`Vista de ${camaraRed!.nombre}`} />}
        {activa && (
          <div className="sg-camera-guide" aria-hidden="true">
            <div className={cx('sg-camera-guide-box', guia === 'documento' && 'dpi', guia === 'cuadrada' && 'qr')} />
          </div>
        )}
        {activa && proposito === 'qr' && (
          <p className="absolute bottom-3 left-1/2 max-w-[92%] -translate-x-1/2 truncate rounded-full bg-slate-900/75 px-3 py-1 text-xs font-medium text-slate-100">
            {qrPausado ? 'Verificando…'
              : !enLinea ? 'Sin conexión: se valida con la copia de este equipo'
              : 'Muestra el QR a la cámara'}
          </p>
        )}
 {porRed && legible && legible.titulo && (
          <div role="status" className={cx('flex max-w-sm flex-col items-center text-center', compacto ? 'px-3 py-4' : 'px-6 py-8')}>
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80">
              <Icono d={ICON_CAMERA_OFF} size={20} />
            </span>
            <p className={cx('font-semibold text-white', compacto ? 'text-sm' : 'text-base')}>{legible.titulo}</p>
            {legible.detalle && <p className={cx('mt-1.5 text-slate-300', compacto ? 'text-2xs' : 'text-sm')}>{legible.detalle}</p>}
            <p className="mt-2 text-2xs text-slate-400">{camaraRed!.nombre}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={red.reintentar}>Reintentar</Button>
              <Button variant="ghost" size="sm" onClick={() => setUsarWebcam(true)}>Usar la webcam de este equipo</Button>
              <Button variant="ghost" size="sm" onClick={onConfigurar}>Cámaras</Button>
            </div>
          </div>
        )}
        {!porRed && cam.fallo && (
          <div role="status" className={cx('flex max-w-sm flex-col items-center text-center', compacto ? 'px-3 py-4' : 'px-6 py-8')}>
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80">
              <Icono d={ICON_CAMERA_OFF} size={20} />
            </span>
            <p className={cx('font-semibold text-white', compacto ? 'text-sm' : 'text-base')}>{cam.fallo.titulo}</p>
            {!compacto && <p className="mt-1.5 text-sm text-slate-300">{cam.fallo.detalle}</p>}
            <p className="mt-2 font-mono text-2xs text-slate-400">{cam.fallo.codigo}</p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => void cam.reintentar()}>Reintentar</Button>
              <Button variant="ghost" size="sm" onClick={onConfigurar}>Cámaras</Button>
            </div>
          </div>
        )}
      </div>

      {porRed && red.errorCaptura && (
        <p role="alert" className="mt-2 text-xs font-medium text-danger-400">
          No se pudo tomar la foto: {red.errorCaptura} Puedes escribir el dato a mano.
        </p>
      )}
      {usarWebcam && camaraRed && (
        <p className="mt-2 text-2xs font-medium text-warning-400">
          Usando la webcam de este equipo en lugar de «{camaraRed.nombre}».{' '}
          <button type="button" className="underline underline-offset-4" onClick={() => setUsarWebcam(false)}>Volver a la cámara de red</button>
        </p>
      )}

      {huerfana && (
        <p className="mt-2 text-2xs font-medium text-warning-400">
          Su cámara no está conectada.{' '}
          <button type="button" className="underline underline-offset-4" onClick={onConfigurar}>Revisar</button>
        </p>
      )}

      {proposito === 'qr' ? (
        <>
          <p className={cx('text-gray-400', compacto ? 'mt-2 text-2xs' : 'mt-4 text-xs')}>
            {enLinea
              ? 'El código se lee solo y rellena el formulario. Verifica el DPI antes de registrar.'
              : 'Sin conexión, la invitación se valida con la copia que este equipo bajó en la última sincronización: no incluye las creadas después. Si no la reconoce, registra con el DPI a mano.'}
          </p>
          {/* Sin cámara (o con el QR dañado) el código se escribe o se pega a mano. */}
          <form onSubmit={verificarCodigo} className={cx('space-y-2', compacto ? 'mt-2' : 'mt-3')} aria-label="Código de la invitación">
            <Input
              label={activa ? '¿No se lee? Escribe el código' : 'Escribe el código de la invitación'}
              value={codigo}
              onChange={e => { setCodigo(e.target.value); setErrorCodigo(null); }}
              placeholder="Pega o escribe el código bajo el QR"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              error={errorCodigo}
            />
            <Button
              type="submit"
              variant="secondary"
              size={compacto ? 'sm' : 'md'}
              fullWidth
              disabled={qrPausado || !codigo.trim()}
            >
              Verificar código
            </Button>
            {!enLinea && (
              <p role="status" className="text-xs font-medium text-warning-400">
                Sin conexión: el código se verifica con la copia de este equipo.
              </p>
            )}
          </form>
        </>
      ) : (
        <>
          <Button
            size={compacto ? 'md' : 'lg'}
            fullWidth
            className={compacto ? 'mt-2' : 'mt-4'}
            icon={<Icono d={ICONO_PROPOSITO[proposito]} size={compacto ? 15 : 18} />}
            disabled={!activa || ocupado || bloqueado}
            loading={ocupado}
            onClick={() => void capturar()}
            title={bloqueado
              ? (accion.requiere === 'ocr' ? 'El OCR local no está disponible' : 'Esta acción requiere conexión con el servidor')
              : accion.pista}
          >
            {accion.rotulo}
          </Button>
          {/* El motivo se ve en pantalla: un botón apagado sin explicación parece una avería. */}
          {motivo && (
            <p role="status" className="mt-2 text-xs font-medium text-warning-400">{motivo}</p>
          )}
          {proposito === 'placa' && onEscribirPlaca && (
            <Button variant="secondary" size={compacto ? 'sm' : 'md'} fullWidth className="mt-2" onClick={onEscribirPlaca}>
              Escribir placa
            </Button>
          )}
          {proposito === 'salida' && onSalidaManual && (
            <>
              <Button
                variant="secondary"
                size={compacto ? 'sm' : 'md'}
                fullWidth
                className="mt-2"
                disabled={!enLinea}
                onClick={onSalidaManual}
              >
                Escribir placa
              </Button>
              {/* El botón manual también se apaga sin red: se explica aunque el motivo de la cámara sea otro. */}
              {!enLinea && !motivo?.startsWith('Sin conexión') && (
                <p role="status" className="mt-2 text-xs font-medium text-warning-400">
                  Sin conexión: la salida se registra en el servidor. Usa «Abrir talanquera» si hay que levantar la pluma.
                </p>
              )}
            </>
          )}
          {!compacto && <p className="mt-3 text-xs text-gray-400">{accion.pista}</p>}
        </>
      )}
    </section>
  );
}
