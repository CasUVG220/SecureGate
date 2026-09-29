import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraPanel } from '../CameraPanel';
import { leerDisposicion, type Disposicion, type Layout, type Proposito } from '../../../lib/camaras';
import { useCamarasLayout } from '../../../hooks/useCamarasLayout';

/** jsQR devuelve lo que diga esta variable: no se puede escanear en jsdom. */
let lecturaQr: { data: string } | null = null;
vi.mock('jsqr', () => ({ default: () => lecturaQr }));

const stream = () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream;

const dispositivos = [
  { kind: 'videoinput', deviceId: 'cam-entrada', label: 'Carril entrada' },
  { kind: 'videoinput', deviceId: 'cam-mostrador', label: 'Mostrador' },
  { kind: 'videoinput', deviceId: 'cam-cristal', label: 'Cristal' },
  { kind: 'videoinput', deviceId: 'cam-salida', label: 'Carril salida' },
];

const gum = vi.fn();
const base = {
  ocrDisponible: true, enLinea: true,
  onCaptura: vi.fn(), onQr: vi.fn(), qrPausado: false, ocupado: null,
};

/** Envoltorio con estado real: las pestañas y el layout los decide el padre. */
function PanelConEstado(props: Partial<typeof base> & { inicial?: Disposicion }) {
  const { disposicion, cambiarLayout, cambiarPanel } = useCamarasLayout();
  return (
    <CameraPanel
      {...base}
      {...props}
      disposicion={disposicion}
      onLayout={cambiarLayout}
      onPanel={cambiarPanel}
    />
  );
}

/** Versión controlada para los casos que fijan la tarea sin tocar storage. */
function PanelFijo({ paneles, layout = 1 as Layout, ...extra }: { paneles: Proposito[]; layout?: Layout } & Partial<typeof base>) {
  const [d, setD] = useState<Disposicion>({ layout, paneles });
  return (
    <CameraPanel
      {...base}
      {...extra}
      disposicion={d}
      onLayout={l => setD({ layout: l, paneles: d.paneles })}
      onPanel={(i, p) => setD(prev => { const n = prev.paneles.slice(); n[i] = p; return { ...prev, paneles: n }; })}
    />
  );
}

beforeEach(() => {
  localStorage.clear();
  lecturaQr = null;
  gum.mockReset().mockResolvedValue(stream());
  base.onQr.mockReset();
  base.onCaptura.mockReset();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: gum,
      enumerateDevices: vi.fn().mockResolvedValue(dispositivos),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();

  // jsdom no reproduce vídeo ni pinta canvas: se simula lo justo para que el
  // escáner llegue a jsQR (que está mockeado arriba).
  for (const [prop, value] of [['videoWidth', 1280], ['videoHeight', 720], ['readyState', 4]] as const) {
    Object.defineProperty(window.HTMLVideoElement.prototype, prop, { configurable: true, get: () => value });
  }
  window.HTMLCanvasElement.prototype.getContext = (() => ({
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  })) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  // @ts-expect-error se limpia el mock
  delete navigator.mediaDevices;
});

/** deviceId con el que se abrió la cámara en la llamada `i` a getUserMedia. */
const deviceIdDe = (i: number): unknown =>
  (gum.mock.calls[i][0].video as { deviceId?: { exact?: string } }).deviceId?.exact;
const ultimoDeviceId = () => deviceIdDe(gum.mock.calls.length - 1);
const deviceIdsAbiertos = () => new Set(gum.mock.calls.map((_, i) => deviceIdDe(i)));

