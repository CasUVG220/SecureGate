import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import OwnerEmpresas from '../pages/owner/OwnerEmpresas';
import { eliminarEmpresaDefinitivo, getEmpresas } from '../services/api';

vi.mock('../services/api', () => ({
  getEmpresas: vi.fn(),
  getUsuarios: vi.fn().mockResolvedValue([]),
  createEmpresa: vi.fn(), updateEmpresa: vi.fn(), deleteEmpresa: vi.fn(), assignAdminEmpresa: vi.fn(),
  createUsuario: vi.fn(), suspenderEmpresa: vi.fn(), reactivarEmpresa: vi.fn(),
  eliminarEmpresaDefinitivo: vi.fn(),
  // InvitacionesPanel vive dentro de la página.
  getInvitaciones: vi.fn().mockResolvedValue([]), crearInvitacion: vi.fn(), revocarInvitacion: vi.fn(), reenviarInvitacion: vi.fn(),
}));

const mockGet = getEmpresas as unknown as ReturnType<typeof vi.fn>;
const mockHard = eliminarEmpresaDefinitivo as unknown as ReturnType<typeof vi.fn>;

const EMPRESA = {
  id: 'emp-1', nombre: 'Condominio X', nit: null, logo_url: null, activo: true,
  suspendida: false, suspension_motivo: null, suspendida_en: null, created_at: '2026-01-01', total_sucursales: 2,
};

describe('OwnerEmpresas — eliminar definitivamente', () => {
  beforeEach(() => { mockGet.mockReset(); mockHard.mockReset(); mockGet.mockResolvedValue([EMPRESA]); });

  it('exige escribir el nombre exacto y la contraseña del owner antes de habilitar el botón', async () => {
    mockHard.mockResolvedValue({ nombre: 'Condominio X', eliminado: { empresas: 1 } });
    render(<OwnerEmpresas />);

    await screen.findByText('Condominio X');
    fireEvent.click(screen.getByRole('button', { name: /Acciones: Condominio X/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Eliminar definitivamente/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Eliminar empresa definitivamente' });
    expect(within(dialog).getByText(/irreversible/)).toBeInTheDocument();
    const confirmar = within(dialog).getByRole('button', { name: 'Eliminar definitivamente' });
    expect(confirmar).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/Escribe el nombre/), { target: { value: 'Condominio Y' } });
    fireEvent.change(within(dialog).getByLabelText(/contraseña de owner/i), { target: { value: 'admin123' } });
    expect(confirmar).toBeDisabled(); // nombre distinto

    fireEvent.change(within(dialog).getByLabelText(/Escribe el nombre/), { target: { value: 'Condominio X' } });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);

    await waitFor(() => expect(mockHard).toHaveBeenCalledWith('emp-1', 'admin123'));
  });

  it('contraseña incorrecta: muestra el error del servidor y no cierra el modal', async () => {
    mockHard.mockRejectedValue(new Error('Contraseña incorrecta'));
    render(<OwnerEmpresas />);
    await screen.findByText('Condominio X');
    fireEvent.click(screen.getByRole('button', { name: /Acciones: Condominio X/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Eliminar definitivamente/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Eliminar empresa definitivamente' });
    fireEvent.change(within(dialog).getByLabelText(/Escribe el nombre/), { target: { value: 'Condominio X' } });
    fireEvent.change(within(dialog).getByLabelText(/contraseña de owner/i), { target: { value: 'mala' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar definitivamente' }));

    expect(await within(dialog).findByText('Contraseña incorrecta')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Eliminar empresa definitivamente' })).toBeInTheDocument();
  });
});
