import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import DashboardPage from '../pages/DashboardPage';
import { getDashboard, type DashboardData } from '../services/api';

vi.mock('../services/api', () => ({ getDashboard: vi.fn() }));
const mockGet = getDashboard as unknown as ReturnType<typeof vi.fn>;

const datos = (over: Partial<DashboardData> = {}): DashboardData => ({
  accesos_hoy: 12,
  accesos_ayer_misma_hora: 10,
  dentro_ahora: 14,
  residentes_mora: 3,
  pagos_pendientes: 2,
  accesos_por_hora: Array.from({ length: 24 }, (_, h) => (h === 9 ? 7 : h === 10 ? 5 : 0)),
  accesos_recientes: [
    { id: 'a1', nombre_visitante: 'Luis Pérez', numero_casa: 'A-12', timestamp_entrada: new Date().toISOString(), timestamp_salida: null },
  ],
  ...over,
});

describe('DashboardPage', () => {
  beforeEach(() => { mockGet.mockReset(); });

  it('resume el día: accesos contra ayer a la misma hora y la gráfica por hora', async () => {
    mockGet.mockResolvedValue(datos());
    render(<DashboardPage />);
    const resumen = await screen.findByRole('region', { name: 'Resumen de hoy' });
    expect(within(resumen).getByRole('heading', { name: 'Accesos hoy' })).toBeInTheDocument();
    expect(within(resumen).getByText('12', { selector: 'p' })).toBeInTheDocument();
    expect(within(resumen).getByText('frente a 10 ayer a esta hora')).toBeInTheDocument();
    expect(within(resumen).getByRole('group', { name: /Accesos de hoy por hora/ })).toBeInTheDocument();
  });

  it('"visitantes dentro" viene del servidor, no de la lista de 10 recientes', async () => {
    mockGet.mockResolvedValue(datos());
    render(<DashboardPage />);
    const resumen = await screen.findByRole('region', { name: 'Resumen de hoy' });
    expect(within(resumen).getByText('14', { selector: 'span' })).toBeInTheDocument();
  });

  it('las filas que requieren atención llevan a su pantalla', async () => {
    mockGet.mockResolvedValue(datos());
    const onNavigate = vi.fn();
    render(<DashboardPage onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verificar pagos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver residentes' }));
    expect(onNavigate.mock.calls).toEqual([['verificacion'], ['residentes']]);
  });

  it('sin residentes registrados enseña los primeros pasos y cada uno lleva a su pantalla', async () => {
    mockGet.mockResolvedValue(datos({ total_residentes: 0, accesos_recientes: [] }));
    const onNavigate = vi.fn();
    render(<DashboardPage onNavigate={onNavigate} />);
    const pasos = await screen.findByRole('region', { name: 'Primeros pasos' });
    expect(within(pasos).getAllByRole('listitem')).toHaveLength(3);
    const ir = within(pasos).getAllByRole('button', { name: 'Ir' });
    ir.forEach(b => fireEvent.click(b));
    expect(onNavigate.mock.calls).toEqual([['residentes'], ['agentes'], ['garitas']]);
  });

  it('con residentes (o sin dato del servidor) no estorba con los primeros pasos', async () => {
    mockGet.mockResolvedValue(datos({ total_residentes: 40 }));
    const { unmount } = render(<DashboardPage onNavigate={vi.fn()} />);
    await screen.findByRole('region', { name: 'Resumen de hoy' });
    expect(screen.queryByRole('region', { name: 'Primeros pasos' })).not.toBeInTheDocument();
    unmount();

    mockGet.mockResolvedValue(datos());          // servidor anterior: sin total_residentes
    render(<DashboardPage onNavigate={vi.fn()} />);
    await screen.findByRole('region', { name: 'Resumen de hoy' });
    expect(screen.queryByRole('region', { name: 'Primeros pasos' })).not.toBeInTheDocument();
  });

  it('sin pendientes no ofrece acciones vacías', async () => {
    mockGet.mockResolvedValue(datos({ pagos_pendientes: 0, residentes_mora: 0 }));
    render(<DashboardPage onNavigate={vi.fn()} />);
    await screen.findByRole('region', { name: 'Resumen de hoy' });
    expect(screen.queryByRole('button', { name: 'Verificar pagos' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Nada pendiente').length).toBeGreaterThan(0);
    expect(screen.getByText('Nadie en mora')).toBeInTheDocument();
  });
});

describe('DashboardPage — reservas por aprobar (SCRUM-112)', () => {
  beforeEach(() => { mockGet.mockReset(); });

  it('avisa cuántas reservas esperan decisión y lleva a la pantalla de reservas', async () => {
    mockGet.mockResolvedValue(datos({ reservas_pendientes: 3 }));
    const onNavigate = vi.fn();
    render(<DashboardPage onNavigate={onNavigate} />);
    const resumen = await screen.findByRole('region', { name: 'Resumen de hoy' });
    expect(within(resumen).getByText('Reservas por aprobar')).toBeInTheDocument();
    expect(within(resumen).getByText('Los residentes esperan tu respuesta.')).toBeInTheDocument();
    fireEvent.click(within(resumen).getByRole('button', { name: 'Revisar reservas' }));
    expect(onNavigate).toHaveBeenCalledWith('reservas');
  });

  it('sin reservas pendientes no ofrece la acción', async () => {
    mockGet.mockResolvedValue(datos({ reservas_pendientes: 0 }));
    render(<DashboardPage onNavigate={vi.fn()} />);
    await screen.findByRole('region', { name: 'Resumen de hoy' });
    expect(screen.getByText('Nada por aprobar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revisar reservas' })).toBeNull();
  });

  it('un servidor que no manda el dato (versión anterior) no muestra la fila', async () => {
    mockGet.mockResolvedValue(datos());
    render(<DashboardPage onNavigate={vi.fn()} />);
    await screen.findByRole('region', { name: 'Resumen de hoy' });
    expect(screen.queryByText('Reservas por aprobar')).toBeNull();
  });
});
