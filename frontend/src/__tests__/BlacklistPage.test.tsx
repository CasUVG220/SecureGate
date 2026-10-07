import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import BlacklistPage from '../pages/BlacklistPage';
import {
  getBlacklist, createBlacklist, deleteBlacklist, buscarVisitantesPorDpi, buscarVisitantesPorPlaca,
} from '../services/api';

vi.mock('../services/api', () => ({
  getBlacklist: vi.fn(),
  createBlacklist: vi.fn(),
  deleteBlacklist: vi.fn(),
  buscarVisitantesPorDpi: vi.fn(),
  buscarVisitantesPorPlaca: vi.fn(),
}));

const mockList = getBlacklist as unknown as ReturnType<typeof vi.fn>;
const mockCreate = createBlacklist as unknown as ReturnType<typeof vi.fn>;
const mockDelete = deleteBlacklist as unknown as ReturnType<typeof vi.fn>;
const mockPorDpi = buscarVisitantesPorDpi as unknown as ReturnType<typeof vi.fn>;
const mockPorPlaca = buscarVisitantesPorPlaca as unknown as ReturnType<typeof vi.fn>;

const entrada = (over: Record<string, unknown> = {}) => ({
  id: 'b1', razon: 'Robo en el condominio', fecha_inicio: '2026-10-01T00:00:00Z', fecha_fin: null, activo: true,
  created_at: '2026-10-01T00:00:00Z', visitante_id: 'v1', visitante_nombre: 'Pedro Vetado', numero_dpi: '2999111220101',
  placa: null, sucursal_nombre: 'Principal', creado_por_nombre: 'Admin', ...over,
});

const abrirModal = async () => {
  fireEvent.click((await screen.findAllByRole('button', { name: 'Bloquear visitante o vehículo' }))[0]);
  return screen.findByRole('dialog', { name: 'Bloquear visitante o vehículo' });
};

