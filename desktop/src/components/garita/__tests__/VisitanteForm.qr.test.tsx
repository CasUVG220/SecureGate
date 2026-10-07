import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { VisitanteForm, type VisitanteFormHandle } from '../VisitanteForm';
import type { InvitacionQr } from '../../../lib/tauri';

vi.mock('../../../lib/tauri', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lib/tauri')>()),
  api: {
    garita: {
      buscarResidentes: vi.fn().mockResolvedValue([]),
      evaluarVisitante: vi.fn().mockResolvedValue({ bloqueado: false, preautorizado: false }),
      registrarAcceso: vi.fn(),
    },
  },
}));

const invitacion = (over: Partial<InvitacionQr> = {}): InvitacionQr => ({
  id: '3f2a9c10-aaaa-4bbb-8ccc-0123456789ab', tipo: 'individual', etiqueta: 'Cumpleaños', nombre_visitante: 'Marta',
  numero_dpi: '2999111220101', placa: null, residente_id: 'r1', numero_casa: 'A-12', residente_nombre: 'Ana López',
  usos_maximos: 3, usos_actuales: 1, ...over,
});

const cargar = (inv: InvitacionQr) => {
  const ref = createRef<VisitanteFormHandle>();
  render(<VisitanteForm ref={ref} habilitado onRegistrado={vi.fn()} />);
  act(() => ref.current!.setDesdeQr(inv));
};

/** SCRUM-126: el agente debe saber cuándo una invitación se validó con la copia local y no con el servidor. */
describe('VisitanteForm — invitación QR', () => {
  it('validada en línea: muestra la invitación y el uso, sin avisar de la copia local', () => {
    cargar(invitacion());
    expect(screen.getByText('Invitación QR válida')).toBeInTheDocument();
    expect(screen.getByText(/uso 2 de 3/)).toBeInTheDocument();
    expect(screen.queryByTestId('qr-sin-conexion')).toBeNull();
  });

  it('validada sin red: lo dice, para que no se tome por confirmada por el servidor', () => {
    cargar(invitacion({ validada_sin_conexion: true }));
    expect(screen.getByText('Invitación QR válida')).toBeInTheDocument();
    expect(screen.getByTestId('qr-sin-conexion')).toHaveTextContent('Validada sin conexión con la copia de este equipo');
    expect(screen.getByTestId('qr-sin-conexion')).toHaveTextContent('el servidor la confirma al sincronizar');
  });
});
