import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AgentesPage from '../pages/AgentesPage';
import { getUsuarios, updateUsuario, desactivarUsuario, createUsuario, restablecerDosPasos } from '../services/api';

vi.mock('../services/api', () => ({
  getUsuarios: vi.fn(),
  createUsuario: vi.fn(),
  updateUsuario: vi.fn(),
  desactivarUsuario: vi.fn(),
  restablecerDosPasos: vi.fn(),
  // Token de pruebas: el usuario con sesión es «yo-1».
  decodeTokenPayload: () => ({ id: 'yo-1', rol: 'admin_sucursal' }),
}));

const mockGet = getUsuarios as unknown as ReturnType<typeof vi.fn>;
const mockPut = updateUsuario as unknown as ReturnType<typeof vi.fn>;
const mockBaja = desactivarUsuario as unknown as ReturnType<typeof vi.fn>;
const mockCreate = createUsuario as unknown as ReturnType<typeof vi.fn>;
const mockRestablecer = restablecerDosPasos as unknown as ReturnType<typeof vi.fn>;

const usuario = (over: Record<string, unknown> = {}) => ({
  id: 'u1', nombre: 'Luis Guardia', email: 'luis@garita.com', rol: 'agente',
  sucursal_id: 's1', empresa_id: null, sucursal_nombre: 'Principal', activo: true, created_at: '2026-10-01T00:00:00Z',
  ...over,
});

