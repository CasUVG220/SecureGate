import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Input, { Select, Textarea } from '../Input';

describe('Input', () => {
  it('label: queda asociado al campo, así que el click enfoca', () => {
    render(<Input label="Correo" />);
    const field = screen.getByLabelText('Correo');
    expect(field).toBeInTheDocument();
    expect(field.id).toBeTruthy();
  });

  it('required: marca el campo y añade el asterisco decorativo', () => {
    const { container } = render(<Input label="Casa" required />);
    expect(screen.getByLabelText(/Casa/)).toBeRequired();
    expect(container.querySelector('label span')).toHaveAttribute('aria-hidden', 'true');
  });

  it('error: anuncia el mensaje, marca aria-invalid y lo enlaza con el campo', () => {
    render(<Input label="Correo" error="Correo inválido" />);
    const field = screen.getByLabelText('Correo');

    expect(screen.getByRole('alert')).toHaveTextContent('Correo inválido');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')).toBe(`${field.id}-error`);
    expect(field).toHaveClass('border-danger-500');
  });

  it('hint: se muestra solo mientras no haya error', () => {
    const { rerender } = render(<Input label="Monto" hint="Incluye recargos" />);
    expect(screen.getByText('Incluye recargos')).toBeInTheDocument();

    rerender(<Input label="Monto" hint="Incluye recargos" error="Monto inválido" />);
    expect(screen.queryByText('Incluye recargos')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Monto inválido');
  });

  it('disabled: el campo queda inactivo y con su estilo apagado', () => {
    render(<Input label="Casa" disabled />);
    const field = screen.getByLabelText('Casa');

    expect(field).toBeDisabled();
    // El estilo apagado vive en `.sg-input:disabled`, que la clase base aporta.
    expect(field).toHaveClass('sg-input');
  });

  it('icon y suffix: reservan espacio dentro del campo', () => {
    const { container } = render(<Input label="Buscar" icon="M4 4h16" suffix="Q" />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.getByLabelText('Buscar')).toHaveClass('pl-10', 'pr-11');
  });

  it('onChange: propaga el valor escrito', () => {
    const onChange = vi.fn();
    render(<Input label="Casa" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Casa'), { target: { value: '204' } });
    expect(onChange).toHaveBeenCalled();
  });
});

describe('Select', () => {
  it('render: label, opciones y estado de error', () => {
    render(
      <Select label="Estado" error="Selecciona un estado">
        <option value="">Todos</option>
        <option value="mora">Mora</option>
      </Select>
    );
    const field = screen.getByLabelText('Estado');
    expect(field.tagName).toBe('SELECT');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Selecciona un estado');
  });
});

describe('Textarea', () => {
  it('render: label y disabled', () => {
    render(<Textarea label="Mensaje" disabled />);
    const field = screen.getByLabelText('Mensaje');
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toBeDisabled();
  });
});
