/**
 * SCRUM-114 / H10 — «Avisar de una visita»: un solo formulario para el administrador y el residente,
 * con fechas obligatorias (empiezan en hoy), la placa a la vista y sin avisos repetidos.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AvisarVisitaModal from '../components/AvisarVisitaModal';
import PreautPage from '../pages/PreautPage';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  createPreautorizacion: vi.fn(), createMisPreautorizacion: vi.fn(),
  getPreautorizaciones: vi.fn(), deletePreautorizacion: vi.fn(), getResidentes: vi.fn(),
}));

const m = <K extends keyof typeof api>(k: K) => api[k] as unknown as ReturnType<typeof vi.fn>;

/** Día de Guatemala (UTC-6, sin horario de verano) desplazado `n` días. */
const dia = (n: number) => new Date(Date.now() - 6 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);

const RESIDENTES = [
  { id: 'r1', numero_casa: 'A-12', nombre: 'Ana Gómez', email: 'a@x.com', estado_pago: 'al_dia', saldo_pendiente: '0' },
  { id: 'r2', numero_casa: 'B-03', nombre: 'Luis Pérez', email: 'l@x.com', estado_pago: 'al_dia', saldo_pendiente: '0' },
] as api.Residente[];

const aviso = (over: Partial<api.Preautorizacion>): api.Preautorizacion => ({
  id: 'p', residente_id: 'r1', nombre_visitante: 'Visita', numero_dpi: null, placa: null,
  fecha_inicio: dia(0), fecha_fin: dia(0), activo: true, created_at: '2026-01-01', numero_casa: 'A-12', residente_nombre: 'Ana Gómez',
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); m('getResidentes').mockResolvedValue(RESIDENTES); });