const abrirMenu = async (nombre: string) => {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Acciones de ${nombre}`) }));
};

describe('AgentesPage — editar y dar de baja', () => {
  beforeEach(() => {
    mockGet.mockReset(); mockPut.mockReset(); mockBaja.mockReset(); mockCreate.mockReset();
    localStorage.setItem('token', 'x');
    mockGet.mockResolvedValue([
      usuario(),
      usuario({ id: 'yo-1', nombre: 'Yo Mismo', email: 'yo@garita.com', rol: 'admin_sucursal' }),
      usuario({ id: 'u3', nombre: 'Baja Vieja', email: 'vieja@garita.com', activo: false }),
    ]);
  });

  it('muestra la columna de acciones «···» solo en filas activas y que no son la propia', async () => {
    render(<AgentesPage />);
    await screen.findByText('Luis Guardia');
    expect(screen.getByRole('columnheader', { name: 'Acciones' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acciones de Luis Guardia' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Acciones de Yo Mismo/ })).toBeNull();     // no te editas a ti
    expect(screen.queryByRole('button', { name: /Acciones de Baja Vieja/ })).toBeNull();   // ya está de baja
    expect(screen.getByText('De baja')).toBeInTheDocument();
  });

  it('el menú ofrece Editar y Dar de baja, con la baja separada como acción de peligro', async () => {
    render(<AgentesPage />);
    await abrirMenu('Luis Guardia');
    const items = screen.getAllByRole('menuitem').map(i => i.textContent);
    expect(items).toEqual(['Editar', 'Dar de baja']);
  });

  it('Editar abre el Modal con los datos, y guarda SOLO lo que cambió', async () => {
    mockPut.mockResolvedValue(usuario({ nombre: 'Luis G. Pérez' }));
    render(<AgentesPage />);
    await abrirMenu('Luis Guardia');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar' }));

    const dialogo = await screen.findByRole('dialog', { name: 'Editar personal' });
    const nombre = within(dialogo).getByLabelText(/^Nombre/) as HTMLInputElement;
    expect(nombre.value).toBe('Luis Guardia');
    expect((within(dialogo).getByLabelText(/^Correo|^Email/) as HTMLInputElement).value).toBe('luis@garita.com');

    fireEvent.change(nombre, { target: { value: 'Luis G. Pérez' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('u1', { nombre: 'Luis G. Pérez' }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2)); // recarga la lista
  });

  it('cambia el rol y manda la contraseña nueva solo si se escribió', async () => {
    mockPut.mockResolvedValue(usuario({ rol: 'admin_sucursal' }));
    render(<AgentesPage />);
    await abrirMenu('Luis Guardia');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar' }));
    const dialogo = await screen.findByRole('dialog');

    fireEvent.change(within(dialogo).getByLabelText('Rol'), { target: { value: 'admin_sucursal' } });
    fireEvent.change(within(dialogo).getByLabelText('Contraseña nueva'), { target: { value: 'ClaveNueva#2026' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('u1', { rol: 'admin_sucursal', password: 'ClaveNueva#2026' }));
  });

  it('sin cambios no llama a la API y cierra el diálogo', async () => {
    render(<AgentesPage />);
    await abrirMenu('Luis Guardia');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar' }));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('un error de la API se muestra dentro del diálogo y no lo cierra', async () => {
    mockPut.mockRejectedValue(new Error('El email ya está registrado'));
    render(<AgentesPage />);
    await abrirMenu('Luis Guardia');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar' }));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.change(within(dialogo).getByLabelText(/^Correo|^Email/), { target: { value: 'otro@garita.com' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('El email ya está registrado');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Dar de baja pide confirmación en un Modal (no en window.confirm) y llama a la API', async () => {
    const confirmar = vi.spyOn(window, 'confirm');
    mockBaja.mockResolvedValue(undefined);
    render(<AgentesPage />);
    await abrirMenu('Luis Guardia');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dar de baja' }));

    const dialogo = await screen.findByRole('dialog', { name: 'Dar de baja a esta persona' });
    expect(dialogo).toHaveTextContent('Luis Guardia');
    expect(mockBaja).not.toHaveBeenCalled();

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Dar de baja' }));
    await waitFor(() => expect(mockBaja).toHaveBeenCalledWith('u1'));
    expect(confirmar).not.toHaveBeenCalled();
  });

  it('cancelar la baja no hace nada', async () => {
    render(<AgentesPage />);
    await abrirMenu('Luis Guardia');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dar de baja' }));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockBaja).not.toHaveBeenCalled();
  });

  it('el alta de agente tiene botón de mostrar contraseña y requisitos visibles', async () => {
    render(<AgentesPage />);
    await screen.findByText('Luis Guardia');
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo agente' }));
    expect(screen.getByText('Al menos 8 caracteres')).toBeInTheDocument();
    const campo = screen.getByLabelText(/^Contraseña/) as HTMLInputElement;
    expect(campo.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(campo.type).toBe('text');
  });

  // ── Verificación en dos pasos (SCRUM-123) ─────────────────────────────────────────────────────
  describe('verificación en dos pasos de otra persona', () => {
    beforeEach(() => {
      mockRestablecer.mockReset();
      mockGet.mockResolvedValue([
        usuario({ id: 'u1', nombre: 'Marta Admin', email: 'marta@garita.com', rol: 'admin_sucursal', dos_pasos: true }),
        usuario({ id: 'u2', nombre: 'Luis Guardia', dos_pasos: false }),
      ]);
    });

    it('marca en la lista a quien la tiene activada y solo a esa persona', async () => {
      render(<AgentesPage />);
      await screen.findByText('Marta Admin');
      expect(screen.getAllByText('Con verificación en dos pasos')).toHaveLength(1);
      expect(screen.getByText('marta@garita.com').closest('td')).toHaveTextContent('Con verificación en dos pasos');
    });

    it('el menú ofrece «Restablecer verificación en dos pasos» solo a quien la tiene', async () => {
      render(<AgentesPage />);
      await abrirMenu('Marta Admin');
      expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Editar', 'Restablecer verificación en dos pasos', 'Dar de baja']);
      fireEvent.keyDown(document, { key: 'Escape' });
      await abrirMenu('Luis Guardia');
      expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Editar', 'Dar de baja']);
    });

    it('pide confirmación explicando qué pasa y, al confirmar, restablece y recarga la lista', async () => {
      mockRestablecer.mockResolvedValue(undefined);
      render(<AgentesPage />);
      await abrirMenu('Marta Admin');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Restablecer verificación en dos pasos' }));

      const dialogo = await screen.findByRole('dialog', { name: '¿Restablecer la verificación en dos pasos de Marta Admin?' });
      expect(dialogo).toHaveTextContent('se cierran sus sesiones abiertas');
      expect(mockRestablecer).not.toHaveBeenCalled();

      fireEvent.click(within(dialogo).getByRole('button', { name: 'Restablecer' }));
      await waitFor(() => expect(mockRestablecer).toHaveBeenCalledWith('u1'));
      await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));          // recarga la lista
    });

    it('cancelar no restablece nada', async () => {
      render(<AgentesPage />);
      await abrirMenu('Marta Admin');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Restablecer verificación en dos pasos' }));
      const dialogo = await screen.findByRole('dialog');
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(mockRestablecer).not.toHaveBeenCalled();
    });

    it('si el servidor lo rechaza, muestra el motivo en la página', async () => {
      mockRestablecer.mockRejectedValue(new Error('Usuario no encontrado o sin acceso'));
      render(<AgentesPage />);
      await abrirMenu('Marta Admin');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Restablecer verificación en dos pasos' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Restablecer' }));
      expect(await screen.findByText('Usuario no encontrado o sin acceso')).toBeInTheDocument();
    });
  });
});
