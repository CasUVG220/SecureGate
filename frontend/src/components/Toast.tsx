/* eslint-disable react-refresh/only-export-components */
/* Reexporta el sistema de avisos, que ahora vive con el resto del design system.
   Se mantiene la ruta anterior para no romper los imports de las pantallas. */
export { ToastProvider, useToast } from './ui/Toast';
export type { ToastType, ToastItem } from './ui/Toast';
