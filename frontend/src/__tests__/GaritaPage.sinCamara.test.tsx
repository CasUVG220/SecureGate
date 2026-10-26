/**
 * Garita web sin cámara (SCRUM-111 / H04): el registro sigue siendo posible con el
 * teclado — «Escribir placa» y el código de la invitación QR escrito a mano.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GaritaPage from '../pages/GaritaPage';
import { getResidentes, getConfigQr, verificarInvitacionQr } from '../services/api';

vi.mock('../services/api', async () => {
  class BlacklistDenialError extends Error {
    razon = ''; fecha_fin: string | null = null; motivo: 'dpi' | 'placa' = 'dpi';
  }
  return {
    getResidentes: vi.fn(), getConfigQr: vi.fn(), verificarInvitacionQr: vi.fn(),
    registrarAcceso: vi.fn(), decodeTokenPayload: () => ({ rol: 'agente' }),
    buscarPreautorizacion: vi.fn(), buscarVisitantesFrecuentes: vi.fn().mockResolvedValue([]),
    BlacklistDenialError,
  };
});

const mockResidentes = getResidentes as unknown as ReturnType<typeof vi.fn>;
const mockConfig = getConfigQr as unknown as ReturnType<typeof vi.fn>;
const mockVerificar = verificarInvitacionQr as unknown as ReturnType<typeof vi.fn>;

const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const INVITACION = {
  id: ID, tipo: 'grupal', etiqueta: 'Fiesta de Ana', residente_id: 'r1', residente_nombre: 'Ana López', numero_casa: 'A-12',
  nombre_visitante: null, numero_dpi: null, placa: null, usos_maximos: null, usos_actuales: 0,
};

beforeEach(() => {
  localStorage.setItem('token', 'x');
  mockResidentes.mockReset().mockResolvedValue([]);
  mockConfig.mockReset().mockResolvedValue({ autorizacion_automatica: false, requiere_placa: false });
  mockVerificar.mockReset();
  // Sin cámara: el navegador no expone getUserMedia (HTTP sin TLS, equipo sin webcam…).
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});
afterEach(() => {
  // @ts-expect-error se limpia el mock
  delete navigator.mediaDevices;
});

describe('GaritaPage web sin cámara', () => {
  it('explica que el registro sigue funcionando y ofrece «Escribir placa» que enfoca el campo', async () => {
    render(<GaritaPage />);
    expect(await screen.findByText('Cámara no disponible')).toBeInTheDocument();
    expect(screen.getByText(/Sin cámara el registro sigue funcionando/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Escribir placa' }));
    expect(document.activeElement).toBe(document.querySelector('input[name="placa"]'));
  });

  it('un código de invitación escrito a mano (sin prefijo, con mayúsculas) se verifica con su UUID', async () => {
    mockVerificar.mockResolvedValue(INVITACION);
    render(<GaritaPage />);
    const campo = await screen.findByRole('textbox', { name: 'Código de la invitación (QR)' });
    const boton = screen.getByRole('button', { name: 'Verificar código' });
    expect(boton).toBeDisabled();

    fireEvent.change(campo, { target: { value: ID.toUpperCase() } });
    fireEvent.click(boton);

    await waitFor(() => expect(mockVerificar).toHaveBeenCalledWith(ID));
    expect(await screen.findByText(/QR válido|Invitación válida|válid/i)).toBeInTheDocument();
  });

  it('un código con mal formato no llega al servidor y explica el problema', async () => {
    render(<GaritaPage />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Código de la invitación (QR)' }), { target: { value: 'no-es-un-codigo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar código' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El código no tiene el formato correcto');
    expect(mockVerificar).not.toHaveBeenCalled();
  });

  it('si el servidor rechaza el código (vencido, agotado) el motivo queda a la vista', async () => {
    mockVerificar.mockRejectedValue(new Error('La invitación expiró'));
    render(<GaritaPage />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Código de la invitación (QR)' }), { target: { value: ID } });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar código' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La invitación expiró');
  });
});
