import { useRef, useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlacaInput from '../components/PlacaInput';
import QrInviteModal from '../components/QrInviteModal';
import { crearInvitacionQr, getConfigQr } from '../services/api';

vi.mock('../services/api', () => ({ crearInvitacionQr: vi.fn(), getConfigQr: vi.fn() }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,AAA') } }));
const mockCrear = crearInvitacionQr as unknown as ReturnType<typeof vi.fn>;
const mockConfig = getConfigQr as unknown as ReturnType<typeof vi.fn>;

function Campo({ onValor }: { onValor?: (v: string) => void }) {
  const [v, setV] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <PlacaInput ref={ref} aria-label="Placa" value={v} onChange={x => { setV(x); onValor?.(x); }} />
      <button onClick={() => ref.current?.focus()}>enfocar</button>
    </>
  );
}

describe('PlacaInput', () => {
  it('acomoda lo que se teclea: mayúsculas y guion tras el prefijo; el mismo ejemplo en todas partes', () => {
    render(<Campo />);
    const campo = screen.getByLabelText('Placa') as HTMLInputElement;
    expect(campo.placeholder).toBe('P-123ABC');
    fireEvent.change(campo, { target: { value: 'p123abc' } });
    expect(campo.value).toBe('P-123ABC');
    fireEvent.change(campo, { target: { value: ' c 058 xyz ' } });
    expect(campo.value).toBe('C-058XYZ');
  });

  it('un formato que no es el guatemalteco no inventa guiones', () => {
    render(<Campo />);
    const campo = screen.getByLabelText('Placa') as HTMLInputElement;
    fireEvent.change(campo, { target: { value: 'mx-12-ab' } });
    expect(campo.value).toBe('MX12AB');
  });

  it('reenvía la ref (para «Escribir placa»)', () => {
    render(<Campo />);
    fireEvent.click(screen.getByText('enfocar'));
    expect(document.activeElement).toBe(screen.getByLabelText('Placa'));
  });
});

describe('QrInviteModal — placa y código', () => {
  beforeEach(() => { mockCrear.mockReset(); mockConfig.mockReset().mockResolvedValue({ requiere_placa: false, dpi_obligatorio_individual: false }); });

  it('manda la placa en su forma canónica y muestra el código de texto de la invitación', async () => {
    mockCrear.mockResolvedValue({
      id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', tipo: 'grupal', etiqueta: 'Fiesta', nombre_visitante: null, numero_dpi: null,
      placa: 'P901LMN', usos_maximos: null, usos_actuales: 0,
    });
    const { baseElement } = render(<QrInviteModal onClose={vi.fn()} />);
    await waitFor(() => expect(mockConfig).toHaveBeenCalled());
    // Por defecto la invitación es individual: pide el nombre del visitante.
    fireEvent.change(baseElement.querySelector('input[name="nombre_visitante"]') as HTMLInputElement, { target: { value: 'Con carro' } });
    fireEvent.change(screen.getByPlaceholderText('P-123ABC'), { target: { value: 'p901lmn' } });
    expect((screen.getByPlaceholderText('P-123ABC') as HTMLInputElement).value).toBe('P-901LMN');
    fireEvent.click(screen.getByRole('button', { name: /Crear|Generar/ }));

    await waitFor(() => expect(mockCrear).toHaveBeenCalledWith(expect.objectContaining({ placa: 'P901LMN' })));
    // El QR trae también su código escrito: si la cámara de la garita no lo lee, el guardia lo teclea.
    expect(await screen.findByTestId('qr-codigo')).toHaveTextContent('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
    expect(screen.getByText(/P-901LMN/)).toBeInTheDocument();                 // se muestra con guion
  });
});
