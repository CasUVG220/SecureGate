import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PagoTarjetaModal from '../components/PagoTarjetaModal';
import { pagarConTarjeta, PagoRechazadoError } from '../services/api';
import {
  esLuhnValido, formatearNumero, formatearVencimiento, detectarMarca, validarTarjeta,
} from '../utils/tarjeta';

vi.mock('../services/api', () => {
  class PagoRechazadoError extends Error {}
  return { pagarConTarjeta: vi.fn(), PagoRechazadoError };
});

const mockPagar = pagarConTarjeta as unknown as ReturnType<typeof vi.fn>;

// Números de prueba públicos de las marcas; ninguno corresponde a una cuenta real.
const VISA_VALIDA = '4111111111111111';
const AMEX_VALIDA = '378282246310005';
const VISA_INVALIDA = '4111111111111112';

const AHORA = new Date('2026-09-03T12:00:00Z');

describe('Luhn y formato de tarjeta', () => {
  it('acepta números válidos de distintas marcas', () => {
    expect(esLuhnValido(VISA_VALIDA)).toBe(true);
    expect(esLuhnValido(AMEX_VALIDA)).toBe(true);
    expect(esLuhnValido('5555555555554444')).toBe(true);
  });

  it('rechaza un número con un dígito cambiado', () => {
    expect(esLuhnValido(VISA_INVALIDA)).toBe(false);
  });

  it('ignora espacios y separadores al validar', () => {
    expect(esLuhnValido('4111 1111 1111 1111')).toBe(true);
    expect(esLuhnValido('4111-1111-1111-1111')).toBe(true);
  });

  it('rechaza cadenas vacías o demasiado cortas', () => {
    expect(esLuhnValido('')).toBe(false);
    expect(esLuhnValido('4')).toBe(false);
  });

  it('agrupa el número de 4 en 4 y en 4-6-5 para Amex', () => {
    expect(formatearNumero('4111111111111111')).toBe('4111 1111 1111 1111');
    expect(formatearNumero('411111')).toBe('4111 11');
    expect(formatearNumero('378282246310005')).toBe('3782 822463 10005');
  });

  it('nunca deja pasar más de 19 dígitos', () => {
    expect(formatearNumero('1'.repeat(25)).replace(/\s/g, '')).toHaveLength(19);
  });

  it('normaliza el vencimiento a MM/AA', () => {
    expect(formatearVencimiento('1230')).toBe('12/30');
    expect(formatearVencimiento('12')).toBe('12');
    // Un "4" suelto sólo puede ser abril.
    expect(formatearVencimiento('4')).toBe('04/');
  });

  it('detecta la marca por el prefijo', () => {
    expect(detectarMarca(VISA_VALIDA)).toBe('visa');
    expect(detectarMarca('5555555555554444')).toBe('mastercard');
    expect(detectarMarca(AMEX_VALIDA)).toBe('amex');
    expect(detectarMarca('9999')).toBe('desconocida');
  });
});

