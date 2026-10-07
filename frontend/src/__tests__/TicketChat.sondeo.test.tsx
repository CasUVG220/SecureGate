/**
 * El estado de una solicitud y sus mensajes se actualizan solos (sondeo ligero) — SCRUM-112 / H07.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import TicketChat from '../components/TicketChat';
import { getTicketMensajes } from '../services/api';

vi.mock('../services/api', () => ({
  getTicketMensajes: vi.fn(),
  addTicketMensaje: vi.fn(),
  cerrarTicket: vi.fn(),
  decodeTokenPayload: () => ({ id: 'yo' }),
}));
const mockGet = getTicketMensajes as unknown as ReturnType<typeof vi.fn>;

const ticket = (estado: string) => ({ id: 't1', titulo: 'Fuga de agua', tipo: 'mantenimiento', estado });
const msg = (id: string, texto: string) => ({ id, autor_id: 'otro', autor_nombre: 'Admin', mensaje: texto, created_at: '2026-10-10T15:00:00Z' });

beforeEach(() => { vi.useFakeTimers(); localStorage.setItem('token', 'x'); mockGet.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('TicketChat: refresco automático', () => {
  it('el estado del encabezado pasa de «Abierto» a «En proceso» sin recargar, y llega el mensaje nuevo', async () => {
    mockGet
      .mockResolvedValueOnce({ ticket: ticket('abierto'), mensajes: [msg('m1', 'Hola, ¿qué pasa?')] })
      .mockResolvedValue({ ticket: ticket('en_proceso'), mensajes: [msg('m1', 'Hola, ¿qué pasa?'), msg('m2', 'Ya enviamos a un técnico')] });
    const onActivity = vi.fn();
    render(<TicketChat ticketId="t1" viewerRole="residente" onActivity={onActivity} />);

    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(screen.getByText('Abierto')).toBeInTheDocument();
    expect(screen.queryByText('Ya enviamos a un técnico')).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(10_100); });
    expect(screen.getByText('En proceso')).toBeInTheDocument();
    expect(screen.getByText('Ya enviamos a un técnico')).toBeInTheDocument();
    expect(onActivity.mock.calls.length).toBeGreaterThanOrEqual(2); // al abrir y al detectar el cambio
  });

  it('si nada cambió no vuelve a pintar ni avisa al padre', async () => {
    mockGet.mockResolvedValue({ ticket: ticket('abierto'), mensajes: [msg('m1', 'Hola')] });
    const onActivity = vi.fn();
    render(<TicketChat ticketId="t1" viewerRole="residente" onActivity={onActivity} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    const antes = onActivity.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_500); });
    expect(mockGet.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(onActivity.mock.calls.length).toBe(antes);
  });
});
