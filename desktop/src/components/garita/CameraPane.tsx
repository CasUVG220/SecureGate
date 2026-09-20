/**
 * Una vista previa: su cámara, su guía de encuadre y su acción.
 *
 * Cada panel abre su propio dispositivo, así que con el layout de cuatro hay
 * cuatro cámaras encendidas a la vez. Es lo que pide una garita con carril de
 * entrada, mostrador y carril de salida; a cambio consume bus USB, y por eso
 * el agente puede bajar a dos o una desde la configuración.
 */
import { useEffect } from 'react';
import { Button, StatusText, cx } from '../ui';
import { useCamera } from '../../hooks/useCamera';
import { useQrScanner } from '../../hooks/useQrScanner';
import {
  GUIA_PROPOSITO, NOMBRE_PROPOSITO, PROPOSITOS, ROTULO_PROPOSITO,
  asignacionHuerfana, resolverDispositivo,
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
const ACCION: Record<Proposito, { rotulo: string; requiere: 'ocr' | 'red' | null; pista: string }> = {
  qr: { rotulo: '', requiere: 'red', pista: 'Se lee solo: muestra el QR a la cámara.' },
  placa: { rotulo: 'Leer placa', requiere: 'ocr', pista: 'Se lee en este equipo, sin internet.' },
  dpi: { rotulo: 'Leer DPI', requiere: 'red', pista: 'La foto se procesa en memoria y se descarta.' },
  salida: { rotulo: 'Dar salida', requiere: 'red', pista: 'Lee la placa y cierra el acceso abierto.' },
};

interface Props {
  proposito: Proposito;
  camaras: Camara[];
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
}

export function CameraPane({
  proposito, camaras, asignacion, ocrDisponible, enLinea, compacto, ocupado,
  onCaptura, onQr, qrPausado, onCambiarProposito, onConfigurar, onCamaraLista,
}: Props) {
  const deviceId = resolverDispositivo(proposito, asignacion, camaras);
  const cam = useCamera(true, deviceId);
  const activa = cam.estado === 'activa';

  useEffect(() => { if (activa) onCamaraLista(); }, [activa, onCamaraLista]);

  useQrScanner(cam.videoRef, proposito === 'qr' && activa && enLinea && !qrPausado, id => { void onQr(id); });

  const capturar = async () => {
    const jpeg = cam.capturar();
    if (jpeg) await onCaptura(proposito, jpeg);
  };

  const accion = ACCION[proposito];
  const bloqueado = accion.requiere === 'ocr' ? !ocrDisponible : accion.requiere === 'red' ? !enLinea : false;
  const guia = GUIA_PROPOSITO[proposito];
  const huerfana = asignacionHuerfana(proposito, asignacion, camaras);

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
            : <StatusText kind="warn" className="shrink-0">Manual</StatusText>}
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
            : <StatusText kind="warn" className="shrink-0">Modo manual</StatusText>}
        </div>
      )}

      <div className="sg-camera">
        {/* El <video> siempre está montado para poder adjuntarle el stream. */}
        <video ref={cam.videoRef} playsInline muted className={activa ? 'block' : 'hidden'} />
        {activa && (
          <div className="sg-camera-guide" aria-hidden="true">
            <div className={cx('sg-camera-guide-box', guia === 'documento' && 'dpi', guia === 'cuadrada' && 'qr')} />
          </div>
        )}
        {activa && proposito === 'qr' && (
          <p className="absolute bottom-3 left-1/2 max-w-[92%] -translate-x-1/2 truncate rounded-full bg-slate-900/75 px-3 py-1 text-xs font-medium text-slate-100">
            {!enLinea ? 'Sin conexión: el QR no se puede verificar'
              : qrPausado ? 'Verificando…'
              : 'Muestra el QR a la cámara'}
          </p>
        )}
        {cam.fallo && (
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

      {huerfana && (
        <p className="mt-2 text-2xs font-medium text-warning-400">
          Su cámara no está conectada.{' '}
          <button type="button" className="underline underline-offset-4" onClick={onConfigurar}>Revisar</button>
        </p>
      )}

      {proposito === 'qr' ? (
        <p className={cx('text-gray-400', compacto ? 'mt-2 text-2xs' : 'mt-4 text-xs')}>
          {enLinea
            ? 'El código se lee solo y rellena el formulario. Verifica el DPI antes de registrar.'
            : 'Verificar un QR necesita conexión: la vigencia y los usos viven en el servidor. Pulsa «Sincronizar» o registra con el DPI a mano.'}
        </p>
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
          {!compacto && <p className="mt-3 text-xs text-gray-400">{accion.pista}</p>}
        </>
      )}
    </section>
  );
}
