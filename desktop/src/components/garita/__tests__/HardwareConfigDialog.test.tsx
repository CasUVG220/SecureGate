import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HardwareConfigDialog } from '../HardwareConfigDialog';
import { api, type EstadoHardware } from '../../../lib/tauri';

vi.mock('../../../lib/tauri', async () => {
  const real = await vi.importActual<typeof import('../../../lib/tauri')>('../../../lib/tauri');
  return {
    ...real,
    api: { hardware: { puertos: vi.fn(), configurar: vi.fn(), probar: vi.fn(), abrir: vi.fn(), estado: vi.fn() } },
  };
});

const h = api.hardware as unknown as Record<string, ReturnType<typeof vi.fn>>;

const SIN_HW: EstadoHardware = { nombre: 'Sin hardware', estado: 'sin_driver', config: { tipo: 'ninguno' } };

beforeEach(() => {
  Object.values(h).forEach(f => f.mockReset());
  h.puertos.mockResolvedValue([
    { nombre: 'COM3', vid: 0x1a86, pid: 0x7523, fabricante: 'wch.cn', producto: 'USB-SERIAL CH340' },
    { nombre: 'COM1', vid: null, pid: null, fabricante: null, producto: null },
  ]);
});

const dialogo = () => screen.getByRole('dialog', { name: 'Configuración de hardware' });

describe('HardwareConfigDialog', () => {
  it('arranca en "Sin hardware" con la prueba deshabilitada y explica que el flujo sigue igual', () => {
    render(<HardwareConfigDialog actual={SIN_HW} onCerrar={vi.fn()} onGuardada={vi.fn()} />);
    expect(screen.getByLabelText('Tipo de driver')).toHaveValue('ninguno');
    expect(screen.getByRole('button', { name: 'Probar apertura' })).toBeDisabled();
    expect(screen.getByText(/El registro de accesos funciona igual/)).toBeInTheDocument();
  });

  it('elegir relé USB lista los puertos detectados (con el chip) y guarda la config etiquetada', async () => {
    h.configurar.mockResolvedValue({ nombre: 'Relé USB (LCUS/CH340)', estado: 'conectado', config: { tipo: 'serial_usb' } });
    const onGuardada = vi.fn();
    render(<HardwareConfigDialog actual={SIN_HW} onCerrar={vi.fn()} onGuardada={onGuardada} />);

    fireEvent.change(screen.getByLabelText('Tipo de driver'), { target: { value: 'serial_usb' } });
    await waitFor(() => expect(h.puertos).toHaveBeenCalled());
    const puerto = await screen.findByLabelText('Puerto serial');
    expect(within(puerto).getByText(/COM3 — USB-SERIAL CH340 · wch.cn \(CH340\)/)).toBeInTheDocument();

    fireEvent.change(puerto, { target: { value: 'COM3' } });
    fireEvent.change(screen.getByLabelText('Duración del pulso (ms)'), { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(h.configurar).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'serial_usb', puerto: 'COM3', protocolo: 'lcus', canal: 1, baudios: 9600, pulso_ms: 800,
    })));
    expect(onGuardada).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Relé USB (LCUS/CH340)' }));
  });

  it('relé Ethernet: el comando es texto libre y el botón de prueba usa la config sin guardarla', async () => {
    h.probar.mockResolvedValue({ abierta: true, driver: 'Relé TCP 192.168.1.50:6722', error: null });
    render(<HardwareConfigDialog actual={SIN_HW} onCerrar={vi.fn()} onGuardada={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Tipo de driver'), { target: { value: 'ethernet' } });
    fireEvent.change(screen.getByLabelText(/IP o host del relé/), { target: { value: '192.168.1.50' } });
    fireEvent.change(screen.getByLabelText(/Comando de apertura/), { target: { value: 'on1\\r\\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Probar apertura' }));

    await waitFor(() => expect(h.probar).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'ethernet', host: '192.168.1.50', puerto: 6722, modo: 'tcp', comando: 'on1\\r\\n', timeout_ms: 2000,
    })));
    expect(await screen.findByText(/Pulso enviado \(Relé TCP 192.168.1.50:6722\)/)).toBeInTheDocument();
    expect(h.configurar).not.toHaveBeenCalled();
  });

  it('una prueba fallida se muestra sin cerrar el diálogo', async () => {
    h.probar.mockResolvedValue({ abierta: false, driver: 'Relé TCP 10.0.0.9:6722', error: { tipo: 'timeout', detalle: 'conectar' } });
    render(<HardwareConfigDialog actual={SIN_HW} onCerrar={vi.fn()} onGuardada={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Tipo de driver'), { target: { value: 'ethernet' } });
    fireEvent.change(screen.getByLabelText(/IP o host del relé/), { target: { value: '10.0.0.9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Probar apertura' }));
    expect(await screen.findByText(/no respondió a tiempo/)).toBeInTheDocument();
    expect(dialogo()).toBeInTheDocument();
  });

  it('si el backend rechaza la config (inválida) se muestra el error y no se cierra', async () => {
    h.configurar.mockRejectedValue({ codigo: 'hardware_config', mensaje: 'Configuración inválida: el puerto debe ser 1-65535' });
    render(<HardwareConfigDialog actual={SIN_HW} onCerrar={vi.fn()} onGuardada={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Tipo de driver'), { target: { value: 'ethernet' } });
    fireEvent.change(screen.getByLabelText(/IP o host del relé/), { target: { value: '10.0.0.9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/el puerto debe ser 1-65535/)).toBeInTheDocument();
    expect(dialogo()).toBeInTheDocument();
  });

  it('carga la configuración ya guardada del equipo', () => {
    const actual: EstadoHardware = {
      nombre: 'Relé HTTP 10.0.0.5:80', estado: 'conectado',
      config: { tipo: 'ethernet', host: '10.0.0.5', puerto: 80, modo: 'http', comando: '', comando_off: null, pulso_ms: 500, timeout_ms: 1500, metodo: 'get', ruta: '/on', ruta_off: null },
    };
    render(<HardwareConfigDialog actual={actual} onCerrar={vi.fn()} onGuardada={vi.fn()} />);
    expect(screen.getByLabelText('Tipo de driver')).toHaveValue('ethernet');
    expect(screen.getByLabelText(/IP o host del relé/)).toHaveValue('10.0.0.5');
    expect(screen.getByLabelText(/Ruta de apertura/)).toHaveValue('/on');
    expect(screen.getByText(/Activo: Relé HTTP 10.0.0.5:80/)).toBeInTheDocument();
  });

  it('GPIO se puede guardar pero avisa que no está soportado', () => {
    render(<HardwareConfigDialog actual={SIN_HW} onCerrar={vi.fn()} onGuardada={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Tipo de driver'), { target: { value: 'gpio' } });
    expect(screen.getByText(/GPIO no está implementado en esta versión/)).toBeInTheDocument();
    expect(screen.getByLabelText('Pin (BCM)')).toHaveValue(17);
  });
});
