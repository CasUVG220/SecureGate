import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Button from '../Button';

describe('Button', () => {
  it('render: muestra el contenido y por defecto es type="button"', () => {
    render(<Button>Guardar</Button>);
    const btn = screen.getByRole('button', { name: 'Guardar' });
    expect(btn).toBeInTheDocument();
    // Sin type explícito un <button> dentro de un form haría submit sin querer.
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('variantes: cada una aplica su paleta semántica', () => {
    const { rerender } = render(<Button variant="primary">Acción</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-brand-500');

    rerender(<Button variant="danger">Acción</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-danger-500');

    rerender(<Button variant="secondary">Acción</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-gray-800');

    rerender(<Button variant="ghost">Acción</Button>);
    expect(screen.getByRole('button').className).toContain('text-gray-300');
  });

  it('tamaños: cambian la altura mínima del control', () => {
    const { rerender } = render(<Button size="sm">A</Button>);
    expect(screen.getByRole('button')).toHaveClass('min-h-control-sm');

    rerender(<Button size="lg">A</Button>);
    expect(screen.getByRole('button')).toHaveClass('min-h-control-lg');
  });

  it('loading: bloquea el botón, marca aria-busy y muestra el spinner', () => {
    const onClick = vi.fn();
    const { container } = render(<Button loading onClick={onClick}>Guardando</Button>);
    const btn = screen.getByRole('button');

    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('svg.animate-spin')).toBeTruthy();

    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading: el ícono cede su lugar al spinner', () => {
    const icon = <svg data-testid="icono" />;
    const { rerender, queryByTestId } = render(<Button icon={icon}>Enviar</Button>);
    expect(queryByTestId('icono')).toBeTruthy();

    rerender(<Button icon={icon} loading>Enviar</Button>);
    expect(queryByTestId('icono')).toBeNull();
  });

  it('disabled: no dispara onClick', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Guardar</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('click: dispara onClick cuando está habilitado', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Guardar</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
