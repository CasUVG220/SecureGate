import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ResidentesPage from '../pages/ResidentesPage';
import { getResidentes, createResidente, deleteResidente } from '../services/api';

vi.mock('../services/api', () => ({
  getResidentes: vi.fn(),
  createResidente: vi.fn(),
  updateResidente: vi.fn(),
  deleteResidente: vi.fn(),
}));

const mockGetResidentes = getResidentes as unknown as ReturnType<typeof vi.fn>;
const mockCreateResidente = createResidente as unknown as ReturnType<typeof vi.fn>;
const mockDeleteResidente = deleteResidente as unknown as ReturnType<typeof vi.fn>;

const residente = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'r1',
  numero_casa: '101',
  nombre: 'Juan Pérez',
  email: 'juan@test.com',
  estado_pago: 'al_dia',
  saldo_pendiente: '0.00',
  telefono: '555-1111',
  ...over,
});

describe('ResidentesPage', () => {
  beforeEach(() => {
    mockGetResidentes.mockReset();
    mockCreateResidente.mockReset();
    mockDeleteResidente.mockReset();
    vi.restoreAllMocks();
  });

  it('empty state: muestra "No hay residentes registrados."', async () => {
    mockGetResidentes.mockResolvedValue([]);
    render(<ResidentesPage />);

    expect(await screen.findByText('No hay residentes registrados.')).toBeInTheDocument();
  });

  it('render: tabla con residentes mockeados', async () => {
    mockGetResidentes.mockResolvedValue([
      residente({ id: 'r1', numero_casa: '101', nombre: 'Juan Pérez' }),
      residente({ id: 'r2', numero_casa: '102', nombre: 'Ana López', estado_pago: 'mora' }),
    ]);
    render(<ResidentesPage />);

    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument();
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText('101')).toBeInTheDocument();
    expect(screen.getByText('102')).toBeInTheDocument();
  });

  it('crear: llama createResidente() y actualiza la lista', async () => {
    mockGetResidentes
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([residente({ id: 'r3', numero_casa: '200', nombre: 'Nuevo Residente' })]);
    mockCreateResidente.mockResolvedValue(residente({ id: 'r3', numero_casa: '200' }));

    const { container } = render(<ResidentesPage />);
    await screen.findByText('No hay residentes registrados.');

    fireEvent.click(screen.getByText('+ Nuevo residente'));

    fireEvent.change(container.querySelector('input[name="nombre"]')!, { target: { value: 'Nuevo Residente' } });
    fireEvent.change(container.querySelector('input[name="email"]')!, { target: { value: 'nuevo@test.com' } });
    fireEvent.change(container.querySelector('input[name="password"]')!, { target: { value: 'secret123' } });
    fireEvent.change(container.querySelector('input[name="numero_casa"]')!, { target: { value: '200' } });

    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => expect(mockCreateResidente).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: 'Nuevo Residente', numero_casa: '200' })
    ));
    expect(await screen.findByText('Nuevo Residente')).toBeInTheDocument();
    expect(mockGetResidentes).toHaveBeenCalledTimes(2);
  });

  it('eliminar: llama deleteResidente() después de confirmar', async () => {
    mockGetResidentes.mockResolvedValue([residente({ id: 'r1', numero_casa: '101' })]);
    mockDeleteResidente.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ResidentesPage />);
    await screen.findByText('101');

    fireEvent.click(screen.getByTitle('Eliminar'));

    await waitFor(() => expect(mockDeleteResidente).toHaveBeenCalledWith('r1'));
  });
});
