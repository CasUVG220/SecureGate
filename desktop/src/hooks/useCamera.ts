/**
 * Webcam USB vía getUserMedia (nivel 1 de la estrategia de cámaras).
 *
 * Abre UN dispositivo concreto: qué cámara toca para cada tarea (QR, placa,
 * DPI) lo decide `lib/camaras.ts`. Cambiar `deviceId` cierra el stream
 * anterior y abre el nuevo, así que sólo hay una cámara encendida a la vez
 * —varias cámaras UVC en el mismo hub USB no siempre caben juntas en el bus—.
 *
 * Estados: `iniciando` → `activa` | `sin_camara` | `denegada` | `ocupada` |
 * `error`. Cualquier estado distinto de `activa` deja la UI en modo manual
 * con el motivo visible: la garita nunca se bloquea por la cámara.
 *
 * Permisos del sistema (fuera de este archivo): macOS necesita
 * `NSCameraUsageDescription` en `src-tauri/Info.plist`; Windows concede la
 * cámara en `src-tauri/src/camera.rs`. Ver desktop/README.md.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { describirErrorCamara, type EstadoCamara, type FalloCamara } from '../lib/camara';

export type { EstadoCamara, FalloCamara };

const JPEG_CALIDAD = 0.9;

/**
 * Primero se pide 720p del dispositivo elegido; si no lo soporta, lo que
 * haya. `deviceId` va como `exact` a propósito: sin eso el navegador puede
 * devolver otra cámara y el agente acabaría leyendo la placa con la del DPI.
 */
const restricciones = (deviceId?: string): MediaStreamConstraints[] => {
  const dispositivo = deviceId ? { deviceId: { exact: deviceId } } : {};
  return [
    { video: { ...dispositivo, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { ...dispositivo }, audio: false },
  ];
};

export function useCamera(activa = true, deviceId?: string) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [estado, setEstado] = useState<EstadoCamara>('iniciando');
  const [fallo, setFallo] = useState<FalloCamara | null>(null);

  const detener = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const iniciar = useCallback(async () => {
    detener();
    setEstado('iniciando');
    setFallo(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      const f = describirErrorCamara(new TypeError('navigator.mediaDevices no disponible'));
      setEstado(f.estado);
      setFallo(f);
      return;
    }
    let ultimo: unknown = null;
    for (const r of restricciones(deviceId)) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(r);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setEstado('activa');
        return;
      } catch (e) {
        ultimo = e;
        // Sólo vale la pena reintentar si lo que falló fueron las
        // restricciones (resolución o el propio deviceId ya desconectado).
        if ((e as DOMException)?.name !== 'OverconstrainedError') break;
      }
    }
    const f = describirErrorCamara(ultimo);
    console.warn(`[camara] ${f.codigo}: ${f.titulo} — ${f.detalle}`, ultimo);
    setEstado(f.estado);
    setFallo(f);
  }, [detener, deviceId]);

  useEffect(() => {
    if (!activa) { detener(); return; }
    void iniciar();
    return detener;
  }, [activa, iniciar, detener]);

  /**
   * Captura el cuadro actual como JPEG base64 (sin prefijo data:). Se hace
   * en memoria: canvas → dataURL → string. Nada toca el disco.
   */
  const capturar = useCallback((): string | null => {
    const v = videoRef.current;
    if (!v || estado !== 'activa' || v.videoWidth === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0);
    // `toDataURL` puede fallar si el WebView no permite leer el lienzo; mejor
    // devolver null y que la UI caiga a captura manual que romper la pantalla.
    let dataUrl: string | null = null;
    try {
      dataUrl = canvas.toDataURL('image/jpeg', JPEG_CALIDAD);
    } catch (e) {
      console.warn('[camara] no se pudo exportar el cuadro capturado', e);
    }
    canvas.width = 0; // liberar el bitmap de inmediato
    return dataUrl?.split(',')[1] ?? null;
  }, [estado]);

  return { videoRef, estado, fallo, capturar, reintentar: iniciar };
}
