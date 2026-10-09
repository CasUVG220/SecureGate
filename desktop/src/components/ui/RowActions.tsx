import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { Spinner } from './Skeleton';

export type RowActionTone = 'default' | 'primary' | 'danger';

export interface RowAction {
  /** Identificador estable; también sirve de `key`. */
  id: string;
  label: string;
  onClick: () => void;
  /** Path de un SVG 24×24 con `stroke="currentColor"`. */
  icon?: string;
  tone?: RowActionTone;
  loading?: boolean;
  disabled?: boolean;
}

export interface RowActionsProps {
  actions: RowAction[];
  /**
   * Cuántas acciones se muestran como botón antes de plegar el resto en el menú.
   * El resto va al desplegable, siempre con su etiqueta escrita. Las de tono `danger`
   * nunca se muestran en línea junto a otras: van siempre al menú.
   */
  inline?: number;
  /** Texto del menú para lectores de pantalla, p. ej. "Acciones de Residencial Demo". */
  menuLabel?: string;
  align?: 'start' | 'end';
  className?: string;
}

const TONE_BUTTON: Record<RowActionTone, string> = {
  default: 'border-gray-600 bg-gray-800 text-gray-200 hover:bg-gray-700 hover:text-gray-50',
  primary: 'border-brand-500/40 bg-brand-500/10 text-brand-400 hover:bg-brand-500/18 hover:text-brand-300',
  danger:  'border-danger-500/40 bg-danger-500/10 text-danger-400 hover:bg-danger-500/18 hover:text-danger-300',
};

const TONE_ITEM: Record<RowActionTone, string> = {
  default: 'text-gray-200 hover:bg-gray-500/12 hover:text-gray-50',
  primary: 'text-brand-400 hover:bg-brand-500/12 hover:text-brand-300',
  danger:  'text-danger-400 hover:bg-danger-500/12 hover:text-danger-300',
};

function Icon({ path }: { path: string }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

/**
 * Acciones de una fila de tabla o del pie de una tarjeta.
 *
 * Sustituye a los enlaces de colores separados por puntos que cada pantalla
 * declaraba por su cuenta: la acción principal queda como botón visible y el
 * resto se pliega en un menú, de modo que "Eliminar" deje de estar a un clic de
 * distancia del resto. Todas las opciones conservan su etiqueta escrita —
 * nunca se reducen a un ícono suelto — porque la tabla la leen administradores
 * que no tienen por qué descifrar glifos.
 */
export default function RowActions({
  actions,
  inline = 1,
  menuLabel = 'Más acciones',
  align = 'end',
  className,
}: RowActionsProps) {
  // Una acción destructiva nunca queda al lado de las rutinarias: si hay de las dos, las destructivas viven
  // en el menú (separadas por una línea). Sola, o entre puras destructivas, se muestra como cualquier otra.
  const destructivas = actions.filter(a => a.tone === 'danger');
  const rutinarias   = actions.filter(a => a.tone !== 'danger');
  const separar      = destructivas.length > 0 && rutinarias.length > 0;
  const visible  = separar ? rutinarias.slice(0, inline) : actions.slice(0, inline);
  const overflow = separar ? [...rutinarias.slice(inline), ...destructivas] : actions.slice(inline);

  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState<{ top: number; left: number } | null>(null);
  const rootRef    = useRef<HTMLDivElement>(null);
  const menuRef    = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId     = useId();

  const MENU_W = 176;
  const GAP    = 6;
  const ITEM_H = 33;

  /**
   * El menú se dibuja en un portal con posición fija: las tablas viven dentro
   * de contenedores con `overflow` y un desplegable absoluto quedaba recortado
   * por ellos. El sitio se calcula al abrir, a partir del disparador, y se
   * voltea hacia arriba o se mete hacia adentro cuando no cabe. El alto se
   * estima de la cantidad de opciones para no tener que medir tras montar.
   */
  const openMenu = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const h = 8 + overflow.length * ITEM_H + (overflow.some(a => a.tone === 'danger') ? 9 : 0);

    const below = r.bottom + GAP;
    const top   = below + h > window.innerHeight - 8 && r.top - GAP - h > 8
      ? r.top - GAP - h
      : below;

    const wanted = align === 'end' ? r.right - MENU_W : r.left;
    const left   = Math.min(Math.max(8, wanted), window.innerWidth - MENU_W - 8);

    setPos({ top, left });
    setOpen(true);
  };

  // Se cierra al hacer clic fuera o con Escape; Escape además devuelve el foco
  // al disparador para no perder el lugar al navegar con teclado. Al desplazar
  // o redimensionar se cierra, en vez de dejar el menú flotando lejos su fila.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onReflow = () => setOpen(false);

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open]);

  const run = (action: RowAction) => {
    setOpen(false);
    action.onClick();
  };

  return (
    <div
      ref={rootRef}
      className={cx('relative flex items-center gap-2', align === 'end' ? 'justify-end' : 'justify-start', className)}
    >
      {visible.map(action => (
        <button
          key={action.id}
          type="button"
          onClick={() => run(action)}
          disabled={action.disabled || action.loading}
          aria-busy={action.loading || undefined}
          className={cx(
            'inline-flex min-h-control-sm items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5',
            'text-xs font-semibold transition-colors duration-150',
            'disabled:cursor-not-allowed disabled:opacity-55',
            TONE_BUTTON[action.tone ?? 'default'],
          )}
        >
          {action.loading ? <Spinner size={12} /> : action.icon && <Icon path={action.icon} />}
          {action.label}
        </button>
      ))}

      {overflow.length > 0 && (
        <>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => (open ? setOpen(false) : openMenu())}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            aria-label={menuLabel}
            className={cx(
              'inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors duration-150',
              open
                ? 'border-gray-500 bg-gray-700 text-gray-50'
                : 'border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-50',
            )}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>

          {open && createPortal(
            <div
              id={menuId}
              ref={menuRef}
              role="menu"
              aria-label={menuLabel}
              style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: MENU_W }}
              className={cx(
                'fixed z-50 overflow-hidden rounded-xl border p-1',
                'border-[rgb(var(--c-hairline))] bg-[rgb(var(--c-surface-raised))] shadow-lg',
                pos ? 'opacity-100' : 'opacity-0',
              )}
            >
              {overflow.map((action, i) => {
                const tone = action.tone ?? 'default';
                // La acción destructiva se separa con una línea para que no se
                // pulse por inercia al venir bajando por el menú.
                const separate = tone === 'danger' && i > 0 && (overflow[i - 1].tone ?? 'default') !== 'danger';
                return (
                  <button
                    key={action.id}
                    type="button"
                    role="menuitem"
                    onClick={() => run(action)}
                    disabled={action.disabled || action.loading}
                    aria-busy={action.loading || undefined}
                    className={cx(
                      'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold',
                      'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55',
                      separate && 'mt-1 border-t border-[rgb(var(--c-hairline))] pt-2.5',
                      TONE_ITEM[tone],
                    )}
                  >
                    {action.loading ? <Spinner size={12} /> : action.icon && <Icon path={action.icon} />}
                    {action.label}
                  </button>
                );
              })}
            </div>,
            document.body,
          )}
        </>
      )}
    </div>
  );
}
