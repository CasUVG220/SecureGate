/**
 * T8: una tarea con una cámara IP o un celular asignado. Sin cámaras reales: el puente de Rust se simula (`api.camaras`).
 * Marcado «sin probar con hardware real».
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraPane } from '../CameraPane';
import { api, type CamaraRed, type EstadoFuente } from '../../../lib/tauri';

vi.mock('../../../lib/tauri', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lib/tauri')>()),
  api: {
    camaras: {
      puente: vi.fn(), encender: vi.fn(), apagar: vi.fn(), estado: vi.fn(), fotograma: vi.fn(),
    },
  },
}));

const camaras = api.camaras as unknown as Record<'puente' | 'encender' | 'apagar' | 'estado' | 'fotograma', ReturnType<typeof vi.fn>>;

const cam = (over: Partial<CamaraRed> = {}): CamaraRed => ({
  id: 'c1', tipo: 'ip', nombre: 'Carril de entrada', url: 'rtsp://192.168.1.50/live', device_id: null, tareas: ['placa'], con_credenciales: true, creada_en: '2026-10-11T10:00:00Z', ...over,
});

const base = {
  camaras: [], asignacion: {}, ocrDisponible: true, enLinea: true, compacto: false, ocupado: false,
  onCaptura: vi.fn().mockResolvedValue(undefined), onQr: vi.fn(), qrPausado: false, onCambiarProposito: vi.fn(), onConfigurar: vi.fn(),
  onCamaraLista: vi.fn(), onEscribirPlaca: vi.fn(), onSalidaManual: vi.fn(),
};

let estado: EstadoFuente;

beforeEach(() => {
  vi.clearAllMocks();
  estado = { estado: 'conectada' };
  camaras.puente.mockResolvedValue({ puerto: 41999, token: 'tok123' });
  camaras.encender.mockResolvedValue({ estado: 'conectando' });
  camaras.apagar.mockResolvedValue(undefined);
  camaras.estado.mockImplementation(async () => ({ c1: estado }));
  camaras.fotograma.mockResolvedValue({ jpeg_base64: 'AAAA', seq: 1, edad_ms: 50 });
  // @ts-expect-error la webcam no existe en el WebView de las pruebas
  delete navigator.mediaDevices;
});
afterEach(() => { vi.useRealTimers(); });

const montar = (over: Record<string, unknown> = {}) =>
  render(<CameraPane proposito="placa" camarasRed={[cam()]} {...base} {...over} />);

/** Deja pasar el primer sondeo de estado (cada 1,5 s). */
const esperarVivo = async () => { await screen.findByAltText('Vista de Carril de entrada', {}, { timeout: 4000 }); };

