import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AdminReservasPage from '../pages/AdminReservasPage';
import { ToastProvider } from '../components/Toast';
import { getReservas, getAreas, aprobarReserva, rechazarReserva } from '../services/api';

vi.mock('../services/api', () => ({
  getReservas: vi.fn(),
  getAreas: vi.fn(),
  aprobarReserva: vi.fn(),
  rechazarReserva: vi.fn(),
}));

const mockGetReservas = getReservas as unknown as ReturnType<typeof vi.fn>;
const mockGetAreas = getAreas as unknown as ReturnType<typeof vi.fn>;
const mockAprobar = aprobarReserva as unknown as ReturnType<typeof vi.fn>;
const mockRechazar = rechazarReserva as unknown as ReturnType<typeof vi.fn>;

const renderPage = () => render(<ToastProvider><AdminReservasPage /></ToastProvider>);

/**
 * Los nombres de área y los estados aparecen también en los <option> de los
 * filtros, así que las aserciones de contenido se acotan a la tabla.
 */
const enTabla = () => within(screen.getByRole('table'));

const reserva = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'rsv1',
  area_id: 'a1',
  residente_id: 'res1',
  fecha: '2026-12-10T00:00:00.000Z',
  hora_inicio: '14:00:00',
  hora_fin: '16:00:00',
  estado: 'pendiente_aprobacion',
  cargo_id: 'p1',
  monto_cargo: '50.00',
  motivo_cancelacion: null,
  reembolso_aplicado: null,
  created_at: '2026-08-01T00:00:00.000Z',
  area_nombre: 'Salón Social',
  numero_casa: 'A-01',
  residente_nombre: 'Residente Demo',
  ...over,
});

describe('AdminReservasPage', () => {
  beforeEach(() => {
    mockGetReservas.mockReset();
    mockGetAreas.mockReset();
    mockAprobar.mockReset();
    mockRechazar.mockReset();
    mockGetAreas.mockResolvedValue([
      {
        id: 'a1', sucursal_id: 's1', nombre: 'Salón Social', descripcion: null,
        imagen_url: null, tarifa_tipo: 'por_hora', tarifa_monto: '25.00',
        requiere_aprobacion: null, activa: true, created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    mockGetReservas.mockResolvedValue([]);
  });

  it('estado vacío: avisa que no hay reservas para los filtros', async () => {
    renderPage();
    expect(
      await screen.findByText('No hay reservas que coincidan con los filtros.')
    ).toBeInTheDocument();
  });

  it('lista las reservas con área, residente, horario y cargo', async () => {
    mockGetReservas.mockResolvedValue([reserva()]);
    renderPage();

    await screen.findByText('Residente Demo');
    const tabla = enTabla();
    expect(tabla.getByText('Salón Social')).toBeInTheDocument();
    expect(tabla.getByText('Residente Demo')).toBeInTheDocument();
    expect(tabla.getByText('14:00 – 16:00')).toBeInTheDocument();
    expect(tabla.getByText('Q50.00')).toBeInTheDocument();
    expect(tabla.getByText('Pendiente de aprobación')).toBeInTheDocument();
  });

  it('aprueba una reserva pendiente y recarga la lista', async () => {
    mockGetReservas
      .mockResolvedValueOnce([reserva()])
      .mockResolvedValueOnce([reserva({ estado: 'confirmada' })]);
    mockAprobar.mockResolvedValue(reserva({ estado: 'confirmada' }));
    renderPage();

    fireEvent.click(await screen.findByText('Aprobar'));

    await waitFor(() => expect(mockAprobar).toHaveBeenCalledWith('rsv1'));
    expect(await screen.findByText('Reserva aprobada')).toBeInTheDocument();
    // Se refresca la tabla tras la mutación
    await waitFor(() => expect(mockGetReservas).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(enTabla().getByText('Confirmada')).toBeInTheDocument());
  });

  it('rechaza una reserva pendiente pasando el motivo que escribe el admin', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('El salón está en mantenimiento');
    mockGetReservas
      .mockResolvedValueOnce([reserva()])
      .mockResolvedValueOnce([reserva({ estado: 'rechazada' })]);
    mockRechazar.mockResolvedValue(reserva({ estado: 'rechazada' }));
    renderPage();

    fireEvent.click(await screen.findByText('Rechazar'));

    await waitFor(() =>
      expect(mockRechazar).toHaveBeenCalledWith('rsv1', 'El salón está en mantenimiento')
    );
    expect(await screen.findByText('Reserva rechazada')).toBeInTheDocument();
  });

  it('no rechaza nada si el admin cancela el prompt', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    mockGetReservas.mockResolvedValue([reserva()]);
    renderPage();

    fireEvent.click(await screen.findByText('Rechazar'));

    await waitFor(() => expect(mockRechazar).not.toHaveBeenCalled());
  });

  it('no ofrece aprobar ni rechazar una reserva ya confirmada', async () => {
    mockGetReservas.mockResolvedValue([reserva({ estado: 'confirmada' })]);
    renderPage();

    await waitFor(() => expect(enTabla().getByText('Confirmada')).toBeInTheDocument());
    expect(screen.queryByText('Aprobar')).not.toBeInTheDocument();
    expect(screen.queryByText('Rechazar')).not.toBeInTheDocument();
  });

  it('muestra el reembolso aplicado en las reservas canceladas', async () => {
    mockGetReservas.mockResolvedValue([
      reserva({ estado: 'cancelada', reembolso_aplicado: '50.00', motivo_cancelacion: 'Cambio de planes' }),
    ]);
    renderPage();

    await screen.findByText('Cambio de planes');
    const tabla = enTabla();
    expect(tabla.getByText('Cancelada')).toBeInTheDocument();
    expect(tabla.getByText('Reembolso: 50%')).toBeInTheDocument();
    expect(tabla.getByText('Cambio de planes')).toBeInTheDocument();
  });

  it('filtra por estado y vuelve a consultar el backend', async () => {
    mockGetReservas.mockResolvedValue([]);
    renderPage();
    await screen.findByText('No hay reservas que coincidan con los filtros.');

    fireEvent.change(screen.getByLabelText('Estado'), {
      target: { value: 'pendiente_aprobacion' },
    });

    await waitFor(() =>
      expect(mockGetReservas).toHaveBeenLastCalledWith(
        expect.objectContaining({ estado: 'pendiente_aprobacion' })
      )
    );
  });
});
