/**
 * Escaneo continuo de QR sobre el `<video>` que ya está abierto.
 *
 * El agente no pulsa nada: mientras la pestaña de QR está activa, cada cuadro
 * se pasa por jsQR y en cuanto aparece un código de SecureGate se avisa. Tras
 * un acierto el escáner se pausa —lo reanuda quien lo llamó— para no repetir
 * la misma invitación treinta veces por segundo.
 *
 * El cuadro se analiza en un canvas fuera de pantalla y se descarta; igual
 * que las fotos de DPI y placa, nada toca el disco.
 */
import { useEffect, useRef } from 'react';
import jsQR from 'jsqr';
import { idDeQr } from '../lib/camaras';

/** ~8 lecturas por segundo: suficiente para que se sienta inmediato y deja
 *  la CPU de una PC de garita libre para el OCR. */
const INTERVALO_MS = 120;
/** Analizar a lo ancho completo de 720p es tirar CPU: jsQR va sobrado con esto. */
const ANCHO_ANALISIS = 640;

export function useQrScanner(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  activo: boolean,
  onCodigo: (idInvitacion: string) => void,
) {
  // En un ref para que cambiar el callback no reinicie el bucle.
  const cb = useRef(onCodigo);
  useEffect(() => { cb.current = onCodigo; }, [onCodigo]);

  useEffect(() => {
    if (!activo) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    let vivo = true;
    const temporizador = window.setInterval(() => {
      if (!vivo) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2 || v.videoWidth === 0) return;

      const escala = Math.min(1, ANCHO_ANALISIS / v.videoWidth);
      canvas.width = Math.round(v.videoWidth * escala);
      canvas.height = Math.round(v.videoHeight * escala);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const datos = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const codigo = jsQR(datos.data, datos.width, datos.height, { inversionAttempts: 'dontInvert' });
      const id = codigo?.data ? idDeQr(codigo.data) : null;
      if (id) {
        vivo = false;
        cb.current(id);
      }
    }, INTERVALO_MS);

    return () => {
      vivo = false;
      window.clearInterval(temporizador);
      canvas.width = 0; // liberar el bitmap
    };
  }, [activo, videoRef]);
}
