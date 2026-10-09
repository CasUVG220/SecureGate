/**
 * SCRUM-114 / H10 — pestaña «Invitados» del portal del residente.
 * Visitas avisadas (lo que la garita espera) y visitantes guardados (libreta que NO deja entrar a nadie)
 * son listas distintas; avisar de una visita guardada abre el mismo formulario con sus datos y no crea nada a ciegas.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ResidentePage from '../pages/ResidentePage';
import * as api from '../services/api';

vi.mock('../services/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  getResidenteMe: vi.fn(), getEstadoTarjeta: vi.fn(), getMisPagos: vi.fn(), getMiResumenMes: vi.fn(),
  getMisPreautorizaciones: vi.fn(), createMisPreautorizacion: vi.fn(), deleteMisPreautorizacion: vi.fn(),
  getMisAccesos: vi.fn(), getMisTickets: vi.fn(), getMisInvitaciones: vi.fn(),
}));

const m = <K extends keyof typeof api>(k: K) => api[k] as unknown as ReturnType<typeof vi.fn>;
const dia = (n: number) => new Date(Date.now() - 6 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);

const fila = (over: Partial<api.MiPreautorizacion>): api.MiPreautorizacion => ({
  id: 'p', nombre_visitante: 'Visita', numero_dpi: null, placa: null, fecha_inicio: dia(0), fecha_fin: dia(0),
  activo: true, created_at: '2026-01-01', ...over,
});

const FILAS = [
  fila({ id: 'a1', nombre_visitante: 'Taxi Don Beto', placa: 'P123ABC', fecha_inicio: dia(0), fecha_fin: dia(1) }),
  fila({ id: 'a2', nombre_visitante: 'Primo Pérez', numero_dpi: '9876543210101', fecha_inicio: dia(5), fecha_fin: dia(6) }),
  fila({ id: 'a3', nombre_visitante: 'Plomero', fecha_inicio: dia(-9), fecha_fin: dia(-8) }),
  fila({ id: 'g1', nombre_visitante: 'Abuela Rosa', numero_dpi: '1111111111111', fecha_inicio: dia(-20), fecha_fin: null }),
];

beforeEach(() => {
  vi.clearAllMocks();
  m('getResidenteMe').mockResolvedValue({
    id: 'r1', numero_casa: 'A-12', estado_pago: 'al_dia', saldo_pendiente: '0', telefono: null,
    nombre: 'Ana Gómez', email: 'ana@x.com', pagos_recientes: [],
  });
  m('getEstadoTarjeta').mockResolvedValue({ disponible: true, simulada: false });
  m('getMisPagos').mockResolvedValue([]);
  m('getMiResumenMes').mockResolvedValue(null);
  m('getMisPreautorizaciones').mockResolvedValue(FILAS);
  m('getMisAccesos').mockResolvedValue([]);
  m('getMisTickets').mockResolvedValue([]);
  m('getMisInvitaciones').mockResolvedValue([]);
});

const abrir = async () => {
  render(<ResidentePage requestedTab="invitados" />);
  return screen.findByRole('region', { name: 'Visitas avisadas' });
};

describe('ResidentePage › Invitados', () => {
  it('separa lo que la garita espera (vigentes y próximas) de la libreta de guardados', async () => {
    const avisadas = await abrir();
    expect(within(avisadas).getByText('Taxi Don Beto')).toBeInTheDocument();
    expect(within(avisadas).getByText('Primo Pérez')).toBeInTheDocument();
    expect(within(avisadas).getByText('Hoy')).toBeInTheDocument();
    expect(within(avisadas).getByText('Próxima')).toBeInTheDocument();
    expect(within(avisadas).getByText('Placa: P-123ABC')).toBeInTheDocument();
    expect(within(avisadas).queryByText('Plomero')).not.toBeInTheDocument();         // vencida
    expect(within(avisadas).queryByText('Abuela Rosa')).not.toBeInTheDocument();     // guardada, no es un aviso

    const guardados = screen.getByRole('region', { name: 'Visitantes guardados' });
    expect(within(guardados).getByText('Abuela Rosa')).toBeInTheDocument();
    expect(within(guardados).getByText('Guardado')).toBeInTheDocument();
    expect(within(guardados).queryByText('Taxi Don Beto')).not.toBeInTheDocument();
  });

  it('sin avisos explica qué hacer', async () => {
    m('getMisPreautorizaciones').mockResolvedValue([FILAS[3]]);
    const avisadas = await abrir();
    expect(within(avisadas).getByText('No has avisado de ninguna visita.')).toBeInTheDocument();
    expect(within(avisadas).getByRole('button', { name: 'Avisar de una visita' })).toBeInTheDocument();
  });

  it('«Avisar de su visita» abre el formulario con los datos de la persona guardada y NO crea nada hasta enviar', async () => {
    await abrir();
    const guardados = screen.getByRole('region', { name: 'Visitantes guardados' });
    fireEvent.click(within(guardados).getByRole('button', { name: 'Avisar de su visita' }));

    const d = await screen.findByRole('dialog', { name: 'Avisar de una visita' });
    expect(within(d).getByLabelText(/Nombre del visitante/)).toHaveValue('Abuela Rosa');
    expect(within(d).getByLabelText('DPI')).toHaveValue('1111111111111');
    expect(within(d).getByLabelText(/Desde/)).toHaveValue(dia(0));
    expect(m('createMisPreautorizacion')).not.toHaveBeenCalled();

    // Enviarlo crea el aviso (con fechas) y aparece de inmediato en «Visitas avisadas», sin recargar.
    m('createMisPreautorizacion').mockResolvedValue(fila({ id: 'nuevo', nombre_visitante: 'Abuela Rosa', numero_dpi: '1111111111111' }));
    fireEvent.click(within(d).getByRole('button', { name: 'Avisar' }));
    await waitFor(() => expect(m('createMisPreautorizacion')).toHaveBeenCalledWith({
      nombre_visitante: 'Abuela Rosa', numero_dpi: '1111111111111', placa: undefined, fecha_inicio: dia(0), fecha_fin: dia(0),
    }));
    const avisadas = screen.getByRole('region', { name: 'Visitas avisadas' });
    expect(await within(avisadas).findByText('Abuela Rosa')).toBeInTheDocument();
  });

  it('guardar un visitante no manda fecha_fin: queda en la libreta, no como aviso', async () => {
    m('createMisPreautorizacion').mockResolvedValue(fila({ id: 'g2', nombre_visitante: 'Doña Lupe', numero_dpi: '2222222222222', fecha_fin: null }));
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar visitante' }));
    const formulario = screen.getByText('Guardar datos del visitante').closest('form')!;
    expect(within(formulario).getByText(/no deja entrar a nadie/)).toBeInTheDocument();
    fireEvent.change(within(formulario).getByLabelText(/^Nombre/), { target: { value: 'Doña Lupe' } });
    fireEvent.change(within(formulario).getByLabelText(/^DPI/), { target: { value: '2222222222222' } });
    fireEvent.click(within(formulario).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(m('createMisPreautorizacion')).toHaveBeenCalledTimes(1));
    const enviado = m('createMisPreautorizacion').mock.calls[0][0];
    expect(enviado).toMatchObject({ nombre_visitante: 'Doña Lupe', numero_dpi: '2222222222222', fecha_inicio: dia(0) });
    expect(enviado.fecha_fin).toBeUndefined();

    const guardados = screen.getByRole('region', { name: 'Visitantes guardados' });
    expect(await within(guardados).findByText('Doña Lupe')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Visitas avisadas' })).queryByText('Doña Lupe')).not.toBeInTheDocument();
  });

  it('si no se puede eliminar, avisa en vez de callar', async () => {
    m('deleteMisPreautorizacion').mockRejectedValue(new Error('Aviso no encontrado'));
    const avisadas = await abrir();
    fireEvent.click(within(avisadas).getAllByRole('button', { name: 'Eliminar' })[0]);
    const dialogo = await screen.findByRole('dialog', { name: '¿Eliminar la visita avisada de Taxi Don Beto?' });
    expect(within(dialogo).getByText(/La garita ya no la esperará/)).toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(m('deleteMisPreautorizacion')).toHaveBeenCalledWith('a1'));
    // La tarjeta se queda (el error va al canal de avisos de la app, ya no se calla).
    expect(within(avisadas).getByText('Taxi Don Beto')).toBeInTheDocument();
  });
});
