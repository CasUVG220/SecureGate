/** Une clases condicionales sin arrastrar una dependencia por algo de 4 líneas. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
