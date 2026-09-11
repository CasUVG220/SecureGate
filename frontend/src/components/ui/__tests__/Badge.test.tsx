import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Badge from '../Badge';
import { ESTADO_PAGO_TONE } from '../estados';

describe('Badge', () => {
  it('render: muestra el texto del estado', () => {
    render(<Badge>Aprobado</Badge>);
    expect(screen.getByText('Aprobado')).toBeInTheDocument();
  });

  it('tonos: cada uno usa su color semántico', () => {
    const { rerender, container } = render(<Badge tone="success">Al día</Badge>);
    expect(container.firstChild).toHaveClass('text-success-400');

    rerender(<Badge tone="danger">Mora</Badge>);
    expect(container.firstChild).toHaveClass('text-danger-400');

    rerender(<Badge tone="warning">Pendiente</Badge>);
    expect(container.firstChild).toHaveClass('text-warning-400');

    rerender(<Badge tone="info">Nuevo</Badge>);
    expect(container.firstChild).toHaveClass('text-brand-400');

    rerender(<Badge>Anulado</Badge>);
    expect(container.firstChild).toHaveClass('text-gray-300');
  });

  it('dot: añade el punto decorativo solo cuando se pide', () => {
    const { container, rerender } = render(<Badge>Sin punto</Badge>);
    expect(container.querySelectorAll('span')).toHaveLength(1);

    rerender(<Badge dot>Con punto</Badge>);
    expect(container.querySelectorAll('span')).toHaveLength(2);
    // El punto es decorativo: no debe leerse en un lector de pantalla.
    expect(container.querySelector('span span')).toHaveAttribute('aria-hidden', 'true');
  });

  it('estados de pago: el mapa compartido cubre los valores del backend', () => {
    expect(ESTADO_PAGO_TONE.al_dia).toBe('success');
    expect(ESTADO_PAGO_TONE.aprobado).toBe('success');
    expect(ESTADO_PAGO_TONE.pendiente).toBe('warning');
    expect(ESTADO_PAGO_TONE.mora).toBe('danger');
    expect(ESTADO_PAGO_TONE.rechazado).toBe('danger');
  });
});
