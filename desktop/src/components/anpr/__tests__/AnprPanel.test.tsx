import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnprPanel } from '../AnprPanel';
import { api } from '../../../lib/tauri';
import { carril, estadoAnpr } from './fixtures';

vi.mock('../../../lib/tauri', async () => {
  const real = await vi.importActual<typeof import('../../../lib/tauri')>('../../../lib/tauri');
  return { ...real, api: { camaras: { puente: vi.fn() } } };
});

const puente = api.camaras.puente as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  puente.mockReset();
  puente.mockResolvedValue({ puerto: 47001, token: 'tok' });
});

describe('AnprPanel', () => {
  it('sin carriles invita a configurarlos', () => {
    const onConfigurar = vi.fn();
    render(<AnprPanel estado={estadoAnpr({ carriles: [] })} pistas={{}} error={null} onConfigurar={onConfigurar} />);
    expect(screen.getByText('Sin carriles configurados')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Configurar carriles' }));
    expect(onConfigurar).toHaveBeenCalled();
    expect(puente).not.toHaveBeenCalled();
  });

  it('carril activo: vista en vivo del puente con el área y una caja por vehículo, en porcentaje del cuadro', async () => {
    const roi: [number, number][] = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9]];
    render(
      <AnprPanel
        estado={estadoAnpr({ carriles: [carril({ roi })] })}
        pistas={{ c1: { tamano: [1280, 720], pistas: [
          { id: 'c1-1', estado: 'LEYENDO', bbox: { x: 320, y: 180, w: 640, h: 360 }, clase: 'carro', placa: null },
          { id: 'c1-2', estado: 'CONFIRMADO', bbox: { x: 0, y: 0, w: 128, h: 72 }, clase: 'carro', placa: 'P123ABC' },
        ] } }}
        error={null}
        onConfigurar={vi.fn()}
      />,
    );
    const img = await screen.findByAltText('Vista en vivo de Entrada principal');
    expect(img).toHaveAttribute('src', 'http://127.0.0.1:47001/v/cam1?t=tok&r=0');
    expect(screen.getByText('Vigilando · 5 fps')).toBeInTheDocument();
    const cajas = screen.getAllByTestId('pista-anpr');
    expect(cajas[0]).toHaveStyle({ left: '25%', top: '25%', width: '50%', height: '50%' });
    expect(cajas[0]).toHaveTextContent('Leyendo');
    expect(cajas[1]).toHaveTextContent('P-123ABC');
    expect(document.querySelector('polygon')).toHaveAttribute('points', '10.00,10.00 90.00,10.00 90.00,90.00');
    expect(screen.getByText('2 vehículo(s): Leyendo, P-123ABC.')).toHaveClass('sr-only');
  });

  it('en pausa no hay vista en vivo y se dice que ningún carril abre solo; los errores se muestran', async () => {
    render(<AnprPanel estado={estadoAnpr({ pausado: true })} pistas={{}} error="Falta el detector de vehículos" onConfigurar={vi.fn()} />);
    expect(screen.getByText(/ANPR en pausa: ningún carril abre solo/)).toBeInTheDocument();
    expect(screen.getByText('Falta el detector de vehículos')).toBeInTheDocument();
    expect(screen.getByText('Pausado')).toBeInTheDocument();
    await waitFor(() => expect(puente).toHaveBeenCalled());
    expect(screen.queryByAltText(/Vista en vivo/)).not.toBeInTheDocument();
  });

  it('carril sin cámara: lo dice y no intenta la vista', () => {
    render(<AnprPanel estado={estadoAnpr({ carriles: [carril({ estado: { estado: 'sin_camara', motivo: 'La cámara no responde.' } })] })} pistas={{}} error={null} onConfigurar={vi.fn()} />);
    expect(screen.getByText('Sin cámara: La cámara no responde.')).toBeInTheDocument();
    expect(screen.queryByAltText(/Vista en vivo/)).not.toBeInTheDocument();
  });
});
