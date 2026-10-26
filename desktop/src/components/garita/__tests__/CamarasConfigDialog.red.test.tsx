import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CamarasConfigDialog } from '../CamarasConfigDialog';
import { api, type CamaraRed } from '../../../lib/tauri';

vi.mock('../../../lib/tauri', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lib/tauri')>()),
  api: { camaras: { eliminar: vi.fn(), descubrir: vi.fn(), probar: vi.fn(), guardar: vi.fn() } },
}));
const eliminar = api.camaras.eliminar as unknown as ReturnType<typeof vi.fn>;

const ip: CamaraRed = { id: 'a', tipo: 'ip', nombre: 'Carril de entrada', url: 'rtsp://192.168.1.50/live', device_id: null, tareas: ['placa', 'salida'], con_credenciales: true, creada_en: '2026-10-11T10:00:00Z' };
const celular: CamaraRed = { id: 'b', tipo: 'celular', nombre: 'Celular de Pedro', url: 'http://192.168.1.60:8080/video', device_id: null, tareas: [], con_credenciales: false, creada_en: '2026-10-11T10:01:00Z' };

const abrir = (extra: Partial<React.ComponentProps<typeof CamarasConfigDialog>> = {}) => {
  const props = { camaras: [], asignacion: {}, layout: 1 as const, onLayout: vi.fn(), onAsignar: vi.fn(), camarasRed: [ip, celular], onRecargarRed: vi.fn(), onCerrar: vi.fn(), onRefrescar: vi.fn(), ...extra };
  render(<CamarasConfigDialog {...props} />);
  return props;
};

// (con llaves: un `beforeEach` que devuelve una función la ejecuta al terminar la prueba)
beforeEach(() => { eliminar.mockReset(); });

describe('CamarasConfigDialog — cámaras IP y celulares (T8)', () => {
  it('las lista con su tipo y tareas, sin mostrar direcciones ni credenciales', () => {
    abrir();
    const sec = screen.getByRole('region', { name: 'Cámaras IP y celulares' });
    expect(within(sec).getByText('Carril de entrada')).toBeInTheDocument();
    expect(within(sec).getByText('Cámara IP · Placa, Salida')).toBeInTheDocument();
    expect(within(sec).getByText('Celular como cámara · sin tarea asignada')).toBeInTheDocument();
    expect(sec.textContent).not.toMatch(/rtsp:|192\.168|admin/);
  });

  it('el selector de cada tarea incluye las cámaras de red y avisa con red:<id>', () => {
    const { onAsignar } = abrir();
    const select = screen.getByLabelText('DPI del visitante') as HTMLSelectElement;
    expect(within(select).getByRole('option', { name: 'Celular de Pedro (celular)' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Carril de entrada (cámara IP)' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'red:b' } });
    expect(onAsignar).toHaveBeenCalledWith('dpi', 'red:b');
    // la tarea que ya tiene cámara de red la muestra seleccionada
    expect((screen.getByLabelText('Placa de entrada') as HTMLSelectElement).value).toBe('red:a');
  });

  it('quitar una cámara pide confirmación (sin window.confirm), la elimina y recarga la lista', async () => {
    eliminar.mockResolvedValue(true);
    const { onRecargarRed } = abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Celular de Pedro' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Quitar cámara' });
    expect(dialogo).toHaveTextContent('se borran su usuario y contraseña guardados');
    expect(eliminar).not.toHaveBeenCalled();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Quitar cámara' }));
    await waitFor(() => expect(eliminar).toHaveBeenCalledWith('b'));
    await waitFor(() => expect(onRecargarRed).toHaveBeenCalled());
  });

  it('cancelar no elimina nada', async () => {
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Carril de entrada' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Quitar cámara' });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(eliminar).not.toHaveBeenCalled();
  });

  it('con solo cámaras de red (sin webcam) ya no dice que no hay ninguna cámara', () => {
    abrir({ camaras: [], camarasRed: [ip] });
    expect(screen.queryByText(/No se detectó ninguna cámara/)).toBeNull();
    abrir({ camaras: [], camarasRed: [] });
    expect(screen.getAllByText(/No se detectó ninguna cámara/).length).toBeGreaterThan(0);
  });

  it('«Agregar cámara IP o celular» abre el formulario de alta y «Editar» el de edición', async () => {
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar cámara IP o celular' }));
    expect(await screen.findByRole('dialog', { name: 'Agregar cámara IP o celular' })).toBeInTheDocument();
  });

  it('un error al quitar se muestra con palabras claras', async () => {
    eliminar.mockRejectedValue({ codigo: 'db', mensaje: 'La base local no está abierta.' });
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Carril de entrada' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Quitar cámara' });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Quitar cámara' }));
    expect(await screen.findByText('La base local no está abierta.')).toBeInTheDocument();
  });
});
