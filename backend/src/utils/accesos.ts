/**
 * Accesos para los listados de la web (Sprint 10, seguimiento del ANPR): cómo se capturó cada uno y con qué datos se muestra, para
 * que el administrador pueda auditar también lo que el sistema abrió solo.
 *
 * El MÉTODO se deduce de columnas que ya existen (no hay columna nueva): ANPR = `origen = 'anpr'`; QR = `invitacion_qr_id`;
 * manual = `capturado_manualmente`; clic = el resto (el DPI o la placa se leyeron con el OCR de la garita). Alias `ra`.
 */
import { sqlPlacaNormalizada } from './placa';

export const METODOS_ACCESO = ['manual', 'clic', 'qr', 'anpr'] as const;
export type MetodoAcceso = (typeof METODOS_ACCESO)[number];

export const esMetodoAcceso = (v: unknown): v is MetodoAcceso => typeof v === 'string' && (METODOS_ACCESO as readonly string[]).includes(v);

export const METODO_SQL = `CASE WHEN ra.origen = 'anpr' THEN 'anpr'
  WHEN ra.invitacion_qr_id IS NOT NULL THEN 'qr'
  WHEN ra.capturado_manualmente THEN 'manual'
  ELSE 'clic' END`;

/** Rótulo en pantalla y en los CSV (glosario: «Automático (placas)», «Verificado por agente»). */
export const METODO_TEXTO: Record<MetodoAcceso, string> = {
  anpr: 'Automático (placas)',
  qr: 'QR',
  manual: 'Manual',
  clic: 'Clic',
};

/**
 * Quién entró y con qué placa: el visitante (si lo hay) o el residente con su vehículo autorizado (ANPR). Requiere `ra`; deja
 * `v` (visitante), `ve` (vehículo del visitante), `vr` (vehículo del residente), `r` (residente) y `ur` (su usuario).
 */
export const JOINS_ACCESO = `LEFT JOIN visitantes v ON v.id = ra.visitante_id
  LEFT JOIN vehiculos ve ON ve.id = ra.vehiculo_id
  LEFT JOIN vehiculos_residentes vr ON vr.id = ra.vehiculo_residente_id
  JOIN residentes r ON r.id = ra.residente_id
  JOIN usuarios ur ON ur.id = r.usuario_id`;

/** Placa canónica del acceso (la del residente o la del visitante, normalizada también en filas antiguas). */
export const PLACA_ACCESO_SQL = `COALESCE(vr.placa, ${sqlPlacaNormalizada('ve.placa')})`;

/** ¿Hay evidencia vigente de ese tipo para el acceso? Misma sucursal que el registro (multi-tenant). */
export const evidenciaSql = (tipo: 'placa' | 'vehiculo') =>
  `EXISTS (SELECT 1 FROM evidencias_anpr e WHERE e.id_cliente = ra.id_cliente AND e.sucursal_id = ra.sucursal_id
             AND e.tipo = '${tipo}' AND e.expira_en > NOW())`;
