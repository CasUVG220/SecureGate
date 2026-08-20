import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReservasPage from '../pages/ReservasPage';
import { ToastProvider } from '../components/Toast';
import {
  getAreas, getDisponibilidad, crearReserva, getMisReservas,
  getPreviewCancelacion, cancelarReserva,
} from '../services/api';

vi.mock('../services/api', () => ({
  getAreas: vi.fn(),
  getDisponibilidad: vi.fn(),
  crearReserva: vi.fn(),
  getMisReservas: vi.fn(),
  getPreviewCancelacion: vi.fn(),
  cancelarReserva: vi.fn(),
}));

const mockGetAreas = getAreas as unknown as ReturnType<typeof vi.fn>;
const mockGetDisp = getDisponibilidad as unknown as ReturnType<typeof vi.fn>;
const mockCrear = crearReserva as unknown as ReturnType<typeof vi.fn>;
const mockGetMis = getMisReservas as unknown as ReturnType<typeof vi.fn>;
const mockPreview = getPreviewCancelacion as unknown as ReturnType<typeof vi.fn>;
const mockCancelar = cancelarReserva as unknown as ReturnType<typeof vi.fn>;

/** Los avisos de confirmación salen por toast, que necesita su provider. */
const renderPage = () => render(<ToastProvider><ReservasPage /></ToastProvider>);

const area = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'a1',
  sucursal_id: 's1',
  nombre: 'Salón Social',
  descripcion: 'Para eventos',
  imagen_url: null,
  tarifa_tipo: 'por_hora',
  tarifa_monto: '25.00',
  requiere_aprobacion: null,
  activa: true,
  created_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

const disponibilidad = (over: Partial<Record<string, unknown>> = {}) => ({
  area: { id: 'a1', nombre: 'Salón Social', activa: true, tarifa_tipo: 'por_hora', tarifa_monto: '25.00' },
  fecha: '2026-12-10',
  buffer_minutos: 0,
  buffer_motivo: null,
  ocupados: [],
  ...over,
});

const reserva = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'rsv1',
  area_id: 'a1',
  residente_id: 'res1',
  fecha: '2026-12-10T00:00:00.000Z',
  hora_inicio: '14:00:00',
  hora_fin: '16:00:00',
  estado: 'confirmada',
  cargo_id: 'p1',
  monto_cargo: '50.00',
  motivo_cancelacion: null,
  reembolso_aplicado: null,
  created_at: '2026-08-01T00:00:00.000Z',
  area_nombre: 'Salón Social',
  es_futura: true,
  ...over,
});

