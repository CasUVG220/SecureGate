import type { ReactNode } from 'react';

/**
 * Dato que falta confirmar (correo, WhatsApp, razón social, tiempos…). Se muestra A PROPÓSITO, rayado y con el
 * texto «[POR CONFIRMAR: …]», para que nadie lo tome por un dato real y para que se encuentre fácil antes de
 * publicar. El inventario está en docs/landing.md. Nunca se rellena con un dato inventado.
 */
export function Pendiente({ children }: { children: ReactNode }) {
  return <mark className="l-pendiente">[POR CONFIRMAR: {children}]</mark>;
}
