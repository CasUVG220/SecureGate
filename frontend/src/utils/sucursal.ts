/** Tipos de sucursal que ofrece el formulario. La base guarda la clave en minúsculas (columna `sucursales.tipo`). */
export const TIPOS_SUCURSAL = ['residencial', 'condominio', 'edificio', 'comercial', 'oficinas', 'otro'] as const;
export type TipoSucursal = (typeof TIPOS_SUCURSAL)[number];

export const esTipoConocido = (tipo: string | null | undefined): tipo is TipoSucursal =>
  !!tipo && (TIPOS_SUCURSAL as readonly string[]).includes(tipo);

/**
 * Cómo se lee el tipo en una tabla: los conocidos traducidos; uno escrito a mano antes de que existiera la lista
 * se muestra tal cual (no se pierde ni se adivina); sin tipo, una raya.
 */
export const etiquetaTipoSucursal = (t: (clave: string) => string, tipo: string | null | undefined): string => {
  if (!tipo) return '—';
  return esTipoConocido(tipo) ? t(`sucursal.tipo.${tipo}`) : tipo;
};
