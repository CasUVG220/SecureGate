/* El hook viaja junto al provider porque comparten el canal de notificaciones. */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { cx } from './cx';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /**
   * No se cierra solo: queda hasta que la persona lo cierre o actúe. Los errores son
   * persistentes por defecto —un fallo que desaparece a los 4 s se pierde si no se
   * estaba mirando la pantalla— y también las confirmaciones con `accion`.
   */
  persistente?: boolean;
  /** Botón dentro del aviso, p. ej. «Ver anuncio»: lleva al elemento recién creado. */
  accion?: ToastAction;
}

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  persistente: boolean;
  accion?: ToastAction;
}

type ShowToast = (message: string, type?: ToastType, opciones?: ToastOptions) => void;

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

/** Duración de un aviso normal. Al pasar el cursor o enfocarlo se detiene (WCAG 2.2.1). */
export const TOAST_DURACION_MS = 4000;
/** Tras soltar el cursor, el aviso se despide en este tiempo. */
const TOAST_DESPEDIDA_MS = 2500;
/** Máximo de avisos a la vez: los más viejos no persistentes se retiran primero. */
const TOAST_MAX = 4;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const temporizadores = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const detener = useCallback((id: number) => {
    const t = temporizadores.current.get(id);
    if (t !== undefined) { clearTimeout(t); temporizadores.current.delete(id); }
  }, []);

  const dismiss = useCallback((id: number) => {
    detener(id);
    setToasts(prev => prev.filter(t => t.id !== id));
  }, [detener]);

  const programar = useCallback((id: number, ms: number) => {
    detener(id);
    temporizadores.current.set(id, setTimeout(() => dismiss(id), ms));
  }, [detener, dismiss]);

  const show = useCallback<ShowToast>((message, type = 'success', opciones) => {
    const id = nextId.current++;
    const persistente = opciones?.persistente ?? (type === 'error' || !!opciones?.accion);
    const item: ToastItem = { id, message, type, persistente, accion: opciones?.accion };
    setToasts(prev => {
      const next = [...prev, item];
      // Con demasiados avisos, se retira el más viejo que no sea persistente.
      while (next.length > TOAST_MAX) {
        const i = next.findIndex(t => !t.persistente);
        if (i === -1) break;
        next.splice(i, 1);
      }
      return next;
    });
    if (!persistente) programar(id, TOAST_DURACION_MS);
  }, [programar]);

  useEffect(() => {
    const mapa = temporizadores.current;
    return () => { mapa.forEach(clearTimeout); mapa.clear(); };
  }, []);

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
            onMouseEnter={() => detener(t.id)}
            onMouseLeave={() => { if (!t.persistente) programar(t.id, TOAST_DESPEDIDA_MS); }}
            onFocus={() => detener(t.id)}
            onBlur={() => { if (!t.persistente) programar(t.id, TOAST_DESPEDIDA_MS); }}
            className={cx(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-gray-800 px-4 py-3 shadow-lg',
              'animate-sg-scale-in',
              STYLE[t.type].cls,
            )}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden="true">
              <path d={STYLE[t.type].icon} />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-100">{t.message}</p>
              {t.accion && (
                <button
                  type="button"
                  onClick={() => { t.accion!.onClick(); dismiss(t.id); }}
                  className="mt-1.5 text-sm font-semibold text-gray-50 underline underline-offset-4 hover:text-brand-300"
                >
                  {t.accion.label}
                </button>
              )}
            </div>
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
