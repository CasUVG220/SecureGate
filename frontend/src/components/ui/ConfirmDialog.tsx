import Button from './Button';
import Modal from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Qué va a pasar y a quién, en una o dos frases. */
  message?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` para lo que borra o no se puede deshacer; `primary` para el resto. */
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmación de la app. Sustituye a `window.confirm`, que es un cuadro del navegador: no lleva la
 * marca ni el tema, no se puede traducir ni probar, y su botón «Aceptar» no dice qué va a pasar.
 * Aquí el botón nombra la acción («Eliminar», «Revocar») y las destructivas van en rojo.
 */
export default function ConfirmDialog({
  open, title, message, confirmLabel, cancelLabel = 'Cancelar', tone = 'primary', loading = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      dismissible={!loading}
      size="sm"
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      }
    >
      {message && <div className="text-sm text-gray-300">{message}</div>}
    </Modal>
  );
}
