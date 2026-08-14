import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PagosPage from '../pages/PagosPage';
import { getPagos, createPago, aprobarPago, rechazarPago, getResidentes } from '../services/api';

vi.mock('../services/api', () => ({
  getPagos: vi.fn(),
  createPago: vi.fn(),
  aprobarPago: vi.fn(),
  rechazarPago: vi.fn(),
  getResidentes: vi.fn(),
}));

const mockGetPagos = getPagos as unknown as ReturnType<typeof vi.fn>;
const mockCreatePago = createPago as unknown as ReturnType<typeof vi.fn>;
const mockAprobarPago = aprobarPago as unknown as ReturnType<typeof vi.fn>;
const mockRechazarPago = rechazarPago as unknown as ReturnType<typeof vi.fn>;
const mockGetResidentes = getResidentes as unknown as ReturnType<typeof vi.fn>;

const pago = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'p1',
  residente_id: 'r1',
  monto: '100.00',
  fecha_pago: '2026-07-01T00:00:00.000Z',
  metodo: 'efectivo',
  estado: 'pendiente',
  comprobante: null,
  referencia: null,
  banco: null,
  fecha_transferencia: null,
  comentario_rechazo: null,
  registrado_por: 'u1',
  numero_casa: '101',
  residente_nombre: 'Juan Pérez',
  ...over,
});

describe('PagosPage', () => {
  beforeEach(() => {
    mockGetPagos.mockReset();
    mockCreatePago.mockReset();
    mockAprobarPago.mockReset();
    mockRechazarPago.mockReset();
    mockGetResidentes.mockReset();
    mockGetResidentes.mockResolvedValue([
      { id: 'r1', numero_casa: '101', nombre: 'Juan Pérez', email: 'juan@test.com', estado_pago: 'al_dia', saldo_pendiente: '0.00' },
    ]);
  });

  it('empty state: muestra "No hay pagos registrados."', async () => {
    mockGetPagos.mockResolvedValue([]);
    render(<PagosPage />);

    expect(await screen.findByText('No hay pagos registrados.')).toBeInTheDocument();
  });

  it('render: tabla con pagos mockeados', async () => {
    mockGetPagos.mockResolvedValue([
      pago({ id: 'p1', numero_casa: '101', residente_nombre: 'Juan Pérez' }),
      pago({ id: 'p2', numero_casa: '102', residente_nombre: 'Ana López', estado: 'aprobado' }),
    ]);
    const { container } = render(<PagosPage />);

    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument();
    expect(screen.getByText('Ana López')).toBeInTheDocument();
    expect(container.querySelector('tbody')?.textContent).toContain('Q100.00');
  });

  it('crear pago: llama createPago()', async () => {
    mockGetPagos
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([pago({ id: 'p3', numero_casa: '101', residente_nombre: 'Juan Pérez' })]);
    mockCreatePago.mockResolvedValue(pago({ id: 'p3' }));

    render(<PagosPage />);
    await screen.findByText('No hay pagos registrados.');
    await waitFor(() => expect(mockGetResidentes).toHaveBeenCalled());

    fireEvent.click(screen.getByText('+ Registrar Pago en Efectivo'));

    fireEvent.change(screen.getByDisplayValue('Seleccionar residente...'), { target: { value: 'r1' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '150' } });

    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => expect(mockCreatePago).toHaveBeenCalledWith({ residente_id: 'r1', monto: 150 }));
    expect(mockGetPagos).toHaveBeenCalledTimes(2);
  });

  it('aprobar pago: llama aprobarPago() y cambia estado', async () => {
    mockGetPagos
      .mockResolvedValueOnce([pago({ id: 'p1', estado: 'pendiente' })])
      .mockResolvedValueOnce([pago({ id: 'p1', estado: 'aprobado' })]);
    mockAprobarPago.mockResolvedValue(pago({ id: 'p1', estado: 'aprobado' }));

    const { container } = render(<PagosPage />);
    await screen.findByText('Aprobar');

    fireEvent.click(screen.getByText('Aprobar'));

    await waitFor(() => expect(mockAprobarPago).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(container.querySelector('tbody span')?.textContent).toBe('Aprobado'));
  });

  it('rechazar pago: llama rechazarPago() y cambia estado', async () => {
    mockGetPagos
      .mockResolvedValueOnce([pago({ id: 'p1', estado: 'pendiente' })])
      .mockResolvedValueOnce([pago({ id: 'p1', estado: 'rechazado' })]);
    mockRechazarPago.mockResolvedValue(pago({ id: 'p1', estado: 'rechazado' }));

    const { container } = render(<PagosPage />);
    await screen.findByText('Rechazar');

    fireEvent.click(screen.getByText('Rechazar'));

    await waitFor(() => expect(mockRechazarPago).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(container.querySelector('tbody span')?.textContent).toBe('Rechazado'));
  });
});
