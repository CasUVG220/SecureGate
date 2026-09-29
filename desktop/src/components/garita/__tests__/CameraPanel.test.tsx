import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraPanel } from '../CameraPanel';

const domErr = (name: string) => Object.assign(new Error(name), { name });

function conGetUserMedia(impl: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(impl) },
  });
}

const props = {
  ocrDisponible: true, enLinea: true,
  disposicion: { layout: 1 as const, paneles: ['qr' as const] },
  onLayout: vi.fn(), onPanel: vi.fn(),
  onCaptura: vi.fn(), onQr: vi.fn(), qrPausado: false, ocupado: null,
};

/** Los fallos se ven igual en cualquier tarea; se prueban en la de placa. */
const propsPlaca = { ...props, disposicion: { layout: 1 as const, paneles: ['placa' as const] } };

describe('CameraPanel', () => {
  afterEach(() => {
    // @ts-expect-error se limpia el mock
    delete navigator.mediaDevices;
  });

  it('permiso denegado: muestra el motivo en pantalla y deja el modo manual', async () => {
    conGetUserMedia(() => Promise.reject(domErr('NotAllowedError')));
    render(<CameraPanel {...propsPlaca} />);
    expect(await screen.findByText('Permiso de cámara denegado')).toBeInTheDocument();
    expect(screen.getByText(/Actívalo para SecureGate Garita/)).toBeInTheDocument();
    expect(screen.getByText('NotAllowedError')).toBeInTheDocument();
    expect(screen.getByText('Modo manual')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leer placa' })).toBeDisabled();
  });

  it('sin cámara: mensaje distinto al de permiso', async () => {
    conGetUserMedia(() => Promise.reject(domErr('NotFoundError')));
    render(<CameraPanel {...props} />);
    expect(await screen.findByText('No se detectó ninguna cámara')).toBeInTheDocument();
    expect(screen.queryByText(/denegado/)).not.toBeInTheDocument();
  });

  it('OverconstrainedError: reintenta con la configuración básica antes de rendirse', async () => {
    const gum = vi.fn()
      .mockRejectedValueOnce(domErr('OverconstrainedError'))
      .mockResolvedValueOnce({ getTracks: () => [] } as unknown as MediaStream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: gum } });
    window.HTMLMediaElement.prototype.play = () => Promise.resolve();
    render(<CameraPanel {...props} />);
    await waitFor(() => expect(gum).toHaveBeenCalledTimes(2));
    // El reintento suelta la resolución pero no el dispositivo: bajar de
    // calidad está bien, abrir otra cámara no.
    expect(gum.mock.calls[1][0]).toEqual({ video: {}, audio: false });
    expect(await screen.findByText('En vivo')).toBeInTheDocument();
  });

  it('sin mediaDevices (WebView sin soporte) no crashea', async () => {
    render(<CameraPanel {...props} />);
    expect(await screen.findByText('Este entorno no expone cámaras')).toBeInTheDocument();
  });
});
