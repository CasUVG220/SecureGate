/**
 * Sprint 10 (seguimiento del ANPR) — «Entradas»: los accesos por placas aparecen con su etiqueta («Automático (placas)»,
 * «Verificado por agente»), su confianza y la miniatura de la evidencia; se filtran por método y se buscan por placa; estado vacío
 * y paginación.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import EntradasPage from '../pages/EntradasPage';
import * as api from '../services/api';

vi.mock('../services/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  getEntradas: vi.fn(), getEvidenciaAnpr: vi.fn(),
}));
const getEntradas = api.getEntradas as unknown as ReturnType<typeof vi.fn>;
const getEvidencia = api.getEvidenciaAnpr as unknown as ReturnType<typeof vi.fn>;

const fila = (over: Partial<api.EntradaAcceso>): api.EntradaAcceso => ({
  id: crypto.randomUUID(), timestamp_entrada: '2026-10-27T15:30:00.000Z', timestamp_salida: null, autorizado: true, origen: 'web',
  metodo: 'clic', es_residente: false, visitante_nombre: 'Luis Visita', numero_dpi: '2999000010101', numero_casa: 'A-12',
  residente_nombre: 'Ana Residente', placa: 'P123ABC', confianza: null, verificado: false, verificado_por_nombre: null,
  sucursal_id: 's1', sucursal_nombre: 'Condominio Norte', id_cliente: null, evidencia_placa: false, evidencia_vehiculo: false, ...over,
});

const ANPR = fila({ metodo: 'anpr', origen: 'anpr', es_residente: true, visitante_nombre: null, numero_dpi: null, placa: 'P333ANP', confianza: 0.9634, id_cliente: 'idc-1', evidencia_placa: true });
const VERIFICADO = fila({ metodo: 'anpr', origen: 'anpr', es_residente: true, visitante_nombre: null, placa: 'P444VER', confianza: 0.91, verificado: true, verificado_por_nombre: 'Agente Ruiz' });
const MANUAL = fila({ metodo: 'manual', placa: 'C111MAN', timestamp_salida: '2026-10-27T17:00:00.000Z' });

beforeEach(() => {
  vi.clearAllMocks();
  getEntradas.mockResolvedValue({ accesos: [ANPR, VERIFICADO, MANUAL], total: 3, pagina: 1, por_pagina: 25 });
  getEvidencia.mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }));
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:evidencia-1'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { vi.useRealTimers(); });

const filaDe = (placa: string) => {
  const f = screen.queryAllByRole('row').find(r => within(r).queryByText(placa));
  if (!f) throw new Error(`sin fila con ${placa}`);
  return f;
};

describe('EntradasPage', () => {
  it('las entradas por placas se ven con su etiqueta, la del agente, la confianza y la miniatura de la evidencia', async () => {
    render(<EntradasPage />);
    const anpr = await waitFor(() => filaDe('P-333ANP'));
    expect(within(anpr).getByText('Automático (placas)')).toBeInTheDocument();
    expect(within(anpr).getByText('Ana Residente')).toBeInTheDocument();
    expect(within(anpr).getByText(/Residente · Casa A-12/)).toBeInTheDocument();
    expect(within(anpr).getByText('96 %')).toBeInTheDocument();
    const img = await within(anpr).findByRole('img', { name: 'Foto de la placa P-333ANP' });
    expect(img).toHaveAttribute('src', 'blob:evidencia-1');
    expect(getEvidencia).toHaveBeenCalledWith('idc-1', 'placa');

    const ver = filaDe('P-444VER');
    expect(within(ver).getByText('Verificado por agente')).toHaveAttribute('title', 'Confirmó: Agente Ruiz');
    expect(getEvidencia).toHaveBeenCalledTimes(1); // sin evidencia no se pide nada

    const manual = filaDe('C-111MAN');
    expect(within(manual).getByText('Manual')).toBeInTheDocument();
    expect(within(manual).queryByText('Automático (placas)')).toBeNull();
    expect(within(manual).getByText('Luis Visita')).toBeInTheDocument();
    // La tabla tiene su título para lectores de pantalla.
    expect(screen.getByRole('table')).toHaveAccessibleName('Entradas');
  });

  it('filtra por método y busca por placa (tras dejar de escribir); limpiar vuelve a todo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<EntradasPage />);
    await waitFor(() => expect(getEntradas).toHaveBeenCalledWith(expect.objectContaining({ pagina: 1, por_pagina: 25, metodo: undefined })));

    fireEvent.change(screen.getByLabelText('Método'), { target: { value: 'anpr' } });
    await waitFor(() => expect(getEntradas).toHaveBeenLastCalledWith(expect.objectContaining({ metodo: 'anpr', pagina: 1 })));
    expect(screen.getByRole('option', { name: 'Automático (placas)' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Placa'), { target: { value: 'p-333' } });
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(getEntradas).toHaveBeenLastCalledWith(expect.objectContaining({ metodo: 'anpr', placa: 'p333' })));

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(getEntradas).toHaveBeenLastCalledWith(expect.objectContaining({ metodo: undefined, placa: undefined })));
  });

  it('estado vacío: sin filtros invita; con filtros dice que nada coincide', async () => {
    getEntradas.mockResolvedValue({ accesos: [], total: 0, pagina: 1, por_pagina: 25 });
    render(<EntradasPage />);
    expect(await screen.findByText('Sin entradas')).toBeInTheDocument();
    expect(screen.getByText('Aquí aparecerá cada entrada registrada en la garita.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Método'), { target: { value: 'qr' } });
    expect(await screen.findByText('Ninguna entrada coincide con los filtros.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Sin resultados');
  });

  it('paginación: rango, siguiente y anterior', async () => {
    getEntradas.mockResolvedValue({ accesos: [MANUAL], total: 60, pagina: 1, por_pagina: 25 });
    render(<EntradasPage />);
    expect(await screen.findByText('1–25 de 60')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(getEntradas).toHaveBeenLastCalledWith(expect.objectContaining({ pagina: 2 })));
    expect(await screen.findByText('26–50 de 60')).toBeInTheDocument();
  });

  it('el administrador de empresa y el owner ven la sucursal; si falla la carga lo dice', async () => {
    render(<EntradasPage mostrarSucursal />);
    expect(await screen.findAllByText('Condominio Norte')).not.toHaveLength(0);
    getEntradas.mockRejectedValue(new Error('caído'));
    fireEvent.change(screen.getByLabelText('Método'), { target: { value: 'manual' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las entradas');
  });
});
