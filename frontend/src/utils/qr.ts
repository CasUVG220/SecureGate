/**
 * Código de invitación QR escrito o pegado A MANO (cuando no hay cámara o no enfoca).
 *
 * El QR contiene `SGQR:<id>` (ver QrInviteModal). Aquí se acepta eso mismo y también
 * el id solo, con o sin guiones, con espacios y en mayúsculas o minúsculas, que es
 * como lo pega alguien desde un mensaje. Devuelve el UUID canónico o `null`.
 * (La app de escritorio tiene la misma regla en `desktop/src/lib/camaras.ts`.)
 */
export const QR_PREFIX = 'SGQR:';

export function idDeCodigoManual(texto: string): string | null {
  const sinPrefijo = texto.trim().replace(/^sgqr:/i, '');
  const hex = sinPrefijo.replace(/[\s-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
