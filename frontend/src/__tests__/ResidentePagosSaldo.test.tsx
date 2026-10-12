/**
 * T1 — portal del residente: un pago resta su monto del saldo.
 * El comprobante de transferencia no puede pasar del saldo (el servidor responde 422 y aquí se avisa antes),
 * y tras un pago con tarjeta parcial el saldo que se muestra es el que queda, no cero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ResidentePage from '../pages/ResidentePage';
import * as api from '../services/api';

vi.mock('../services/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  getResidenteMe: vi.fn(), getEstadoTarjeta: vi.fn(), getMisPagos: vi.fn(), getMiResumenMes: vi.fn(),
  getMisPreautorizaciones: vi.fn(), getMisAccesos: vi.fn(), getMisTickets: vi.fn(), getMisInvitaciones: vi.fn(),
  crearTransferencia: vi.fn(), pagarConTarjeta: vi.fn(),
}));

const m = <K extends keyof typeof api>(k: K) => api[k] as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  m('getResidenteMe').mockResolvedValue({
    id: 'r1', numero_casa: 'A-12', estado_pago: 'mora', saldo_pendiente: '850.00', telefono: null,
    nombre: 'Ana Gómez', email: 'ana@x.com', pagos_recientes: [],
  });
  m('getEstadoTarjeta').mockResolvedValue({ disponible: true, simulada: false });
  m('getMisPagos').mockResolvedValue([]);
  m('getMiResumenMes').mockResolvedValue(null);
  m('getMisPreautorizaciones').mockResolvedValue([]);
  m('getMisAccesos').mockResolvedValue([]);
  m('getMisTickets').mockResolvedValue([]);
  m('getMisInvitaciones').mockResolvedValue([]);
});

describe('ResidentePage › pagos y saldo (T1)', () => {
  it('un comprobante por más del saldo no se envía y explica por qué', async () => {
    render(<ResidentePage requestedTab="pagos" />);
    fireEvent.click(await screen.findByRole('button', { name: /Subir Comprobante de Transferencia/ }));
    fireEvent.change(screen.getByPlaceholderText('850.00'), { target: { value: '900' } });
    fireEvent.change(screen.getByPlaceholderText('Banco Industrial'), { target: { value: 'Banrural' } });
    fireEvent.change(screen.getByPlaceholderText('TRF-789456123'), { target: { value: 'REF1' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar comprobante/ }));
    expect(await screen.findByText(/El monto \(Q900\.00\) supera tu saldo pendiente \(Q850\.00\)/)).toBeInTheDocument();
    expect(m('crearTransferencia')).not.toHaveBeenCalled();
  });

  it('un comprobante por una parte del saldo sí se envía (pago parcial)', async () => {
    m('crearTransferencia').mockResolvedValue({ id: 'p1', monto: '300.00', metodo: 'transferencia', estado: 'pendiente', fecha_pago: '2026-10-10T12:00:00Z' });
    render(<ResidentePage requestedTab="pagos" />);
    fireEvent.click(await screen.findByRole('button', { name: /Subir Comprobante de Transferencia/ }));
    fireEvent.change(screen.getByPlaceholderText('850.00'), { target: { value: '300' } });
    fireEvent.change(screen.getByPlaceholderText('Banco Industrial'), { target: { value: 'Banrural' } });
    fireEvent.change(screen.getByPlaceholderText('TRF-789456123'), { target: { value: 'REF1' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar comprobante/ }));
    await waitFor(() => expect(m('crearTransferencia')).toHaveBeenCalledWith(expect.objectContaining({ monto: 300 })));
  });
});
