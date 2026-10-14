import type { ReactNode } from 'react';

/**
 * Íconos lineales del landing: trazos de Lucide (licencia ISC) escritos a mano, como hace la app con su mapa ICON,
 * para no sumar una dependencia por diez figuras. Uno solo por uso y siempre junto a un texto: nunca un ícono suelto
 * ni dentro de un círculo de color.
 */
const TRAZOS = {
  flecha: <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  copiar: <><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>,
  listo: <path d="M20 6 9 17l-5-5" />,
  mensaje: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
  correo: <><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>,
  pausa: <><rect x="14" y="4" width="4" height="16" rx="1" /><rect x="6" y="4" width="4" height="16" rx="1" /></>,
  reproducir: <path d="M6 3 20 12 6 21Z" />,
  documento: <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M16 13H8" /><path d="M16 17H8" /></>,
  cerrar: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  // El escudo del logo es el mismo trazo que usa la app en su cabecera (App.tsx, ICON.shield).
  escudo: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
} satisfies Record<string, ReactNode>;

export type NombreIcono = keyof typeof TRAZOS;

export function Icono({ nombre, tamano = 20, grosor = 1.75, className }: {
  nombre: NombreIcono;
  tamano?: number;
  grosor?: number;
  className?: string;
}) {
  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={grosor}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {TRAZOS[nombre]}
    </svg>
  );
}
