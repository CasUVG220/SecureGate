import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import EstadisticasPage from '../pages/EstadisticasPage';
import { ToastProvider } from '../components/ui/Toast';
import { downloadReporteAccesos, getEstadisticas } from '../services/api';
import { estadisticasFixture } from '../pages/estadisticas/__tests__/fixture';

vi.mock('../services/api', () => ({
  getEstadisticas: vi.fn(),
  downloadReporteAccesos: vi.fn(),
  downloadReportePagos: vi.fn(),
}));

const mockGet = getEstadisticas as unknown as ReturnType<typeof vi.fn>;
const mockDescargarAccesos = downloadReporteAccesos as unknown as ReturnType<typeof vi.fn>;

const renderPagina = () => render(<ToastProvider><EstadisticasPage /></ToastProvider>);

describe('EstadisticasPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 24, 10, 0));
    localStorage.clear();
    mockGet.mockReset();
    mockDescargarAccesos.mockReset();
    mockGet.mockResolvedValue(estadisticasFixture());
  });

  afterEach(() => { vi.useRealTimers(); });

  it('pide los últimos 30 días por defecto y muestra cifras, hallazgos y gráficos', async () => {
    renderPagina();
    expect(await screen.findByText('Lo más importante')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('2026-08-26', '2026-09-24', expect.any(AbortSignal));

    // Una cifra manda (visitas, con su gráfico) y el resto se compara en filas.
    const resumen = screen.getByRole('region', { name: 'Cifras del periodo' });
    expect(within(resumen).getByRole('heading', { name: 'Visitas en el periodo' })).toBeInTheDocument();
    expect(within(resumen).getByText('125')).toBeInTheDocument();
    expect(within(resumen).getByText('frente a 100 del periodo anterior')).toBeInTheDocument();
    expect(within(resumen).getByText('Q2,400')).toBeInTheDocument();
    expect(within(resumen).getByText('frente a Q3,000 del periodo anterior')).toBeInTheDocument();
    expect(within(resumen).getByText('75%')).toBeInTheDocument();
    // Solo cuatro cifras arriba (SCRUM-115 / H11): la de solicitudes pasó a la sección Comunidad, con su gráfico.
    expect(within(resumen).getAllByRole('heading')).toHaveLength(1);                 // la cifra que manda
    expect(within(resumen).getAllByRole('listitem')).toHaveLength(3);                // y tres filas: 1 + 3 = 4 cifras
    expect(within(resumen).queryByText('2 de 5')).not.toBeInTheDocument();
    expect(screen.getByText('2 de 5 resueltas')).toBeInTheDocument();
    // Sin tarjetas de adorno: la variación va escrita, no en píldoras.
    expect(screen.queryByText('nuevo')).not.toBeInTheDocument();

    expect(screen.getByText('Las visitas subieron 25% frente al periodo anterior (125 contra 100).')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Visitas por día/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /¿Cuándo llegan las visitas\?/ })).toBeInTheDocument();
    expect(screen.getByText('Casa A-12')).toBeInTheDocument();
  });

  it('la fila de pagos por verificar lleva a la pantalla de verificación', async () => {
    const onNavigate = vi.fn();
    render(<ToastProvider><EstadisticasPage onNavigate={onNavigate} /></ToastProvider>);
    await screen.findByText('Lo más importante');
    fireEvent.click(screen.getByRole('button', { name: 'Verificar pagos' }));
    expect(onNavigate).toHaveBeenCalledWith('verificacion');
  });

  it('cambiar de atajo vuelve a pedir y recuerda la elección', async () => {
    renderPagina();
    await screen.findByText('Lo más importante');

    fireEvent.click(screen.getByRole('button', { name: '7 días' }));
    await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith('2026-09-18', '2026-09-24', expect.any(AbortSignal)));
    expect(screen.getByRole('button', { name: '7 días' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('sg_stats_preset')).toBe('7d');
  });

  it('rango personalizado: valida antes de pedir', async () => {
    renderPagina();
    await screen.findByText('Lo más importante');
    fireEvent.click(screen.getByRole('button', { name: 'Personalizado' }));

    const [desde, hasta] = screen.getAllByDisplayValue(/2026-/) as HTMLInputElement[];
    fireEvent.change(desde, { target: { value: '2026-09-30' } });
    expect(screen.getByRole('alert')).toHaveTextContent('"Desde" no puede ser posterior a "Hasta".');
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled();

    fireEvent.change(desde, { target: { value: '2026-07-01' } });
    fireEvent.change(hasta, { target: { value: '2026-07-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith('2026-07-01', '2026-07-31', expect.any(AbortSignal)));
  });

  it('cada gráfico ofrece su vista de tabla', async () => {
    renderPagina();
    await screen.findByText('Lo más importante');
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver tabla' })[0]);
    const tabla = screen.getByRole('table', { name: 'Visitas por día' });
    expect(within(tabla).getAllByRole('row')).toHaveLength(8); // encabezado + 7 días
    expect(screen.getByRole('button', { name: 'Ver gráfico' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('si la carga falla, ofrece reintentar', async () => {
    mockGet.mockRejectedValueOnce(new Error('boom'));
    renderPagina();
    expect(await screen.findByText('No se pudieron cargar los reportes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Lo más importante')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('una descarga fallida avisa en vez de fingir éxito', async () => {
    mockDescargarAccesos.mockRejectedValueOnce(new Error('No se pudo generar el reporte'));
    renderPagina();
    await screen.findByText('Lo más importante');
    fireEvent.click(screen.getByRole('button', { name: 'Descargar CSV: Reporte de entradas' }));
    expect(await screen.findByText('No se pudo generar el reporte')).toBeInTheDocument();
    expect(mockDescargarAccesos).toHaveBeenCalledWith('2026-08-26', '2026-09-24');
  });
});