describe('AvisarVisitaModal — residente', () => {
  it('las dos fechas empiezan en hoy y mandar el aviso no pide más que nombre y DPI o placa', async () => {
    m('createMisPreautorizacion').mockResolvedValue({ id: 'n1' });
    const onCreada = vi.fn(); const onClose = vi.fn();
    render(<AvisarVisitaModal open onClose={onClose} onCreada={onCreada} />);
    const d = await screen.findByRole('dialog', { name: 'Avisar de una visita' });
    expect(within(d).getByLabelText(/Desde/)).toHaveValue(dia(0));
    expect(within(d).getByLabelText(/Hasta/)).toHaveValue(dia(0));
    expect(within(d).queryByLabelText(/Casa y residente/)).not.toBeInTheDocument();

    fireEvent.change(within(d).getByLabelText(/Nombre del visitante/), { target: { value: '  Juan Pérez ' } });
    fireEvent.change(within(d).getByLabelText('Placa'), { target: { value: 'p123abc' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Avisar' }));

    await waitFor(() => expect(m('createMisPreautorizacion')).toHaveBeenCalledWith({
      nombre_visitante: 'Juan Pérez', numero_dpi: undefined, placa: 'P123ABC', fecha_inicio: dia(0), fecha_fin: dia(0),
    }));
    expect(onCreada).toHaveBeenCalledWith({ id: 'n1' });
    expect(onClose).toHaveBeenCalled();
  });

  it('«Hasta» sigue a «Desde» hasta que se toca, y nunca queda antes', async () => {
    render(<AvisarVisitaModal open onClose={vi.fn()} onCreada={vi.fn()} />);
    const d = await screen.findByRole('dialog', { name: 'Avisar de una visita' });
    const desde = within(d).getByLabelText(/Desde/) as HTMLInputElement;
    const hasta = within(d).getByLabelText(/Hasta/) as HTMLInputElement;

    fireEvent.change(desde, { target: { value: dia(3) } });
    expect(hasta.value).toBe(dia(3));                      // sigue a «Desde»

    fireEvent.change(hasta, { target: { value: dia(5) } }); // ahora «Hasta» es propia
    fireEvent.change(desde, { target: { value: dia(4) } });
    expect(hasta.value).toBe(dia(5));                      // se respeta

    fireEvent.change(desde, { target: { value: dia(7) } }); // «Desde» pasa de «Hasta»: lo arrastra
    expect(hasta.value).toBe(dia(7));
  });

  it('sin DPI ni placa explica qué falta y no llama al servidor; con fechas invertidas igual', async () => {
    render(<AvisarVisitaModal open onClose={vi.fn()} onCreada={vi.fn()} />);
    const d = await screen.findByRole('dialog', { name: 'Avisar de una visita' });
    fireEvent.change(within(d).getByLabelText(/Nombre del visitante/), { target: { value: 'Juan' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Avisar' }));
    expect(await within(d).findByText('Escribe el DPI o la placa del visitante.')).toBeInTheDocument();

    fireEvent.change(within(d).getByLabelText('DPI'), { target: { value: '1234567890101' } });
    fireEvent.change(within(d).getByLabelText(/Hasta/), { target: { value: dia(-1) } });
    fireEvent.click(within(d).getByRole('button', { name: 'Avisar' }));
    expect(await within(d).findByText(/no puede ser anterior/)).toBeInTheDocument();
    expect(m('createMisPreautorizacion')).not.toHaveBeenCalled();
  });

  it('un aviso repetido (409) muestra el mensaje del servidor y deja el formulario abierto', async () => {
    m('createMisPreautorizacion').mockRejectedValue(new Error('Esa visita ya está avisada para esas fechas'));
    const onClose = vi.fn();
    render(<AvisarVisitaModal open onClose={onClose} onCreada={vi.fn()} />);
    const d = await screen.findByRole('dialog', { name: 'Avisar de una visita' });
    fireEvent.change(within(d).getByLabelText(/Nombre del visitante/), { target: { value: 'Juan' } });
    fireEvent.change(within(d).getByLabelText('DPI'), { target: { value: '1234567890101' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Avisar' }));
    expect(await within(d).findByText('Esa visita ya está avisada para esas fechas')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('con datos de partida (un visitante guardado) los trae puestos y la placa con guion', async () => {
    render(<AvisarVisitaModal open onClose={vi.fn()} onCreada={vi.fn()} inicial={{ nombre_visitante: 'Taxi Don Beto', numero_dpi: null, placa: 'P123ABC' }} />);
    const d = await screen.findByRole('dialog', { name: 'Avisar de una visita' });
    expect(within(d).getByLabelText(/Nombre del visitante/)).toHaveValue('Taxi Don Beto');
    expect(within(d).getByLabelText('Placa')).toHaveValue('P-123ABC');
    expect(within(d).getByLabelText('DPI')).toHaveValue('');
  });
});

describe('AvisarVisitaModal — administrador', () => {
  it('pide elegir la casa y manda residente_id', async () => {
    m('createPreautorizacion').mockResolvedValue({ id: 'n2' });
    render(<AvisarVisitaModal open onClose={vi.fn()} onCreada={vi.fn()} residentes={RESIDENTES} />);
    const d = await screen.findByRole('dialog', { name: 'Avisar de una visita' });
    fireEvent.change(within(d).getByLabelText(/Nombre del visitante/), { target: { value: 'Juan' } });
    fireEvent.change(within(d).getByLabelText('DPI'), { target: { value: '1234567890101' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Avisar' }));
    expect(await within(d).findByText('Selecciona al residente al que visitan.')).toBeInTheDocument();
    expect(m('createPreautorizacion')).not.toHaveBeenCalled();

    fireEvent.change(within(d).getByLabelText(/Casa y residente/), { target: { value: 'r2' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Avisar' }));
    await waitFor(() => expect(m('createPreautorizacion')).toHaveBeenCalledWith(expect.objectContaining({
      residente_id: 'r2', nombre_visitante: 'Juan', numero_dpi: '1234567890101', fecha_inicio: dia(0), fecha_fin: dia(0),
    })));
    expect(m('createMisPreautorizacion')).not.toHaveBeenCalled();
  });
});

describe('PreautPage — visitas avisadas', () => {
  const FILAS = [
    aviso({ id: 'hoy', nombre_visitante: 'Taxi Don Beto', placa: 'P123ABC', numero_dpi: null, fecha_inicio: dia(0), fecha_fin: dia(1) }),
    aviso({ id: 'prox', nombre_visitante: 'Primo Pérez', numero_dpi: '9876543210101', fecha_inicio: dia(4), fecha_fin: dia(6), numero_casa: 'B-03', residente_nombre: 'Luis Pérez' }),
    aviso({ id: 'vieja', nombre_visitante: 'Plomero', fecha_inicio: dia(-9), fecha_fin: dia(-8) }),
    aviso({ id: 'guardado', nombre_visitante: 'Contacto guardado', fecha_inicio: dia(-30), fecha_fin: null }),
  ];

  it('muestra la placa en su propia columna y las fechas como rango, sin los guardados ni las vencidas', async () => {
    m('getPreautorizaciones').mockResolvedValue(FILAS);
    render(<PreautPage />);
    await screen.findByText('Taxi Don Beto');
    expect(screen.getAllByRole('columnheader').map(c => c.textContent)).toEqual(
      expect.arrayContaining(['Casa', 'Visitante', 'DPI', 'Placa', 'Fechas']),
    );
    expect(screen.getByText('P-123ABC')).toBeInTheDocument();           // placa con presentación estándar
    expect(screen.getByText('Primo Pérez')).toBeInTheDocument();
    expect(screen.getByText('Hoy')).toBeInTheDocument();
    expect(screen.getByText('Próxima')).toBeInTheDocument();
    expect(screen.queryByText('Contacto guardado')).not.toBeInTheDocument();   // libreta del residente: no autoriza nada
    expect(screen.queryByText('Plomero')).not.toBeInTheDocument();             // vencida
  });

  it('las vencidas se piden aparte', async () => {
    m('getPreautorizaciones').mockResolvedValue(FILAS);
    render(<PreautPage />);
    await screen.findByText('Taxi Don Beto');
    fireEvent.click(screen.getByRole('button', { name: 'Ver también las vencidas (1)' }));
    expect(screen.getByText('Plomero')).toBeInTheDocument();
    expect(screen.getByText('Vencida')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar las vencidas' }));
    expect(screen.queryByText('Plomero')).not.toBeInTheDocument();
  });

  it('sin avisos da el siguiente paso, y «Avisar otra vez» abre el formulario con los datos de la fila', async () => {
    m('getPreautorizaciones').mockResolvedValue([]);
    const { unmount } = render(<PreautPage />);
    expect(await screen.findByText('No hay visitas avisadas.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Avisar de una visita' }).length).toBeGreaterThan(0);
    unmount();

    m('getPreautorizaciones').mockResolvedValue(FILAS);
    render(<PreautPage />);
    await screen.findByText('Taxi Don Beto');
    fireEvent.click(screen.getAllByRole('button', { name: 'Avisar otra vez' })[0]);
    const d = await screen.findByRole('dialog', { name: 'Avisar de una visita' });
    expect(within(d).getByLabelText(/Nombre del visitante/)).toHaveValue('Taxi Don Beto');
    expect(within(d).getByLabelText('Placa')).toHaveValue('P-123ABC');
    expect(within(d).getByLabelText(/Casa y residente/)).toHaveValue('r1');
  });

  it('crear un aviso recarga la lista', async () => {
    m('getPreautorizaciones').mockResolvedValue([]);
    m('createPreautorizacion').mockResolvedValue({ id: 'nuevo' });
    render(<PreautPage />);
    await screen.findByText('No hay visitas avisadas.');
    // Vacía: el único botón es el del estado vacío (el de arriba no se repite).
    expect(screen.getAllByRole('button', { name: 'Avisar de una visita' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Avisar de una visita' }));
    const d = await screen.findByRole('dialog', { name: 'Avisar de una visita' });
    fireEvent.change(within(d).getByLabelText(/Casa y residente/), { target: { value: 'r1' } });
    fireEvent.change(within(d).getByLabelText(/Nombre del visitante/), { target: { value: 'Juan' } });
    fireEvent.change(within(d).getByLabelText('DPI'), { target: { value: '1234567890101' } });
    m('getPreautorizaciones').mockResolvedValue([aviso({ id: 'nuevo', nombre_visitante: 'Juan', numero_dpi: '1234567890101' })]);
    fireEvent.click(within(d).getByRole('button', { name: 'Avisar' }));
    expect(await screen.findByText('Juan')).toBeInTheDocument();
  });
});
