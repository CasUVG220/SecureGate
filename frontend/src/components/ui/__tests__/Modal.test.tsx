import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Modal from '../Modal';

const renderModal = (props: Partial<React.ComponentProps<typeof Modal>> = {}) => {
  const onClose = vi.fn();
  const utils = render(
    <Modal open onClose={onClose} title="Registrar pago" {...props}>
      <input aria-label="Monto" />
    </Modal>
  );
  return { onClose, ...utils };
};

describe('Modal', () => {
  it('cerrado: no renderiza nada', () => {
    render(<Modal open={false} onClose={() => {}} title="Oculto">contenido</Modal>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('abierto: renderiza un diálogo accesible con su título', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Registrar pago');
    expect(screen.getByText('Registrar pago')).toBeInTheDocument();
  });

  it('Escape cierra el diálogo', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clic en el fondo cierra el diálogo', () => {
    const { onClose, container } = renderModal();
    const overlay = container.firstChild as HTMLElement;

    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('arrastrar desde dentro hasta el fondo NO cierra', () => {
    // Seleccionar texto dentro del formulario y soltar sobre el overlay cerraba
    // el diálogo a mitad de la captura de datos.
    const { onClose, container } = renderModal();
    const overlay = container.firstChild as HTMLElement;

    fireEvent.mouseDown(screen.getByRole('dialog'));
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('el botón de cerrar llama a onClose', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByLabelText('Cerrar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismissible=false: ignora Escape, el fondo y oculta el botón de cerrar', () => {
    const { onClose, container } = renderModal({ dismissible: false });

    fireEvent.keyDown(document, { key: 'Escape' });
    const overlay = container.firstChild as HTMLElement;
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Cerrar')).toBeNull();
  });

  it('bloquea el scroll del fondo mientras está abierto', () => {
    const { unmount } = renderModal();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('animación de salida: se desmonta después de la transición', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<Modal open onClose={() => {}} title="Salida">contenido</Modal>);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      rerender(<Modal open={false} onClose={() => {}} title="Salida">contenido</Modal>);
      // Sigue montado mientras la animación corre…
      expect(screen.queryByRole('dialog')).not.toBeNull();

      act(() => { vi.advanceTimersByTime(300); });
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
