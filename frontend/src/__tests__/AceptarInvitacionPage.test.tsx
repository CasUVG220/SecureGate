import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AceptarInvitacionPage from '../pages/AceptarInvitacionPage';
import { aceptarInvitacion, getInvitacionPublica, InvitacionError } from '../services/api';

vi.mock('../services/api', async () => {
  class InvitacionError extends Error {
    status: number;
    estado?: string;
    constructor(mensaje: string, status: number, estado?: string) {
      super(mensaje);
      this.name = 'InvitacionError';
      this.status = status;
      this.estado = estado;
    }
  }
  return { getInvitacionPublica: vi.fn(), aceptarInvitacion: vi.fn(), InvitacionError };
});

const mockGet = getInvitacionPublica as unknown as ReturnType<typeof vi.fn>;
const mockAceptar = aceptarInvitacion as unknown as ReturnType<typeof vi.fn>;

const TOKEN = 'tok_1234567890abcdefghijklmnop';
const INVITACION = {
  email: 'ana@condominio.com',
  rol_invitado: 'admin_sucursal',
  rol_nombre: 'Administrador de sucursal',
  empresa_nombre: 'Condominio X',
  crea_empresa: false,
  sucursal_nombre: 'Torre A',
  expira_en: new Date(Date.now() + 3600_000).toISOString(),
};

describe('AceptarInvitacionPage', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockAceptar.mockReset();
  });

  it('token expirado (410): muestra el error de expiración y no el formulario', async () => {
    mockGet.mockRejectedValue(new InvitacionError('La invitación expiró', 410, 'expirada'));
    render(<AceptarInvitacionPage token={TOKEN} onAceptada={vi.fn()} onIrALogin={vi.fn()} />);

    expect(await screen.findByText(/Esta invitación expiró/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Tu nombre/)).not.toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith(TOKEN);
  });

  it('token inválido (404) y ya usado (409): mensajes distintos, con salida al login', async () => {
    const onIrALogin = vi.fn();
    mockGet.mockRejectedValue(new InvitacionError('Invitación no encontrada', 404));
    const { unmount } = render(<AceptarInvitacionPage token={TOKEN} onAceptada={vi.fn()} onIrALogin={onIrALogin} />);
    expect(await screen.findByText(/no es válido/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /inicio de sesión/i }));
    expect(onIrALogin).toHaveBeenCalled();
    unmount();

    mockGet.mockRejectedValue(new InvitacionError('La invitación ya fue aceptada', 409, 'aceptada'));
    render(<AceptarInvitacionPage token={TOKEN} onAceptada={vi.fn()} onIrALogin={vi.fn()} />);
    expect(await screen.findByText(/ya fue utilizada o revocada/)).toBeInTheDocument();
  });

  it('token válido: muestra a qué lo invitaron, envía nombre + password y entra en sesión', async () => {
    mockGet.mockResolvedValue(INVITACION);
    mockAceptar.mockResolvedValue({
      token: 'jwt-nuevo',
      usuario: { id: 'u-new', nombre: 'Ana López', email: 'ana@condominio.com', rol: 'admin_sucursal' },
    });
    const onAceptada = vi.fn();
    render(<AceptarInvitacionPage token={TOKEN} onAceptada={onAceptada} onIrALogin={vi.fn()} />);

    expect(await screen.findByText('Administrador de sucursal')).toBeInTheDocument();
    expect(screen.getByText(/Torre A · Condominio X/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('ana@condominio.com')).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Tu nombre/), { target: { value: 'Ana López' } });
    fireEvent.change(screen.getByLabelText(/Contraseña/), { target: { value: 'secreta123' } });
    fireEvent.click(screen.getByRole('button', { name: /Aceptar y crear cuenta/ }));

    await waitFor(() => expect(mockAceptar).toHaveBeenCalledWith(TOKEN, { nombre: 'Ana López', password: 'secreta123' }));
    await waitFor(() => expect(onAceptada).toHaveBeenCalledWith(expect.objectContaining({ token: 'jwt-nuevo' })));
  });

  it('si al enviar el backend responde 410, reemplaza el formulario por el estado expirado', async () => {
    mockGet.mockResolvedValue(INVITACION);
    mockAceptar.mockRejectedValue(new InvitacionError('La invitación expiró', 410, 'expirada'));
    render(<AceptarInvitacionPage token={TOKEN} onAceptada={vi.fn()} onIrALogin={vi.fn()} />);

    await screen.findByText('Administrador de sucursal');
    fireEvent.change(screen.getByLabelText(/Tu nombre/), { target: { value: 'Ana López' } });
    fireEvent.change(screen.getByLabelText(/Contraseña/), { target: { value: 'secreta123' } });
    fireEvent.click(screen.getByRole('button', { name: /Aceptar y crear cuenta/ }));

    expect(await screen.findByText(/Esta invitación expiró/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Tu nombre/)).not.toBeInTheDocument();
  });
});
