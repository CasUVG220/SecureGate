import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SalidaDialog } from '../SalidaDialog';
import { api } from '../../../lib/tauri';

vi.mock('../../../lib/tauri', async () => {
  const real = await vi.importActual<typeof import('../../../lib/tauri')>('../../../lib/tauri');
  return {
    ...real,
    api: { garita: { buscarSalida: vi.fn(), registrarSalida: vi.fn() } },
  };
});

const buscar = api.garita.buscarSalida as unknown as ReturnType<typeof vi.fn>;
const registrar = api.garita.registrarSalida as unknown as ReturnType<typeof vi.fn>;

/** Forma REAL de GET /accesos/activo: visitante y residente anidados. */
const ACCESO = {
  registro_id: 'reg-1',
  timestamp_entrada: '2026-09-20T13:07:15.411Z',
  visitante: { id: 'v-1', nombre: 'Prueba Salida', numero_dpi: '7777777777777' },
  residente: { id: 'r-1', numero_casa: 'A-01', nombre: 'Residente Demo' },
  placa: 'P555XYZ',
};

beforeEach(() => { buscar.mockReset(); registrar.mockReset(); });

describe('SalidaDialog', () => {
  it('con la placa del OCR busca sola y muestra a quién pertenece el acceso abierto', async () => {
    buscar.mockResolvedValue(ACCESO);
    render(<SalidaDialog placaInicial="P555XYZ" onCerrar={vi.fn()} onRegistrada={vi.fn()} />);

    await waitFor(() => expect(buscar).toHaveBeenCalledWith('P555XYZ'));
    expect(await screen.findByText(/Prueba Salida · DPI 7777777777777/)).toBeInTheDocument();
    expect(screen.getByText('A-01 · Residente Demo')).toBeInTheDocument();
    expect(screen.getByText('P-555XYZ')).toBeInTheDocument();
  });

  it('registra la salida del acceso encontrado y avisa a la página', async () => {
    buscar.mockResolvedValue(ACCESO);
    const apertura = { abierta: true, driver: 'Relé USB (LCUS/CH340)', error: null };
    registrar.mockResolvedValue({ registro: {}, apertura });
    const onRegistrada = vi.fn();
    render(<SalidaDialog placaInicial="P555XYZ" onCerrar={vi.fn()} onRegistrada={onRegistrada} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Registrar salida' }));
    await waitFor(() => expect(registrar).toHaveBeenCalledWith('reg-1'));
    // La página recibe también qué pasó con la talanquera.
    await waitFor(() => expect(onRegistrada).toHaveBeenCalledWith(ACCESO, apertura));
  });

  it('si no hay acceso abierto lo dice en vez de dejar al agente esperando', async () => {
    buscar.mockResolvedValue(null);
    render(<SalidaDialog placaInicial="P555XYZ" onCerrar={vi.fn()} onRegistrada={vi.fn()} />);
    expect(await screen.findByText(/No hay ningún acceso abierto con esa placa/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar salida' })).not.toBeInTheDocument();
  });

  it('sin placa legible del OCR no busca nada y deja escribirla a mano', async () => {
    buscar.mockResolvedValue(ACCESO);
    render(<SalidaDialog placaInicial="" onCerrar={vi.fn()} onRegistrada={vi.fn()} />);
    expect(buscar).not.toHaveBeenCalled();

    const boton = screen.getByRole('button', { name: 'Buscar' });
    expect(boton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Placa'), { target: { value: 'p555xyz' } });
    expect(boton).toBeEnabled();
    fireEvent.click(boton);
    await waitFor(() => expect(buscar).toHaveBeenCalledWith('P555XYZ'));
  });

  it('un fallo del servidor se muestra tal cual y no cierra el diálogo', async () => {
    buscar.mockRejectedValue(new Error('Sin conexión con el servidor'));
    render(<SalidaDialog placaInicial="P555XYZ" onCerrar={vi.fn()} onRegistrada={vi.fn()} />);
    expect(await screen.findByText('Sin conexión con el servidor')).toBeInTheDocument();
  });
});
