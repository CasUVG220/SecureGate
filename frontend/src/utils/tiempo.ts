/**
 * Tiempo relativo corto ("hace 5 min") para listas de actividad.
 *
 * Las horas absolutas siguen disponibles en el título del elemento: en un
 * listado de accesos importa más "hace 5 min" que "14:32", pero el dato exacto
 * no se pierde.
 */
export function tiempoRelativo(
  iso: string,
  t: (key: string, fallback?: string) => string,
  ahora: Date = new Date(),
): string {
  const ms = ahora.getTime() - new Date(iso).getTime();
  const minutos = Math.floor(ms / 60000);

  if (!Number.isFinite(minutos) || minutos < 1) return t('dashboard.justNow');
  if (minutos < 60) return t('dashboard.minutesAgo').replace('{n}', String(minutos));

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return t('dashboard.hoursAgo').replace('{n}', String(horas));

  const dias = Math.floor(horas / 24);
  return t('dashboard.daysAgo').replace('{n}', String(dias));
}

/** Inicial para el avatar de un visitante; cae a "?" si el nombre viene vacío. */
export function inicial(nombre: string | null | undefined): string {
  const limpio = (nombre ?? '').trim();
  return limpio ? limpio[0].toUpperCase() : '?';
}