describe('BlacklistPage — lista negra por DPI y por placa', () => {
  beforeEach(() => {
    [mockList, mockCreate, mockDelete, mockPorDpi, mockPorPlaca].forEach(m => m.mockReset());
    mockList.mockResolvedValue([
      entrada(),
      entrada({ id: 'b2', visitante_id: null, visitante_nombre: null, numero_dpi: null, placa: 'P123ABC', razon: 'Vehículo robado' }),
    ]);
    mockCreate.mockResolvedValue(entrada());
  });

  it('lista bloqueos por visitante y por vehículo (placa con guion, sin visitante)', async () => {
    render(<BlacklistPage />);
    expect(await screen.findByText('Pedro Vetado')).toBeInTheDocument();
    expect(screen.getByText('Vehículo sin visitante registrado')).toBeInTheDocument();
    expect(screen.getByText('P-123ABC')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Placa' })).toBeInTheDocument();
  });

  it('el buscador filtra también por placa en cualquier formato', async () => {
    render(<BlacklistPage />);
    await screen.findByText('Pedro Vetado');
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'p-123 abc' } });
    expect(screen.queryByText('Pedro Vetado')).toBeNull();
    expect(screen.getByText('Vehículo robado')).toBeInTheDocument();
  });

  it('el formulario ofrece «Buscar visitante por DPI o placa» con selector DPI / Placa', async () => {
    render(<BlacklistPage />);
    const dialogo = await abrirModal();
    expect(within(dialogo).getByText(/Buscar visitante por DPI o placa/)).toBeInTheDocument();
    const dpi = within(dialogo).getByRole('radio', { name: 'DPI' });
    const placa = within(dialogo).getByRole('radio', { name: 'Placa' });
    expect(dpi).toHaveAttribute('aria-checked', 'true');
    expect(placa).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(placa);
    expect(placa).toHaveAttribute('aria-checked', 'true');
  });

  it('sin resultados por DPI muestra «No se encontró ningún visitante con ese dato»', async () => {
    mockPorDpi.mockResolvedValue([]);
    render(<BlacklistPage />);
    const dialogo = await abrirModal();
    fireEvent.change(within(dialogo).getByLabelText(/Buscar visitante por DPI o placa/), { target: { value: '2999000' } });
    expect(await within(dialogo).findByText('No se encontró ningún visitante con ese dato')).toBeInTheDocument();
    expect(mockPorDpi).toHaveBeenCalledWith('2999000');
    expect(within(dialogo).queryByRole('button', { name: /Bloquear solo la placa/ })).toBeNull(); // solo aplica a placas
  });

  it('por DPI: elige al visitante y manda visitante_id (sin placa)', async () => {
    mockPorDpi.mockResolvedValue([{ id: 'v9', nombre: 'Ana Visitante', numero_dpi: '2999000010101' }]);
    render(<BlacklistPage />);
    const dialogo = await abrirModal();
    fireEvent.change(within(dialogo).getByLabelText(/Buscar visitante por DPI o placa/), { target: { value: '29990' } });
    fireEvent.click(await within(dialogo).findByRole('button', { name: /Ana Visitante/ }));
    fireEvent.change(within(dialogo).getByLabelText(/Razón/), { target: { value: 'Altercado con vecinos' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Bloquear visitante o vehículo' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({
      visitante_id: 'v9', razon: 'Altercado con vecinos', duracion: 'temporal_dias', dias: 7,
    }));
  });

  it('por placa sin resultados: ofrece bloquear solo la placa y la manda normalizada, sin visitante_id', async () => {
    mockPorPlaca.mockResolvedValue([]);
    render(<BlacklistPage />);
    const dialogo = await abrirModal();
    fireEvent.click(within(dialogo).getByRole('radio', { name: 'Placa' }));
    fireEvent.change(within(dialogo).getByLabelText(/Buscar visitante por DPI o placa/), { target: { value: 'p-555 xyz' } });

    expect(await within(dialogo).findByText('No se encontró ningún visitante con ese dato')).toBeInTheDocument();
    expect(mockPorPlaca).toHaveBeenCalledWith('p-555 xyz');
    fireEvent.click(within(dialogo).getByRole('button', { name: /Bloquear solo la placa P-555XYZ/ }));
    expect(within(dialogo).getByText(/Se bloqueará el vehículo con placa/)).toHaveTextContent('P-555XYZ');

    fireEvent.change(within(dialogo).getByLabelText(/Razón/), { target: { value: 'Vehículo sospechoso' } });
    fireEvent.change(within(dialogo).getByLabelText(/Duración/), { target: { value: 'indefinido' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Bloquear visitante o vehículo' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({
      razon: 'Vehículo sospechoso', duracion: 'indefinido', dias: undefined, placa: 'P555XYZ',
    }));
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('visitante_id');
  });

  it('por placa con resultado: bloquea al visitante y, marcada por defecto, también su placa', async () => {
    mockPorPlaca.mockResolvedValue([{ id: 'v3', nombre: 'Luis Conductor', numero_dpi: '2999333330101', placa: 'P777ZZZ' }]);
    render(<BlacklistPage />);
    const dialogo = await abrirModal();
    fireEvent.click(within(dialogo).getByRole('radio', { name: 'Placa' }));
    fireEvent.change(within(dialogo).getByLabelText(/Buscar visitante por DPI o placa/), { target: { value: '777zzz' } });
    fireEvent.click(await within(dialogo).findByRole('button', { name: /Luis Conductor/ }));

    const casilla = within(dialogo).getByRole('checkbox', { name: /Bloquear también la placa/ });
    expect(casilla).toBeChecked();
    fireEvent.change(within(dialogo).getByLabelText(/Razón/), { target: { value: 'Se estacionó en cochera ajena' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Bloquear visitante o vehículo' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ visitante_id: 'v3', placa: 'P777ZZZ' })));

    // …y sin la casilla solo viaja el visitante
    mockCreate.mockClear();
    fireEvent.click(await screen.findAllByRole('button', { name: 'Bloquear visitante o vehículo' }).then(b => b[0]));
    const d2 = await screen.findByRole('dialog', { name: 'Bloquear visitante o vehículo' });
    fireEvent.click(within(d2).getByRole('radio', { name: 'Placa' }));
    fireEvent.change(within(d2).getByLabelText(/Buscar visitante por DPI o placa/), { target: { value: '777zzz' } });
    fireEvent.click(await within(d2).findByRole('button', { name: /Luis Conductor/ }));
    fireEvent.click(within(d2).getByRole('checkbox', { name: /Bloquear también la placa/ }));
    fireEvent.change(within(d2).getByLabelText(/Razón/), { target: { value: 'Solo él' } });
    fireEvent.click(within(d2).getByRole('button', { name: 'Bloquear visitante o vehículo' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ visitante_id: 'v3' });
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('placa');
  });

  it('sin visitante ni placa elegidos no envía y explica qué falta', async () => {
    render(<BlacklistPage />);
    const dialogo = await abrirModal();
    fireEvent.change(within(dialogo).getByLabelText(/Razón/), { target: { value: 'x' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Bloquear visitante o vehículo' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Selecciona un visitante o bloquea solo la placa');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('un 409 del servidor se muestra dentro del formulario', async () => {
    mockPorPlaca.mockResolvedValue([]);
    mockCreate.mockRejectedValue(new Error('Esa placa ya está bloqueada en esta sucursal'));
    render(<BlacklistPage />);
    const dialogo = await abrirModal();
    fireEvent.click(within(dialogo).getByRole('radio', { name: 'Placa' }));
    fireEvent.change(within(dialogo).getByLabelText(/Buscar visitante por DPI o placa/), { target: { value: 'P123ABC' } });
    fireEvent.click(await within(dialogo).findByRole('button', { name: /Bloquear solo la placa/ }));
    fireEvent.change(within(dialogo).getByLabelText(/Razón/), { target: { value: 'Otra vez' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Bloquear visitante o vehículo' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Esa placa ya está bloqueada');
  });

  it('Quitar bloqueo pide confirmación en un Modal (no en window.confirm) y llama a la API', async () => {
    const confirmar = vi.spyOn(window, 'confirm');
    mockDelete.mockResolvedValue(undefined);
    render(<BlacklistPage />);
    await screen.findByText('Pedro Vetado');
    fireEvent.click(screen.getAllByRole('button', { name: 'Quitar bloqueo' })[0]);

    const dialogo = await screen.findByRole('dialog', { name: 'Quitar el bloqueo' });
    expect(dialogo).toHaveTextContent('Pedro Vetado');
    expect(mockDelete).not.toHaveBeenCalled();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Quitar bloqueo' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('b1'));
    expect(confirmar).not.toHaveBeenCalled();
  });

  it('«Quitar bloqueo» no es un botón verde de éxito', async () => {
    render(<BlacklistPage />);
    await screen.findByText('Pedro Vetado');
    const boton = screen.getAllByRole('button', { name: 'Quitar bloqueo' })[0];
    expect(boton.className).not.toMatch(/success|green|emerald/);
  });
});
