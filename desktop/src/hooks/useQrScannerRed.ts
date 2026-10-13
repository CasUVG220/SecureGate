/**
 * Escaneo continuo de QR con una cámara de red: no hay `<video>` que leer, así que cada ~700 ms se pide un fotograma al puente y se pasa
 * por jsQR. Igual que con la webcam, el fotograma vive solo en memoria y tras un acierto el escáner se pausa.
 */
import { useEffect, useRef } from 'react';
import jsQR from 'jsqr';
import { api } from '../lib/tauri';
import { idDeQr } from '../lib/camaras';

const INTERVALO_MS = 700;
const ANCHO_ANALISIS = 640;

function dibujar(jpegBase64: string): Promise<{ datos: Uint8ClampedArray; ancho: number; alto: number } | null> {
  return new Promise(resolver => {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, ANCHO_ANALISIS / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return resolver(null);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      resolver({ datos: d.data, ancho: d.width, alto: d.height });
    };
    img.onerror = () => resolver(null);
    img.src = `data:image/jpeg;base64,${jpegBase64}`;
  });
}

export function useQrScannerRed(camaraId: string | null, activo: boolean, onCodigo: (idInvitacion: string) => void) {
  const cb = useRef(onCodigo);
  useEffect(() => { cb.current = onCodigo; }, [onCodigo]);

  useEffect(() => {
    if (!activo || !camaraId) return;
    let vivo = true;
    let ocupado = false;
    const t = window.setInterval(() => {
      if (!vivo || ocupado) return;
      ocupado = true;
      void (async () => {
        try {
          const f = await api.camaras.fotograma(camaraId);
          const px = await dibujar(f.jpeg_base64);
          if (!vivo || !px) return;
          const codigo = jsQR(px.datos, px.ancho, px.alto, { inversionAttempts: 'dontInvert' });
          const id = codigo?.data ? idDeQr(codigo.data) : null;
          if (id) { vivo = false; cb.current(id); }
        } catch { /* sin imagen por ahora: se vuelve a intentar */ }
        finally { ocupado = false; }
      })();
    }, INTERVALO_MS);
    return () => { vivo = false; window.clearInterval(t); };
  }, [activo, camaraId]);
}
