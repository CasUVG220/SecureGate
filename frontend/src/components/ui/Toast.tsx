/* El hook viaja junto al provider porque comparten el canal de notificaciones. */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { cx } from './cx';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

type ShowToast = (message: string, type?: ToastType) => void;

const ToastContext = createContext<ShowToast>(() => {});

/** Único canal de avisos de la app: éxito, error, advertencia e informativo. */
export function useToast(): ShowToast {
  return useContext(ToastContext);
}

const STYLE: Record<ToastType, { cls: string; icon: string }> = {
  success: { cls: 'border-success-500/40 bg-success-500/12 text-success-400', icon: 'M20 6L9 17l-5-5' },
  error:   { cls: 'border-danger-500/40 bg-danger-500/12 text-danger-400',   icon: 'M12 8v5M12 16h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z' },
  warning: { cls: 'border-warning-500/40 bg-warning-500/12 text-warning-400', icon: 'M12 9v4M12 17h.01M12 3a9 9 0 100 18 9 9 0 000-18z' },
  info:    { cls: 'border-brand-500/40 bg-brand-500/12 text-brand-400',       icon: 'M12 16v-4M12 8h.01M12 3a9 9 0 100 18 9 9 0 000-18z' },
};

const DURATION_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const show = useCallback<ShowToast>((message, type = 'success') => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => dismiss(id), DURATION_MS);
  }, [dismiss]);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-4 z-toast flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:items-end"
        role="region"
        aria-label="Notificaciones"
      >
        {toasts.map(t => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            className={cx(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-gray-800 px-4 py-3 shadow-lg',
              'animate-sg-scale-in',
              STYLE[t.type].cls,
            )}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden="true">
              <path d={STYLE[t.type].icon} />
            </svg>
            <p className="min-w-0 flex-1 text-sm font-medium text-gray-100">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Cerrar aviso"
              className="-mr-1 -mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-500/12 hover:text-gray-100"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
