/**
 * CSV para exportaciones (RFC 4180 + salvaguardas).
 *
 * - Una celda que empieza con `=`, `+`, `-`, `@`, tabulador o retorno de carro se interpretaría como FÓRMULA en Excel/Sheets (inyección de
 *   fórmulas: un visitante registrado como `=HYPERLINK(...)` ejecutaría algo en la computadora de quien abra la exportación). Se le antepone `'`.
 * - Se cita toda celda con coma, comilla, salto de línea o espacios al borde; las comillas se duplican.
 * - Salto de línea `\r\n`, y un BOM UTF-8 al inicio del archivo para que Excel respete las tildes.
 */
export const BOM = '﻿';

const PELIGROSO = /^[=+\-@\t\r]/;

export function celdaCsv(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  if (PELIGROSO.test(s)) s = `'${s}`;
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const filaCsv = (valores: unknown[]): string => valores.map(celdaCsv).join(',') + '\r\n';