describe('ReservasPage (residente)', () => {
  beforeEach(() => {
    mockGetAreas.mockReset();
    mockGetDisp.mockReset();
    mockCrear.mockReset();
    mockGetMis.mockReset();
    mockPreview.mockReset();
    mockCancelar.mockReset();

    mockGetAreas.mockResolvedValue([area()]);
    mockGetDisp.mockResolvedValue(disponibilidad());
    mockGetMis.mockResolvedValue([]);
  });

  it('carga las áreas activas y selecciona la primera', async () => {
    renderPage();

    await waitFor(() => expect(mockGetAreas).toHaveBeenCalledWith(true));
    const select = await screen.findByLabelText('Elige un área');
    expect((select as HTMLSelectElement).value).toBe('a1');
    expect(await screen.findByText('Para eventos')).toBeInTheDocument();
  });

  it('consulta la disponibilidad del área y la fecha seleccionadas', async () => {
    renderPage();
    await waitFor(() => expect(mockGetDisp).toHaveBeenCalled());
    expect(mockGetDisp.mock.calls[0][0]).toBe('a1');
    expect(await screen.findByText('No hay reservas para esta fecha.')).toBeInTheDocument();
  });

  it('muestra los horarios ocupados con el rango bloqueado y el motivo del buffer', async () => {
    mockGetDisp.mockResolvedValue(
      disponibilidad({
        buffer_minutos: 30,
        buffer_motivo: 'Limpieza y desinfección entre usos',
        ocupados: [
          {
            id: 'o1',
            fecha: '2026-12-10',
            hora_inicio: '14:00:00',
            hora_fin: '16:00:00',
            estado: 'confirmada',
            bloqueo_desde: '2026-12-10T13:30:00',
            bloqueo_hasta: '2026-12-10T16:30:00',
          },
        ],
      })
    );
    renderPage();

    expect(await screen.findByText('14:00 – 16:00')).toBeInTheDocument();
    expect(
      await screen.findByText(/Se bloquean 30 minutos antes y después de cada reserva/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Limpieza y desinfección entre usos/)).toBeInTheDocument();
    // El rango bloqueado incluye el buffer a ambos lados de la reserva
    expect(screen.getByText(/13:30 – 16:30/)).toBeInTheDocument();
  });

  it('calcula y muestra el costo antes de confirmar (2 h × Q25 = Q50.00)', async () => {
    renderPage();
    await screen.findByLabelText('Hora de inicio');

    fireEvent.change(screen.getByLabelText('Hora de inicio'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('Hora de fin'), { target: { value: '16:00' } });

    expect(await screen.findByText('Q50.00')).toBeInTheDocument();
  });

  it('muestra "Gratis" cuando el área no tiene tarifa', async () => {
    mockGetAreas.mockResolvedValue([area({ tarifa_tipo: 'gratis', tarifa_monto: '0.00' })]);
    renderPage();

    await waitFor(() => expect(mockGetAreas).toHaveBeenCalled());
    expect(await screen.findByText('Gratis')).toBeInTheDocument();
  });

  it('crea la reserva con los datos elegidos y avisa que quedó confirmada', async () => {
    mockCrear.mockResolvedValue(reserva({ estado: 'confirmada' }));
    renderPage();
    await screen.findByLabelText('Hora de inicio');

    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-12-10' } });
    fireEvent.change(screen.getByLabelText('Hora de inicio'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('Hora de fin'), { target: { value: '16:00' } });
    fireEvent.click(screen.getByText('Reservar'));

    await waitFor(() =>
      expect(mockCrear).toHaveBeenCalledWith({
        area_id: 'a1',
        fecha: '2026-12-10',
        hora_inicio: '14:00',
        hora_fin: '16:00',
      })
    );
    expect(await screen.findByText('Reserva confirmada')).toBeInTheDocument();
  });

  it('avisa cuando la reserva queda pendiente de aprobación', async () => {
    mockCrear.mockResolvedValue(reserva({ estado: 'pendiente_aprobacion' }));
    renderPage();
    await screen.findByLabelText('Hora de inicio');

    fireEvent.change(screen.getByLabelText('Hora de inicio'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('Hora de fin'), { target: { value: '12:00' } });
    fireEvent.click(screen.getByText('Reservar'));

    expect(
      await screen.findByText('Pendiente de aprobación del administrador')
    ).toBeInTheDocument();
  });

  it('muestra el error del backend cuando el horario ya está tomado', async () => {
    mockCrear.mockRejectedValue(
      new Error('Este horario ya fue reservado, por favor elige otro')
    );
    renderPage();
    await screen.findByLabelText('Hora de inicio');

    fireEvent.change(screen.getByLabelText('Hora de inicio'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('Hora de fin'), { target: { value: '16:00' } });
    fireEvent.click(screen.getByText('Reservar'));

    expect(
      await screen.findByText('Este horario ya fue reservado, por favor elige otro')
    ).toBeInTheDocument();
  });

  it('valida que la hora de fin sea posterior sin llamar a la API', async () => {
    renderPage();
    await screen.findByLabelText('Hora de inicio');

    fireEvent.change(screen.getByLabelText('Hora de inicio'), { target: { value: '16:00' } });
    fireEvent.change(screen.getByLabelText('Hora de fin'), { target: { value: '14:00' } });
    fireEvent.click(screen.getByText('Reservar'));

    expect(
      await screen.findByText('La hora de fin debe ser posterior a la de inicio.')
    ).toBeInTheDocument();
    expect(mockCrear).not.toHaveBeenCalled();
  });

  it('lista "Mis reservas" con su estado y monto', async () => {
    mockGetMis.mockResolvedValue([reserva()]);
    renderPage();

    expect(await screen.findByText('Confirmada')).toBeInTheDocument();
    expect(screen.getByText('Q50.00')).toBeInTheDocument();
  });

  it('muestra el reembolso que aplicaría ANTES de confirmar la cancelación', async () => {
    mockGetMis.mockResolvedValue([reserva()]);
    mockPreview.mockResolvedValue({
      reserva_id: 'rsv1',
      estado: 'confirmada',
      permite_cancelacion: true,
      cancelable: true,
      horas_restantes: 30,
      reembolso_aplicado: 50,
      monto_cargo: 50,
      monto_reembolso: 25,
      horas_limite_cancelacion_completa: 48,
      horas_limite_cancelacion_parcial: 24,
    });
    renderPage();

    fireEvent.click(await screen.findByText('Cancelar'));

    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith('rsv1'));
    expect(await screen.findByText(/Si cancelas ahora, recibirás 50%/)).toBeInTheDocument();
    // Todavía no se canceló nada: el aviso es previo a confirmar
    expect(mockCancelar).not.toHaveBeenCalled();
  });

  it('avisa que no habrá reembolso cuando ya pasó el límite parcial', async () => {
    mockGetMis.mockResolvedValue([reserva()]);
    mockPreview.mockResolvedValue({
      reserva_id: 'rsv1',
      estado: 'confirmada',
      permite_cancelacion: true,
      cancelable: true,
      horas_restantes: 3,
      reembolso_aplicado: 0,
      monto_cargo: 50,
      monto_reembolso: 0,
      horas_limite_cancelacion_completa: 48,
      horas_limite_cancelacion_parcial: 24,
    });
    renderPage();

    fireEvent.click(await screen.findByText('Cancelar'));

    expect(
      await screen.findByText('Si cancelas ahora, no habrá reembolso: el cargo se mantiene.')
    ).toBeInTheDocument();
  });

  it('cancela la reserva al confirmar', async () => {
    mockGetMis.mockResolvedValue([reserva()]);
    mockPreview.mockResolvedValue({
      reserva_id: 'rsv1',
      estado: 'confirmada',
      permite_cancelacion: true,
      cancelable: true,
      horas_restantes: 72,
      reembolso_aplicado: 100,
      monto_cargo: 50,
      monto_reembolso: 50,
      horas_limite_cancelacion_completa: 48,
      horas_limite_cancelacion_parcial: 24,
    });
    mockCancelar.mockResolvedValue(reserva({ estado: 'cancelada' }));
    renderPage();

    fireEvent.click(await screen.findByText('Cancelar'));
    await screen.findByText(/Si cancelas ahora, recibirás 100%/);
    fireEvent.click(screen.getByText('Confirmar cancelación'));

    await waitFor(() => expect(mockCancelar).toHaveBeenCalledWith('rsv1', undefined));
  });
});
