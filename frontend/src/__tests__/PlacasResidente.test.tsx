/**
 * Sprint 10 (seguimiento del ANPR, tarea 3) — Placas autorizadas de una casa: lista, alta (formato guatemalteco, mensajes claros
 * del servidor) y baja con confirmación. Escribe en `/api/anpr/vehiculos`, la misma fuente que baja la garita.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PlacasResidente from '../components/PlacasResidente';
import * as api from '../services/api';

vi.mock('../services/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  getPlacasResidente: vi.fn(), agregarPlacaResidente: vi.fn(), quitarPlacaResidente: vi.fn(),
}));
const getPlacas = api.getPlacasResidente as unknown as ReturnType<typeof vi.fn>;
const agregar = api.agregarPlacaResidente as unknown as ReturnType<typeof vi.fn>;
const quitar = api.quitarPlacaResidente as unknown as ReturnType<typeof vi.fn>;

const RESIDENTE = { id: 'r1', numero_casa: '101', nombre: 'Juan Pérez' };
const vehiculo = (over: Partial<api.VehiculoResidente>): api.VehiculoResidente => ({
  id: 'v1', residente_id: 'r1', sucursal_id: 's1', placa: 'P123ABC', descripcion: 'Sedán gris', vigente_desde: '2026-10-01',
  vigente_hasta: null, activo: true, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getPlacas.mockResolvedValue([vehiculo({})]);
});

const lista = () => screen.getByRole('list', { name: 'Placas autorizadas' });

describe('PlacasResidente', () => {
  it('lista las placas autorizadas de la casa con su formato de presentación', async () => {
    render(<PlacasResidente residente={RESIDENTE} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Placas autorizadas — Casa 101');
    expect(await screen.findByText('P-123ABC')).toBeInTheDocument();
    expect(within(lista()).getByText(/Sedán gris · Desde/)).toBeInTheDocument();
    expect(getPlacas).toHaveBeenCalledWith('r1');
  });

  it('alta: valida el formato guatemalteco antes de enviar y agrega la placa normalizada', async () => {
    agregar.mockResolvedValue(vehiculo({ id: 'v2', placa: 'P777RES', descripcion: 'Pickup' }));
    render(<PlacasResidente residente={RESIDENTE} onClose={() => {}} />);
    await screen.findByText('P-123ABC');

    fireEvent.change(screen.getByLabelText(/^Placa\W*$/), { target: { value: 'ABC1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar placa' }));
    expect(screen.getByRole('alert')).toHaveTextContent('La placa debe tener el formato guatemalteco, por ejemplo P-123ABC.');
    expect(agregar).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^Placa\W*$/), { target: { value: 'p 777res' } });
    fireEvent.change(screen.getByLabelText('Descripción (opcional)'), { target: { value: ' Pickup ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar placa' }));
    await waitFor(() => expect(agregar).toHaveBeenCalledWith({ residente_id: 'r1', placa: 'P777RES', descripcion: 'Pickup' }));
    expect(await within(lista()).findByText('P-777RES')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Placa\W*$/)).toHaveValue('');
  });

  it('alta: el rechazo del servidor (placa de otra casa) se muestra tal cual', async () => {
    agregar.mockRejectedValue(new Error('La placa P-123ABC ya está autorizada para la casa 205 de esta sucursal. Dala de baja allí antes de asignarla a otra casa.'));
    render(<PlacasResidente residente={RESIDENTE} onClose={() => {}} />);
    await screen.findByText('P-123ABC');
    fireEvent.change(screen.getByLabelText(/^Placa\W*$/), { target: { value: 'P123ABC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar placa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ya está autorizada para la casa 205');
  });

  it('baja: pide confirmación en la misma fila; cancelar no quita nada; confirmar la quita', async () => {
    quitar.mockResolvedValue(undefined);
    render(<PlacasResidente residente={RESIDENTE} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar la placa P-123ABC' }));
    const grupo = screen.getByRole('group', { name: '¿Quitar P-123ABC?' });
    fireEvent.click(within(grupo).getByRole('button', { name: 'Cancelar' }));
    expect(quitar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Quitar la placa P-123ABC' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, quitar' }));
    await waitFor(() => expect(quitar).toHaveBeenCalledWith('v1'));
    expect(await screen.findByText('Esta casa aún no tiene placas autorizadas.')).toBeInTheDocument();
  });

  it('sin placas muestra el estado vacío; si falla la carga lo dice', async () => {
    getPlacas.mockResolvedValueOnce([]);
    const { rerender } = render(<PlacasResidente residente={RESIDENTE} onClose={() => {}} />);
    expect(await screen.findByText('Esta casa aún no tiene placas autorizadas.')).toBeInTheDocument();
    getPlacas.mockRejectedValueOnce(new Error('caído'));
    rerender(<PlacasResidente residente={{ ...RESIDENTE, id: 'r2', numero_casa: '102' }} onClose={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las placas de esta casa.');
  });
});