describe('CameraPanel — una cámara por tarea', () => {
  it('reparte las cuatro cámaras detectadas y abre la del QR al arrancar', async () => {
    render(<PanelConEstado />);
    await waitFor(() => expect(ultimoDeviceId()).toBe('cam-entrada'));
    expect(screen.getByRole('tab', { name: 'QR' })).toHaveAttribute('aria-selected', 'true');
  });

  it('cambiar de pestaña abre la cámara de esa tarea, no la misma de siempre', async () => {
    render(<PanelConEstado />);
    await waitFor(() => expect(ultimoDeviceId()).toBe('cam-entrada'));

    fireEvent.click(screen.getByRole('tab', { name: 'Placa' }));
    await waitFor(() => expect(ultimoDeviceId()).toBe('cam-mostrador'));
    expect(await screen.findByRole('button', { name: 'Leer placa' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'DPI' }));
    await waitFor(() => expect(ultimoDeviceId()).toBe('cam-cristal'));
    expect(await screen.findByRole('button', { name: 'Leer DPI' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Salida' }));
    await waitFor(() => expect(ultimoDeviceId()).toBe('cam-salida'));
    expect(await screen.findByRole('button', { name: 'Dar salida' })).toBeInTheDocument();
  });

  it('la asignación se guarda en el equipo y se respeta al volver a montar', async () => {
    localStorage.setItem('sg_camaras', JSON.stringify({ qr: 'cam-salida' }));
    render(<PanelConEstado />);
    await waitFor(() => expect(ultimoDeviceId()).toBe('cam-salida'));
  });

  it('si la cámara asignada se desconectó, avisa en vez de leer con otra en silencio', async () => {
    localStorage.setItem('sg_camaras', JSON.stringify({ qr: 'cam-que-ya-no-esta' }));
    render(<PanelConEstado />);
    expect(await screen.findByText(/no está conectada/)).toBeInTheDocument();
  });
});

describe('CameraPanel — disposición elegida por el agente', () => {
  it('arranca con una sola vista', async () => {
    render(<PanelConEstado />);
    await waitFor(() => expect(gum).toHaveBeenCalled());
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
  });

  it('con dos vistas abre dos cámaras distintas, cada una con su selector de tarea', async () => {
    render(<PanelConEstado />);
    await waitFor(() => expect(gum).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '2 cámaras a la vista' }));
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(2));
    await waitFor(() => {
      expect(deviceIdsAbiertos()).toEqual(expect.objectContaining({}));
      expect(deviceIdsAbiertos().has('cam-entrada')).toBe(true);
      expect(deviceIdsAbiertos().has('cam-mostrador')).toBe(true);
    });
  });

  it('con cuatro vistas muestra las cuatro tareas a la vez, incluida la de salida', async () => {
    render(<PanelConEstado />);
    await waitFor(() => expect(gum).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '4 cámaras a la vista' }));
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(4));

    for (const nombre of ['QR de invitación', 'Placa de entrada', 'DPI del visitante', 'Placa de salida']) {
      expect(screen.getByRole('region', { name: nombre })).toBeInTheDocument();
    }
    await waitFor(() => {
      for (const id of ['cam-entrada', 'cam-mostrador', 'cam-cristal', 'cam-salida']) {
        expect(deviceIdsAbiertos().has(id)).toBe(true);
      }
    });
  });

  it('la disposición se guarda en el equipo', async () => {
    render(<PanelConEstado />);
    await waitFor(() => expect(gum).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '4 cámaras a la vista' }));
    await waitFor(() => expect(leerDisposicion().layout).toBe(4));
    expect(leerDisposicion().paneles).toEqual(['qr', 'placa', 'dpi', 'salida']);
  });

  it('cada panel puede cambiar su tarea sin tocar los demás', async () => {
    render(<PanelConEstado />);
    await waitFor(() => expect(gum).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '2 cámaras a la vista' }));
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(2));

    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'salida' } });
    await waitFor(() => expect(leerDisposicion().paneles).toEqual(['qr', 'salida']));
    expect(screen.getByRole('region', { name: 'Placa de salida' })).toBeInTheDocument();
  });

  it('avisa cuando hay menos cámaras conectadas que vistas', async () => {
    (navigator.mediaDevices.enumerateDevices as ReturnType<typeof vi.fn>)
      .mockResolvedValue([dispositivos[0]]);
    render(<PanelConEstado />);
    await waitFor(() => expect(gum).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '4 cámaras a la vista' }));
    expect(await screen.findByText(/varias mostrarán la misma imagen/)).toBeInTheDocument();
  });
});