describe('validarTarjeta', () => {
  const base = { numero: VISA_VALIDA, titular: 'JUAN PEREZ', vencimiento: '12/30', cvv: '123' };

  it('no reporta errores con datos correctos', () => {
    expect(validarTarjeta(base, 850, AHORA)).toEqual({});
  });

  it('marca el número que falla Luhn', () => {
    expect(validarTarjeta({ ...base, numero: VISA_INVALIDA }, 850, AHORA).numero).toBe('card.errNumber');
  });

  it('marca el número demasiado corto antes que Luhn', () => {
    expect(validarTarjeta({ ...base, numero: '4111' }, 850, AHORA).numero).toBe('card.errNumberLength');
  });

  it('exige el nombre del titular', () => {
    expect(validarTarjeta({ ...base, titular: '   ' }, 850, AHORA).titular).toBe('card.errHolder');
  });

  it('valida el formato y la vigencia del vencimiento', () => {
    expect(validarTarjeta({ ...base, vencimiento: '13/30' }, 850, AHORA).vencimiento).toBe('card.errExpiryFormat');
    expect(validarTarjeta({ ...base, vencimiento: '1230' }, 850, AHORA).vencimiento).toBe('card.errExpiryFormat');
    expect(validarTarjeta({ ...base, vencimiento: '08/26' }, 850, AHORA).vencimiento).toBe('card.errExpiryPast');
    // La tarjeta vale hasta el último día de su mes de vencimiento.
    expect(validarTarjeta({ ...base, vencimiento: '09/26' }, 850, AHORA).vencimiento).toBeUndefined();
  });

  it('pide 4 dígitos de CVV en Amex y 3 en el resto', () => {
    expect(validarTarjeta({ ...base, numero: AMEX_VALIDA, cvv: '123' }, 850, AHORA).cvv).toBe('card.errCvv');
    expect(validarTarjeta({ ...base, numero: AMEX_VALIDA, cvv: '1234' }, 850, AHORA).cvv).toBeUndefined();
    expect(validarTarjeta({ ...base, cvv: '12' }, 850, AHORA).cvv).toBe('card.errCvv');
  });

  it('exige un monto mayor a 0', () => {
    expect(validarTarjeta(base, 0, AHORA).monto).toBe('card.errAmount');
    expect(validarTarjeta(base, NaN, AHORA).monto).toBe('card.errAmount');
  });
});

const llenar = (over: Partial<Record<string, string>> = {}) => {
  const valores = { numero: '4111 1111 1111 1111', titular: 'JUAN PEREZ', vencimiento: '12/30', cvv: '123', ...over };
  fireEvent.change(screen.getByLabelText(/Número de tarjeta/), { target: { value: valores.numero } });
  fireEvent.change(screen.getByLabelText(/Nombre del titular/), { target: { value: valores.titular } });
  fireEvent.change(screen.getByLabelText(/Vencimiento/), { target: { value: valores.vencimiento } });
  fireEvent.change(screen.getByLabelText(/^CVV/), { target: { value: valores.cvv } });
};

