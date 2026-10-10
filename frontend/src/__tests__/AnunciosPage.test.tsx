/**
 * «Publicar» un anuncio (SCRUM-112 / H07): aviso previo de quién lo verá y confirmación
 * persistente que lleva al anuncio recién publicado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AnunciosPage from '../pages/AnunciosPage';
import { ToastProvider } from '../components/ui';
import { getAnuncios, createAnuncio, updateAnuncio } from '../services/api';

vi.mock('../services/api', () => ({
  getAnuncios: vi.fn(), createAnuncio: vi.fn(), updateAnuncio: vi.fn(), deleteAnuncio: vi.fn(),
  decodeTokenPayload: () => ({ sucursal_id: 's1' }),
}));
const mockList = getAnuncios as unknown as ReturnType<typeof vi.fn>;
const mockCreate = createAnuncio as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = updateAnuncio as unknown as ReturnType<typeof vi.fn>;

const anuncio = (over: Record<string, unknown> = {}) => ({
  id: 'a1', sucursal_id: 's1', titulo: 'Corte de agua', contenido: 'Mañana de 9 a 12', prioridad: 'normal',
  vigente_desde: '2026-10-01T00:00:00Z', vigente_hasta: null, creado_por: 'u1', created_at: '2026-10-01T00:00:00Z',
  sucursal_nombre: 'Principal', creado_por_nombre: 'Admin', total_lecturas: 3, ...over,
});

const abrirNuevo = async () => {
  fireEvent.click((await screen.findAllByRole('button', { name: '+ Nuevo anuncio' }))[0]);
  return screen.findByRole('dialog', { name: 'Nuevo anuncio' });
};

beforeEach(() => {
  mockList.mockReset().mockResolvedValue([anuncio()]);
  mockCreate.mockReset();
  mockUpdate.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.setItem('token', 'x');
});
afterEach(() => { vi.useRealTimers(); });

const render_ = () => render(<ToastProvider><AnunciosPage /></ToastProvider>);

describe('AnunciosPage — publicar', () => {
  it('antes de publicar dice quién lo verá, y el botón se llama «Publicar anuncio»', async () => {
    render_();
    const dialogo = await abrirNuevo();
    expect(within(dialogo).getByRole('note')).toHaveTextContent('Quién lo verá');
    expect(within(dialogo).getByRole('note')).toHaveTextContent('todos los residentes de tu sucursal lo verán de inmediato');
    expect(within(dialogo).getByRole('note')).toHaveTextContent('No tiene fecha de fin');
    expect(within(dialogo).getByRole('button', { name: 'Publicar anuncio' })).toBeInTheDocument();
    expect(within(dialogo).queryByRole('button', { name: 'Guardar' })).toBeNull();
  });

  it('el aviso cambia con las fechas y con la prioridad urgente', async () => {
    render_();
    const dialogo = await abrirNuevo();
    fireEvent.change(within(dialogo).getByLabelText(/Vigente hasta|Hasta/), { target: { value: '2099-12-31' } });
    expect(within(dialogo).getByRole('note')).toHaveTextContent('dejará de mostrarse el 31 dic 2099');
    fireEvent.change(within(dialogo).getByLabelText(/Vigente desde|Desde/), { target: { value: '2099-01-05' } });
    expect(within(dialogo).getByRole('note')).toHaveTextContent('a partir del');
    fireEvent.click(within(dialogo).getByRole('radio', { name: 'Urgente' }));
    expect(within(dialogo).getByRole('note')).toHaveTextContent('Es urgente');
  });

  it('el botón de publicar queda fijo en el pie del diálogo, fuera del área que se desplaza', async () => {
    render_();
    const dialogo = await abrirNuevo();
    const boton = within(dialogo).getByRole('button', { name: 'Publicar anuncio' });
    const area = dialogo.querySelector('.overflow-y-auto');
    expect(area).not.toBeNull();
    expect(area!.contains(boton)).toBe(false);        // el contenido se desplaza, el pie no
  });

  it('al publicar: confirmación que NO se cierra sola y que, con «Ver anuncio», resalta la fila nueva', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const nuevo = anuncio({ id: 'nuevo-1', titulo: 'Asamblea del sábado' });
    mockCreate.mockResolvedValue(nuevo);
    render_();
    const dialogo = await abrirNuevo();
    fireEvent.change(within(dialogo).getByLabelText(/Título/), { target: { value: 'Asamblea del sábado' } });
    fireEvent.change(within(dialogo).getByLabelText(/Contenido/), { target: { value: 'A las 10 am en el salón' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Publicar anuncio' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ titulo: 'Asamblea del sábado', sucursal_id: 's1' })));
    expect(await screen.findByText('Anuncio publicado: ya lo ven los residentes')).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });      // sigue ahí a los 30 s
    expect(screen.getByText('Anuncio publicado: ya lo ven los residentes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ver anuncio' }));
    const fila = document.querySelector('[data-row-key="nuevo-1"]') as HTMLElement;
    expect(fila).not.toBeNull();
    expect(fila.className).toMatch(/ring-success/);
    expect(screen.queryByText('Anuncio publicado: ya lo ven los residentes')).toBeNull();   // la acción cierra el aviso
  });

  it('un error al publicar se queda a la vista dentro del formulario', async () => {
    mockCreate.mockRejectedValue(new Error('Contenido no permitido'));
    render_();
    const dialogo = await abrirNuevo();
    fireEvent.change(within(dialogo).getByLabelText(/Título/), { target: { value: 'X' } });
    fireEvent.change(within(dialogo).getByLabelText(/Contenido/), { target: { value: 'Y' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Publicar anuncio' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Contenido no permitido');
  });

  it('al EDITAR el botón sigue siendo «Guardar» y el aviso habla de cambios inmediatos', async () => {
    mockUpdate.mockResolvedValue(anuncio({ titulo: 'Corte de agua (actualizado)' }));
    render_();
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
    expect(within(dialogo).getByRole('note')).toHaveTextContent('Los cambios se ven de inmediato');
  });
});
