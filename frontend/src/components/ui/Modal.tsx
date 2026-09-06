import { useCallback, useEffect, useRef, useState } from 'react';
import { cx } from './cx';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Barra fija al pie: botones de confirmar/cancelar. */
  footer?: React.ReactNode;
  size?: ModalSize;
  /** Desactiva cerrar con Escape o clic fuera (p. ej. mientras se guarda). */
  dismissible?: boolean;
  className?: string;
}

const SIZE: Record<ModalSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
};

const ANIMATION_MS = 180;

/**
 * Diálogo modal de la app.
 *
 * Cierra con Escape y con clic en el fondo, pero el clic se valida contra el
 * elemento donde empezó la pulsación (`mousedown`): arrastrar una selección de
 * texto desde dentro del diálogo hasta el overlay ya no lo cerraba a mitad de
 * un formulario — el mismo problema que se corrigió en el chat de tickets.
 *
 * En móvil entra como hoja desde abajo; en escritorio, centrado.
 */
export default function Modal({
  open, onClose, title, description, children, footer, size = 'md', dismissible = true, className,
}: ModalProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const pressStartedInside = useRef(false);
  const lastFocused = useRef<HTMLElement | null>(null);

  // Se mantiene montado durante la animación de salida.
  // Abrir monta en el acto (estado derivado durante el render); cerrar mantiene
  // el diálogo montado el tiempo de la animación de salida.
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(false);
    const timer = setTimeout(() => setMounted(false), ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [open]);

  const requestClose = useCallback(() => { if (dismissible) onClose(); }, [dismissible, onClose]);

  useEffect(() => {
    if (!mounted) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mounted, requestClose]);

  // Bloquea el scroll del fondo y devuelve el foco al abridor al cerrar.
  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]), select, textarea, button, [href], [tabindex]:not([tabindex="-1"])'
      );
      (target ?? panelRef.current)?.focus();
    }, ANIMATION_MS);
    return () => {
      document.body.style.overflow = previousOverflow;
      clearTimeout(focusTimer);
      lastFocused.current?.focus?.();
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      className={cx(
        'sg-drawer-backdrop fixed inset-0 z-modal flex items-end justify-center transition-opacity duration-150 sm:items-center sm:p-4',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      onMouseDown={e => { pressStartedInside.current = panelRef.current?.contains(e.target as Node) ?? false; }}
      onClick={e => {
        // Sólo cierra si el clic empezó y terminó en el fondo: un click
        // originado en un control interno (incluido el de teclado, que no
        // emite mousedown) burbujea hasta aquí y cerraría el diálogo.
        if (e.target === e.currentTarget && !pressStartedInside.current) requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cx(
          'flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-gray-600 bg-gray-800 shadow-xl outline-none',
          'transition-all duration-200 sm:rounded-2xl',
          visible ? 'translate-y-0 opacity-100 sm:scale-100' : 'translate-y-4 opacity-0 sm:scale-[0.98]',
          SIZE[size],
          className,
        )}
      >
        {(title || dismissible) && (
          <div className="flex items-start justify-between gap-4 border-b border-gray-700 px-5 py-4">
            <div className="min-w-0">
              {title && <h2 className="text-base font-bold tracking-tight text-gray-50">{title}</h2>}
              {description && <p className="mt-0.5 text-sm text-gray-400">{description}</p>}
            </div>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-500/12 hover:text-gray-100"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer && (
          <div className="flex flex-wrap justify-end gap-3 border-t border-gray-700 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
