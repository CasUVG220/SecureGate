/**
 * Paths de los íconos que usan las acciones de fila (`RowActions`).
 *
 * Viven aparte del componente porque un archivo que exporta componentes y
 * constantes a la vez rompe el fast refresh de Vite.
 * Todos son SVG de 24×24 pensados para `stroke="currentColor"`.
 */
export const ROW_ICON = {
  view:    'M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  edit:    'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
  trash:   'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6',
  user:    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM19 8v6M22 11h-6',
  pause:   'M10 15V9M14 15V9M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  play:    'M10 8l6 4-6 4V8zM12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  check:   'M20 6L9 17l-5-5',
  close:   'M18 6L6 18M6 6l12 12',
  history: 'M3 3v5h5M3.05 13a9 9 0 1 0 2.13-5.66L3 8M12 7v5l4 2',
  clock:   'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
} as const;