describe('CameraPane con una cámara de red', () => {
  it('enciende la cámara en el puente, muestra la imagen por la dirección local con token y NO usa la webcam', async () => {
    montar();
    await esperarVivo();
    const img = screen.getByAltText('Vista de Carril de entrada') as HTMLImageElement;
    expect(img.src).toMatch(/^http:\/\/127\.0\.0\.1:41999\/v\/c1\?t=tok123&r=\d+$/);
    expect(img.src).not.toMatch(/rtsp|@|192\.168/);                 // jamás la dirección real ni credenciales
    expect(camaras.encender).toHaveBeenCalledWith('c1');
    expect(screen.getByText('En vivo')).toBeInTheDocument();
  });

  it('«Leer placa» toma el fotograma de la cámara y lo entrega al MISMO flujo de OCR que la webcam', async () => {
    const onCaptura = vi.fn().mockResolvedValue(undefined);
    montar({ onCaptura });
    await esperarVivo();
    fireEvent.click(screen.getByRole('button', { name: 'Leer placa' }));
    await waitFor(() => expect(onCaptura).toHaveBeenCalledWith('placa', 'AAAA'));
    expect(camaras.fotograma).toHaveBeenCalledWith('c1');
  });

  it('si no se puede tomar la foto lo dice y deja escribir la placa a mano', async () => {
    camaras.fotograma.mockRejectedValue({ codigo: 'camara_sin_imagen', mensaje: 'La cámara no envió imagen a tiempo.' });
    const onCaptura = vi.fn();
    const onEscribirPlaca = vi.fn();
    montar({ onCaptura, onEscribirPlaca });
    await esperarVivo();
    fireEvent.click(screen.getByRole('button', { name: 'Leer placa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La cámara no envió imagen a tiempo. Puedes escribir el dato a mano.');
    expect(onCaptura).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Escribir placa' }));
    expect(onEscribirPlaca).toHaveBeenCalled();
  });

  it('mientras se conecta lo dice y el botón de leer queda apagado con su motivo', async () => {
    estado = { estado: 'conectando' };
    montar();
    expect(await screen.findByText('Conectando con la cámara…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leer placa' })).toBeDisabled();
    expect(screen.getByText('Abriendo la cámara…')).toBeInTheDocument();
  });

  it('si la cámara cae muestra el error con qué hacer y se puede seguir con la webcam o la captura manual', async () => {
    estado = { estado: 'reconectando', intento: 1, proximo_en_s: 2, motivo: 'La cámara cerró la conexión.' };
    const onConfigurar = vi.fn();
    const onEscribirPlaca = vi.fn();
    montar({ onConfigurar, onEscribirPlaca });
    expect(await screen.findByText('Se perdió la señal de la cámara', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('La cámara cerró la conexión. Reintentando en 2 s.')).toBeInTheDocument();
    expect(screen.queryByAltText('Vista de Carril de entrada')).toBeNull();
    expect(screen.getByRole('button', { name: 'Leer placa' })).toBeDisabled();
    // la captura manual sigue disponible
    fireEvent.click(screen.getByRole('button', { name: 'Escribir placa' }));
    expect(onEscribirPlaca).toHaveBeenCalled();
    // y se puede pasar a la webcam del equipo (sin webcam aquí: queda el modo manual, pero ya no habla de la cámara de red)
    fireEvent.click(screen.getByRole('button', { name: 'Usar la webcam de este equipo' }));
    expect(await screen.findByText(/Usando la webcam de este equipo en lugar de «Carril de entrada»/)).toBeInTheDocument();
    expect(screen.queryByText('Se perdió la señal de la cámara')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a la cámara de red' }));
    expect(await screen.findByText('Se perdió la señal de la cámara', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('un error que no se arregla solo (contraseña mala) no promete reintentar', async () => {
    estado = { estado: 'caida', motivo: 'El usuario o la contraseña de la cámara no son correctos.', intentos: 1, reintentando: false };
    montar();
    expect(await screen.findByText('No se pudo usar la cámara', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('El usuario o la contraseña de la cámara no son correctos.')).toBeInTheDocument();
    expect(screen.queryByText(/Sigue intentando/)).toBeNull();
  });

  it('si no se pudo ni encender, el error llega sin detalles técnicos', async () => {
    camaras.encender.mockRejectedValue({ codigo: 'camaras', mensaje: 'El componente de video (ffmpeg) no está instalado en este equipo.' });
    montar();
    expect(await screen.findByText('No se pudo usar la cámara')).toBeInTheDocument();
    expect(screen.getByText('El componente de video (ffmpeg) no está instalado en este equipo.')).toBeInTheDocument();
  });

  it('al cerrar el panel se apaga la cámara en el puente', async () => {
    const { unmount } = montar();
    await esperarVivo();
    unmount();
    expect(camaras.apagar).toHaveBeenCalledWith('c1');
  });

  it('dos paneles con la misma cámara: solo se apaga cuando se va el último', async () => {
    const a = render(<CameraPane proposito="placa" camarasRed={[cam({ tareas: ['placa', 'salida'] })]} {...base} />);
    const b = render(<CameraPane proposito="salida" camarasRed={[cam({ tareas: ['placa', 'salida'] })]} {...base} />);
    await waitFor(() => expect(camaras.encender).toHaveBeenCalledTimes(2));
    a.unmount();
    expect(camaras.apagar).not.toHaveBeenCalled();
    b.unmount();
    expect(camaras.apagar).toHaveBeenCalledTimes(1);
  });

  it('una tarea SIN cámara de red sigue usando la webcam: no toca el puente', async () => {
    montar({ camarasRed: [cam({ tareas: ['salida'] })] });
    await act(async () => { await Promise.resolve(); });
    expect(camaras.encender).not.toHaveBeenCalled();
    expect(screen.getByText('No hay cámara disponible en este panel.')).toBeInTheDocument();
  });
});

/** SCRUM-120: el celular se comporta como una cámara IP más en las 4 tareas. */
describe('un celular como cámara en cada una de las 4 tareas', () => {
  const celular = (tarea: string) => cam({ id: 'c1', tipo: 'celular', nombre: 'Celular de Pedro', url: 'http://192.168.1.60:8080/video', tareas: [tarea], con_credenciales: false });

  it.each([
    ['placa', 'Leer placa'],
    ['dpi', 'Leer DPI'],
    ['salida', 'Dar salida'],
  ] as const)('%s: muestra la imagen del celular y «%s» entrega su fotograma al mismo flujo de captura', async (tarea, boton) => {
    const onCaptura = vi.fn().mockResolvedValue(undefined);
    render(<CameraPane proposito={tarea} camarasRed={[celular(tarea)]} {...base} onCaptura={onCaptura} />);
    await screen.findByAltText('Vista de Celular de Pedro', {}, { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: boton }));
    await waitFor(() => expect(onCaptura).toHaveBeenCalledWith(tarea, 'AAAA'));
  });

  it('qr: el escáner pide fotogramas al celular mientras está en vivo (y no antes)', async () => {
    estado = { estado: 'conectando' };
    render(<CameraPane proposito="qr" camarasRed={[celular('qr')]} {...base} />);
    await screen.findByText('Conectando con la cámara…', {}, { timeout: 4000 });
    expect(camaras.fotograma).not.toHaveBeenCalled();
    estado = { estado: 'conectada' };
    await screen.findByAltText('Vista de Celular de Pedro', {}, { timeout: 5000 });
    await waitFor(() => expect(camaras.fotograma).toHaveBeenCalledWith('c1'), { timeout: 3000 });
  });
});
