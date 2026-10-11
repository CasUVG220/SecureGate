import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useEffect, useState } from 'react';
import ConfirmDialog from '../ConfirmDialog';
import { useConfirmacion } from '../useConfirmacion';

describe('ConfirmDialog', () => {
  it('nombra la acción en el botón y avisa al confirmar o cancelar', () => {
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    render(<ConfirmDialog open title="¿Eliminar el anuncio?" message="Los residentes dejarán de verlo." confirmLabel="Eliminar" tone="danger" onConfirm={onConfirm} onCancel={onCancel} />);
    const dialogo = screen.getByRole('dialog', { name: '¿Eliminar el anuncio?' });
    expect(dialogo).toHaveTextContent('Los residentes dejarán de verlo.');
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('lo destructivo va en rojo y lo demás en el color de la marca', () => {
    const { rerender } = render(<ConfirmDialog open title="t" confirmLabel="Eliminar" tone="danger" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Eliminar' }).className).toContain('bg-danger-600');
    rerender(<ConfirmDialog open title="t" confirmLabel="Cerrar solicitud" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cerrar solicitud' }).className).toContain('bg-brand-500');
  });

  it('Escape cancela', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="t" confirmLabel="Sí" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('mientras trabaja bloquea los dos botones y no se cierra con Escape', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open loading title="t" confirmLabel="Eliminar" onConfirm={vi.fn()} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('useConfirmacion', () => {
  function Demo({ onResultado }: { onResultado: (v: boolean) => void }) {
    const { confirmar, dialogo } = useConfirmacion();
    const [n, setN] = useState(0);
    return (
      <>
        <button onClick={async () => { const ok = await confirmar({ title: '¿Seguro?', confirmLabel: 'Sí, borrar', tone: 'danger' }); onResultado(ok); setN(x => x + 1); }}>borrar</button>
        <span data-testid="veces">{n}</span>
        {dialogo}
      </>
    );
  }

  it('confirmar() resuelve true al confirmar y el diálogo se cierra', async () => {
    const onResultado = vi.fn();
    render(<Demo onResultado={onResultado} />);
    fireEvent.click(screen.getByText('borrar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, borrar' }));
    await waitFor(() => expect(onResultado).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('resuelve false al cancelar y al cerrar con Escape', async () => {
    const onResultado = vi.fn();
    render(<Demo onResultado={onResultado} />);
    fireEvent.click(screen.getByText('borrar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(onResultado).toHaveBeenLastCalledWith(false));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByText('borrar'));
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onResultado).toHaveBeenCalledTimes(2));
    expect(onResultado).toHaveBeenLastCalledWith(false);
  });

  it('una confirmación nueva cancela la pendiente en vez de dejarla colgada', async () => {
    let capturar!: ReturnType<typeof useConfirmacion>['confirmar'];
    function Captura() {
      const { confirmar, dialogo } = useConfirmacion();
      useEffect(() => { capturar = confirmar; }, [confirmar]);   // fuera del pintado: no se reasigna una variable externa al renderizar
      return <>{dialogo}</>;
    }
    render(<Captura />);
    let primera!: Promise<boolean>;
    act(() => { primera = capturar({ title: 'uno', confirmLabel: 'ok' }); });
    act(() => { void capturar({ title: 'dos', confirmLabel: 'ok' }); });
    await expect(primera).resolves.toBe(false);
    expect(await screen.findByRole('dialog', { name: 'dos' })).toBeInTheDocument();
  });
});
