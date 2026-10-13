import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActualizacionBanner } from '../ActualizacionBanner';
import { api } from '../../../lib/tauri';
import { INTERVALO_BUSQUEDA_MS, PRIMERA_BUSQUEDA_MS } from '../../../lib/actualizacion';

vi.mock('../../../lib/tauri', async () => {
  const real = await vi.importActual<typeof import('../../../lib/tauri')>('../../../lib/tauri');
  return { ...real, api: { actualizacion: { estado: vi.fn(), buscar: vi.fn(), instalar: vi.fn() } } };
});
const a = api.actualizacion as unknown as Record<string, ReturnType<typeof vi.fn>>;

const CONFIGURADA = { configurada: true, version_actual: '0.1.0', endpoint: 'https://github.com/chatio/SecureGate/releases/latest/download/latest.json' };
const NUEVA = { disponible: true, version: '0.2.0', notas: 'Mejoras', fecha: null };

/** Deja correr la promesa de `estado()` y avanza el reloj hasta la primera búsqueda. */
async function pasarPrimeraBusqueda() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(PRIMERA_BUSQUEDA_MS); });
}

/** Con el reloj simulado `findBy*`/`waitFor` no avanzan solos: se deja correr el tiempo (animación del diálogo, promesas) a mano. */
async function dejarCorrer(ms = 300) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.values(a).forEach(f => f.mockReset());
});
afterEach(() => { vi.useRealTimers(); });

describe('ActualizacionBanner', () => {
  it('sin llave pública en el instalador no busca nada ni muestra nada', async () => {
    a.estado.mockResolvedValue({ ...CONFIGURADA, configurada: false });
    const { container } = render(<ActualizacionBanner pendientes={0} capturaEnCurso={false} />);
    await pasarPrimeraBusqueda();
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVALO_BUSQUEDA_MS * 2); });
    expect(a.buscar).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('busca a los 30 s y luego cada 6 horas; si no hay nada nuevo no muestra nada', async () => {
    a.estado.mockResolvedValue(CONFIGURADA);
    a.buscar.mockResolvedValue({ disponible: false, version: null, notas: null, fecha: null });
    const { container } = render(<ActualizacionBanner pendientes={0} capturaEnCurso={false} />);
    await act(async () => { await Promise.resolve(); });
    expect(a.buscar).not.toHaveBeenCalled();                       // no al instante: el arranque va primero
    await act(async () => { await vi.advanceTimersByTimeAsync(PRIMERA_BUSQUEDA_MS - 1); });
    expect(a.buscar).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(a.buscar).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVALO_BUSQUEDA_MS); });
    expect(a.buscar).toHaveBeenCalledTimes(2);
    expect(container).toBeEmptyDOMElement();
  });

  it('una búsqueda sin red no molesta a la garita: no hay aviso y se reintenta más tarde', async () => {
    a.estado.mockResolvedValue(CONFIGURADA);
    a.buscar.mockRejectedValueOnce({ codigo: 'actualizador', mensaje: 'sin red' }).mockResolvedValue(NUEVA);
    render(<ActualizacionBanner pendientes={0} capturaEnCurso={false} />);
    await pasarPrimeraBusqueda();
    expect(screen.queryByText(/versión nueva/)).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVALO_BUSQUEDA_MS); });
    expect(screen.getByText(/versión nueva/)).toBeInTheDocument();
  });

  it('con una versión nueva y todo en orden ofrece «Actualizar ahora»; pide confirmación y pasa que no hay captura en curso', async () => {
    a.estado.mockResolvedValue(CONFIGURADA);
    a.buscar.mockResolvedValue(NUEVA);
    a.instalar.mockResolvedValue(undefined);
    render(<ActualizacionBanner pendientes={0} capturaEnCurso={false} />);
    await pasarPrimeraBusqueda();
    expect(screen.getByText('0.2.0')).toBeInTheDocument();
    const boton = screen.getByRole('button', { name: 'Actualizar ahora' });
    expect(boton).toBeEnabled();

    fireEvent.click(boton);
    await dejarCorrer();
    const confirmacion = screen.getByRole('dialog');
    expect(within(confirmacion).getByText('¿Actualizar a la versión 0.2.0?')).toBeInTheDocument();
    expect(a.instalar).not.toHaveBeenCalled();                      // nada se instala sin confirmar
    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Actualizar ahora' }));
    await dejarCorrer();
    expect(a.instalar).toHaveBeenCalledWith(false);
  });

  it('con accesos sin enviar el botón está bloqueado y dice por qué (y no se puede instalar)', async () => {
    a.estado.mockResolvedValue(CONFIGURADA);
    a.buscar.mockResolvedValue(NUEVA);
    render(<ActualizacionBanner pendientes={3} capturaEnCurso={false} />);
    await pasarPrimeraBusqueda();
    expect(screen.getByRole('button', { name: 'Actualizar ahora' })).toBeDisabled();
    expect(screen.getByText('Hay 3 accesos sin enviar al servidor. Podrás actualizar cuando se sincronicen.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar ahora' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(a.instalar).not.toHaveBeenCalled();
  });

  it('con una captura en curso también está bloqueado; al terminar se libera sin recargar', async () => {
    a.estado.mockResolvedValue(CONFIGURADA);
    a.buscar.mockResolvedValue(NUEVA);
    const { rerender } = render(<ActualizacionBanner pendientes={0} capturaEnCurso />);
    await pasarPrimeraBusqueda();
    expect(screen.getByRole('button', { name: 'Actualizar ahora' })).toBeDisabled();
    expect(screen.getByText('Termina la captura en curso para poder actualizar.')).toBeInTheDocument();
    rerender(<ActualizacionBanner pendientes={0} capturaEnCurso={false} />);
    expect(screen.getByRole('button', { name: 'Actualizar ahora' })).toBeEnabled();
  });

  it('si Rust rechaza la instalación (la cola se llenó mientras tanto) muestra su mensaje y la app sigue igual', async () => {
    a.estado.mockResolvedValue(CONFIGURADA);
    a.buscar.mockResolvedValue(NUEVA);
    a.instalar.mockRejectedValue({ codigo: 'accesos_pendientes', mensaje: 'Hay 1 acceso sin enviar al servidor. Espera a que se sincronicen.' });
    render(<ActualizacionBanner pendientes={0} capturaEnCurso={false} />);
    await pasarPrimeraBusqueda();
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar ahora' }));
    await dejarCorrer();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Actualizar ahora' }));
    await dejarCorrer();
    expect(screen.getByRole('alert')).toHaveTextContent('Hay 1 acceso sin enviar al servidor');
    expect(screen.getByRole('button', { name: 'Actualizar ahora' })).toBeEnabled();
  });

  it('cancelar la confirmación no instala nada', async () => {
    a.estado.mockResolvedValue(CONFIGURADA);
    a.buscar.mockResolvedValue(NUEVA);
    render(<ActualizacionBanner pendientes={0} capturaEnCurso={false} />);
    await pasarPrimeraBusqueda();
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar ahora' }));
    await dejarCorrer();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    await dejarCorrer(500);
    expect(a.instalar).not.toHaveBeenCalled();
  });
});
