import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RowActions from '../RowActions';

const acciones = (extra: object = {}) => [
  { id: 'editar', label: 'Editar', tone: 'primary' as const, onClick: vi.fn() },
  { id: 'duplicar', label: 'Duplicar', onClick: vi.fn() },
  { id: 'eliminar', label: 'Eliminar', tone: 'danger' as const, onClick: vi.fn(), ...extra },
];

describe('RowActions — lo destructivo no queda al lado de lo rutinario', () => {
  it('con inline=2 las dos rutinarias van visibles y «Eliminar» se va al menú', () => {
    render(<RowActions inline={2} menuLabel="Acciones: X" actions={acciones()} />);
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Acciones: X' }));
    expect(screen.getByRole('menuitem', { name: 'Eliminar' })).toBeInTheDocument();
  });

  it('aunque la destructiva venga primera, no es la que se ve en línea', () => {
    const a = acciones();
    render(<RowActions menuLabel="Acciones: X" actions={[a[2], a[0]]} />);
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Acciones: X' }));
    expect(screen.getByRole('menuitem', { name: 'Eliminar' })).toBeInTheDocument();
  });

  it('la destructiva va al final del menú, separada por una línea', () => {
    render(<RowActions inline={0} menuLabel="Acciones: X" actions={acciones()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Acciones: X' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map(i => i.textContent)).toEqual(['Editar', 'Duplicar', 'Eliminar']);
    expect(items[2].className).toContain('border-t');
    expect(items[1].className).not.toContain('border-t');
  });

  it('sola (o entre puras destructivas) se muestra como cualquier otra acción', () => {
    render(<RowActions actions={[acciones()[2]]} />);
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();
  });

  it('ejecuta la acción elegida del menú', () => {
    const a = acciones();
    render(<RowActions menuLabel="Acciones: X" actions={a} />);
    fireEvent.click(screen.getByRole('button', { name: 'Acciones: X' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Eliminar' }));
    expect(a[2].onClick).toHaveBeenCalledTimes(1);
  });
});