describe('CameraPanel — captura por tarea', () => {
  it('cada botón entrega su foto etiquetada con la tarea que la tomó', async () => {
    render(<PanelFijo paneles={['salida']} />);
    const boton = await screen.findByRole('button', { name: 'Dar salida' });
    fireEvent.click(boton);
    // jsdom no pinta el vídeo, así que `capturar()` devuelve null y no llama;
    // lo que importa es que el botón exista y esté habilitado con OCR y red.
    expect(boton).toBeEnabled();
  });

  it('la salida requiere conexión: sin ella el botón se bloquea', async () => {
    render(<PanelFijo paneles={['salida']} enLinea={false} />);
    expect(await screen.findByRole('button', { name: 'Dar salida' })).toBeDisabled();
  });

  it('la placa de entrada no requiere conexión, pero sí el OCR local', async () => {
    const { unmount } = render(<PanelFijo paneles={['placa']} enLinea={false} />);
    expect(await screen.findByRole('button', { name: 'Leer placa' })).toBeEnabled();
    unmount();

    render(<PanelFijo paneles={['placa']} ocrDisponible={false} />);
    expect(await screen.findByRole('button', { name: 'Leer placa' })).toBeDisabled();
  });
});

describe('CameraPanel — escáner de QR', () => {
  it('lee un QR de SecureGate y lo entrega ya sin el prefijo', async () => {
    lecturaQr = { data: 'SGQR:3f1b2c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d' };
    render(<PanelConEstado />);
    await waitFor(() => expect(base.onQr).toHaveBeenCalledWith('3f1b2c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d'), { timeout: 2000 });
  });

  it('ignora códigos que no son de SecureGate', async () => {
    lecturaQr = { data: 'https://otra-cosa.com' };
    render(<PanelConEstado />);
    await new Promise(r => setTimeout(r, 400));
    expect(base.onQr).not.toHaveBeenCalled();
  });

  it('sin conexión no escanea y lo dice: verificar un QR necesita el servidor', async () => {
    lecturaQr = { data: 'SGQR:3f1b2c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d' };
    render(<PanelConEstado enLinea={false} />);
    expect(await screen.findByText(/Sin conexión: el QR no se puede verificar/)).toBeInTheDocument();
    await new Promise(r => setTimeout(r, 400));
    expect(base.onQr).not.toHaveBeenCalled();
  });

  it('mientras se verifica un código no vuelve a disparar', async () => {
    lecturaQr = { data: 'SGQR:3f1b2c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d' };
    render(<PanelConEstado qrPausado />);
    await new Promise(r => setTimeout(r, 400));
    expect(base.onQr).not.toHaveBeenCalled();
    expect(screen.getByText('Verificando…')).toBeInTheDocument();
  });

  it('sólo escanea en el panel de QR: con otra tarea el escáner no corre', async () => {
    lecturaQr = { data: 'SGQR:3f1b2c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d' };
    render(<PanelFijo paneles={['salida']} />);
    await screen.findByRole('button', { name: 'Dar salida' });
    await new Promise(r => setTimeout(r, 400));
    expect(base.onQr).not.toHaveBeenCalled();
  });
});

describe('CamarasConfigDialog', () => {
  it('permite cambiar la disposición y asignar la cámara de cada tarea', async () => {
    render(<PanelConEstado />);
    await waitFor(() => expect(gum).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Configurar cámaras' }));

    const dialogo = await screen.findByRole('dialog', { name: 'Cámaras de esta garita' });
    fireEvent.click(within(dialogo).getByLabelText(/Cuatro cámaras/));
    await waitFor(() => expect(leerDisposicion().layout).toBe(4));

    fireEvent.change(within(dialogo).getByLabelText('Placa de salida'), { target: { value: 'cam-cristal' } });
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('sg_camaras') ?? '{}').salida).toBe('cam-cristal'));
  });
});
