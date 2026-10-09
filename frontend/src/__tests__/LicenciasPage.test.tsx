import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LicenciasPage from '../pages/LicenciasPage';
import { crearLicencia, getLicencias, revocarLicencia } from '../services/api';

vi.mock('../services/api', () => ({
  getLicencias: vi.fn(),
  crearLicencia: vi.fn(),
  revocarLicencia: vi.fn(),
  getSucursales: vi.fn().mockResolvedValue([]),
  decodeTokenPayload: () => ({ rol: 'admin_sucursal' }),
}));

const mockGet = getLicencias as unknown as ReturnType<typeof vi.fn>;
const mockCrear = crearLicencia as unknown as ReturnType<typeof vi.fn>;
const mockRevocar = revocarLicencia as unknown as ReturnType<typeof vi.fn>;

const lic = (over: Record<string, unknown> = {}) => ({
  id: 'lic-1', sucursal_id: 'suc-1', sucursal_nombre: 'Sucursal Principal',
  codigo_activacion: 'SG-AAAA-BBBB-CCCC-DDDD', etiqueta: 'Garita norte', estado: 'activa',
  activada: false, activado_en: null, ultimo_heartbeat: null, revocado_en: null,
  created_at: new Date().toISOString(), ...over,
});

describe('LicenciasPage (admin de sucursal)', () => {
  beforeEach(() => {
    mockGet.mockReset(); mockCrear.mockReset(); mockRevocar.mockReset();
    localStorage.setItem('token', 'x');
  });

  it('lista los códigos con su estado: sin activar, activa y revocada', async () => {
    mockGet.mockResolvedValue([
      lic(),
      lic({ id: 'lic-2', etiqueta: 'Entrada principal', codigo_activacion: 'SG-1111-2222-3333-4444', activada: true, ultimo_heartbeat: new Date().toISOString() }),
      lic({ id: 'lic-3', etiqueta: 'Vieja', codigo_activacion: 'SG-9999-8888-7777-6666', estado: 'revocada' }),
    ]);
    render(<LicenciasPage />);

    expect(await screen.findByText('SG-AAAA-BBBB-CCCC-DDDD')).toBeInTheDocument();
    expect(screen.getByText('Sin activar')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText('Revocado')).toBeInTheDocument();
    expect(screen.getByText('hace un momento')).toBeInTheDocument();
  });

  it('genera un código nuevo y lo muestra en grande para copiarlo a la app', async () => {
    mockGet.mockResolvedValue([]);
    mockCrear.mockResolvedValue(lic({ codigo_activacion: 'SG-NUEV-OCOD-IGOX-YZWV', etiqueta: 'Garita sur' }));
    render(<LicenciasPage />);

    await screen.findByText('Ningún equipo de garita todavía');
    fireEvent.click(screen.getAllByRole('button', { name: '+ Nuevo código de activación' })[0]);
    fireEvent.change(await screen.findByLabelText(/Nombre del equipo/), { target: { value: 'Garita sur' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generar código' }));

    await waitFor(() => expect(mockCrear).toHaveBeenCalledWith({ etiqueta: 'Garita sur' }));
    expect(await screen.findByTestId('codigo-emitido')).toHaveTextContent('SG-NUEV-OCOD-IGOX-YZWV');
    expect(screen.getByText(/Pega el código en la pantalla/)).toBeInTheDocument();
  });

  it('revoca una licencia activa tras confirmar', async () => {
    mockGet.mockResolvedValue([lic({ activada: true })]);
    mockRevocar.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LicenciasPage />);

    await screen.findByText('SG-AAAA-BBBB-CCCC-DDDD');
    fireEvent.click(screen.getByRole('button', { name: /Acciones: Garita norte/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Revocar/ }));

    await waitFor(() => expect(mockRevocar).toHaveBeenCalledWith('lic-1'));
  });
});
