import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorState from '../ErrorState';

describe('ErrorState', () => {
  it('se anuncia como alerta, a diferencia de un estado vacío', () => {
    render(<ErrorState title="Algo no está funcionando" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Algo no está funcionando');
  });

  it('muestra código, descripción y acción', () => {
    const onClick = vi.fn();
    render(
      <ErrorState
        variant="notFound"
        code="404"
        title="Página no encontrada"
        description="La sección que buscas no existe."
        action={<button onClick={onClick}>Volver</button>}
      />
    );
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('La sección que buscas no existe.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('el detalle técnico se muestra aparte y en monoespaciada', () => {
    render(<ErrorState title="Error" detail="Error al cargar el resumen del mes" />);
    const detalle = screen.getByText('Error al cargar el resumen del mes');
    expect(detalle).toHaveClass('font-mono');
  });

  it('sin código ni detalle no pinta esos bloques', () => {
    const { container } = render(<ErrorState title="Error" />);
    expect(container.querySelector('.font-mono')).toBeNull();
    expect(container.querySelector('.tabular-nums')).toBeNull();
  });

  it('cada variante usa su tono semántico', () => {
    const { container, rerender } = render(<ErrorState variant="error" title="X" />);
    expect(container.querySelector('span')).toHaveClass('text-danger-400');

    rerender(<ErrorState variant="notFound" title="X" />);
    expect(container.querySelector('span')).toHaveClass('text-gray-400');

    rerender(<ErrorState variant="offline" title="X" />);
    expect(container.querySelector('span')).toHaveClass('text-warning-400');
  });
});
