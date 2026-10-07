import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PasswordInput from '../PasswordInput';
import { requisitosDeClave } from '../password';

function Controlado(props: Partial<React.ComponentProps<typeof PasswordInput>>) {
  const [v, setV] = useState('');
  return <PasswordInput label="Contraseña" value={v} onChange={e => setV(e.target.value)} {...props} />;
}

describe('requisitosDeClave', () => {
  it('largo y mezcla de letras y números', () => {
    expect(requisitosDeClave('').map(r => r.ok)).toEqual([false, false]);
    expect(requisitosDeClave('abcdefgh').map(r => r.ok)).toEqual([true, false]);
    expect(requisitosDeClave('1234567').map(r => r.ok)).toEqual([false, false]);
    expect(requisitosDeClave('abc12345').map(r => r.ok)).toEqual([true, true]);
    expect(requisitosDeClave('Contraseña9').map(r => r.ok)).toEqual([true, true]);
  });
});

describe('PasswordInput', () => {
  it('empieza oculta y el botón alterna entre mostrar y ocultar', () => {
    render(<Controlado />);
    const campo = screen.getByLabelText('Contraseña') as HTMLInputElement;
    expect(campo.type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(campo.type).toBe('text');
    expect(screen.getByRole('button', { name: 'Ocultar contraseña' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(campo.type).toBe('password');
  });

  it('el botón no envía el formulario', () => {
    let enviado = false;
    render(
      <form onSubmit={e => { e.preventDefault(); enviado = true; }}>
        <Controlado />
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(enviado).toBe(false);
  });

  it('muestra los requisitos desde el inicio y los marca al cumplirse', () => {
    const { container } = render(<Controlado />);
    const item = (t: string) => screen.getByText(t).closest('[data-cumplido]') as HTMLElement;
    expect(item('Al menos 8 caracteres')).toHaveAttribute('data-cumplido', 'false');
    expect(item('Letras y números')).toHaveAttribute('data-cumplido', 'false');

    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'abcdefgh' } });
    expect(item('Al menos 8 caracteres')).toHaveAttribute('data-cumplido', 'true');
    expect(item('Letras y números')).toHaveAttribute('data-cumplido', 'false');

    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'abcdefg1' } });
    expect(item('Letras y números')).toHaveAttribute('data-cumplido', 'true');
    // El hint debe ser inline: un <ul> dentro de <p> sería HTML inválido.
    expect(container.querySelector('p ul, p div')).toBeNull();
  });

  it('con requisitos={false} no los pinta pero conserva el botón (login)', () => {
    render(<Controlado requisitos={false} />);
    expect(screen.queryByText('Al menos 8 caracteres')).toBeNull();
    expect(screen.getByRole('button', { name: 'Mostrar contraseña' })).toBeInTheDocument();
  });

  it('acepta una ayuda propia y etiquetas traducidas', () => {
    render(<Controlado hint="Déjala vacía para no cambiarla" mostrarLabel="Show password" requisitos={false} />);
    expect(screen.getByText('Déjala vacía para no cambiarla')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
  });
});