describe('PagoTarjetaModal', () => {
  beforeEach(() => { mockPagar.mockReset(); });

  const renderModal = (onResultado = vi.fn(), extra: Partial<React.ComponentProps<typeof PagoTarjetaModal>> = {}) => {
    render(<PagoTarjetaModal open onClose={vi.fn()} saldo={850} onResultado={onResultado} {...extra} />);
    return onResultado;
  };

  it('en un entorno de PRUEBA (simulada) advierte que no se cobra a una tarjeta real', () => {
    renderModal(vi.fn(), { simulada: true });
    expect(screen.getByText(/no se cobra a ninguna tarjeta real/i)).toBeInTheDocument();
    expect(screen.getByText(/Pago simulado/)).toBeInTheDocument();
  });

  it('al residente real NO se le muestra ningún texto de implementación (simulado / Visanet / entorno de prueba)', () => {
    const { baseElement } = render(<PagoTarjetaModal open onClose={vi.fn()} saldo={850} onResultado={vi.fn()} />);
    expect(baseElement.textContent).not.toMatch(/simulad|visanet|entorno de prueba|no se cobra/i);
    expect(screen.getByText('Paga tu saldo pendiente con tarjeta.')).toBeInTheDocument();
  });

  describe('el monto no puede superar el saldo (T1)', () => {
    const cambiarMonto = (v: string) => fireEvent.change(screen.getByLabelText(/Monto a pagar/), { target: { value: v } });

    it('con el monto igual al saldo no avisa', () => {
      renderModal();
      expect(screen.queryByText(/supera tu saldo pendiente/)).toBeNull();
    });

    it('si el monto es mayor, avisa con las dos cifras y BLOQUEA el pago (el servidor lo rechazaría con 422)', async () => {
      renderModal();
      cambiarMonto('900');
      const aviso = screen.getByRole('status');
      expect(aviso).toHaveTextContent('El monto (Q900.00) supera tu saldo pendiente (Q850.00)');
      expect(aviso).toHaveTextContent('No se puede pagar más de lo que se debe');

      llenar();
      const confirmar = screen.getByRole('button', { name: /Confirmar pago/ });
      expect(confirmar).toBeDisabled();
      fireEvent.click(confirmar);
      expect(mockPagar).not.toHaveBeenCalled();
    });

    it('«Usar mi saldo» vuelve a poner el saldo exacto y el aviso desaparece', () => {
      renderModal();
      cambiarMonto('1200');
      fireEvent.click(screen.getByRole('button', { name: 'Usar mi saldo (Q850.00)' }));
      expect(screen.getByLabelText(/Monto a pagar/)).toHaveValue(850);
      expect(screen.queryByText(/supera tu saldo pendiente/)).toBeNull();
    });

    it('un monto menor al saldo es un pago parcial válido: no es una advertencia, solo una nota', async () => {
      mockPagar.mockResolvedValue({ id: 'p8', monto: '100.00', estado: 'aprobado', es_simulado: true });
      renderModal();
      cambiarMonto('100');
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByText(/pago parcial: lo que no pagues ahora queda como saldo pendiente/)).toBeInTheDocument();
      llenar();
      fireEvent.click(screen.getByRole('button', { name: /Confirmar pago/ }));
      await waitFor(() => expect(mockPagar).toHaveBeenCalledWith(expect.objectContaining({ monto: 100 })));
    });

    it('sin saldo pendiente avisa que el pago no reduce ninguna deuda', () => {
      renderModal(vi.fn(), { saldo: 0 });
      cambiarMonto('50');
      expect(screen.getByRole('status')).toHaveTextContent('No tienes saldo pendiente: no hay nada que pagar');
    });
  });

  it('precarga el saldo pendiente como monto a cobrar', () => {
    renderModal();
    expect(screen.getByLabelText(/Monto a pagar/)).toHaveValue(850);
  });

  it('formatea el número en grupos de 4 mientras se escribe', () => {
    renderModal();
    const campo = screen.getByLabelText(/Número de tarjeta/);
    fireEvent.change(campo, { target: { value: '4111111111111111' } });
    expect(campo).toHaveValue('4111 1111 1111 1111');
  });

  it('datos inválidos: muestra los errores y no llama a la pasarela', async () => {
    renderModal();
    llenar({ numero: '4111 1111 1111 1112', titular: '' });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar pago/ }));

    expect(await screen.findByText('Número de tarjeta inválido')).toBeInTheDocument();
    expect(screen.getByText('Ingresa el nombre del titular')).toBeInTheDocument();
    expect(mockPagar).not.toHaveBeenCalled();
  });

  it('tarjeta vencida: bloquea el envío', async () => {
    renderModal();
    llenar({ vencimiento: '01/20' });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar pago/ }));

    expect(await screen.findByText('La tarjeta está vencida')).toBeInTheDocument();
    expect(mockPagar).not.toHaveBeenCalled();
  });

  it('datos válidos: envía solo monto, últimos 4 y titular', async () => {
    mockPagar.mockResolvedValue({ id: 'p1', monto: '850.00', estado: 'aprobado', es_simulado: true });
    const onResultado = renderModal();

    llenar();
    fireEvent.click(screen.getByRole('button', { name: /Confirmar pago/ }));

    await waitFor(() => expect(mockPagar).toHaveBeenCalledWith({
      monto: 850, ultimos4: '1111', titular: 'JUAN PEREZ',
    }));
    // Ni el PAN completo ni el CVV salen del navegador.
    const enviado = JSON.stringify(mockPagar.mock.calls[0][0]);
    expect(enviado).not.toContain('4111111111111111');
    expect(enviado).not.toContain('123');

    await waitFor(() => expect(onResultado).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' })));
  });

  it('pago rechazado: informa al usuario, deja el formulario abierto y NO lo reporta como pago', async () => {
    mockPagar.mockRejectedValue(new PagoRechazadoError('Pago rechazado por el emisor. Intenta con otra tarjeta.'));
    const onResultado = renderModal();

    llenar();
    fireEvent.click(screen.getByRole('button', { name: /Confirmar pago/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/rechazado por el emisor/i);
    expect(onResultado).not.toHaveBeenCalled();        // una tarjeta rechazada no es un pago: no llega al historial
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
