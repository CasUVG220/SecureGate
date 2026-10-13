/**
 * Exportación de los datos de UNA empresa en un .zip de CSV (T12, portabilidad).
 *
 * Alcance: todo se filtra por `empresa_id` (directo o a través de `sucursales`); no hay consulta sin ese filtro. Se exporta lo que la empresa
 * entregó o generó con su operación —sucursales, personal, residentes, visitas, pagos, garitas, plan y facturas— y NUNCA secretos: ni hashes de
 * contraseña, ni secretos de verificación en dos pasos, ni tokens, ni códigos de activación o huellas de equipos.
 * Contiene datos personales (nombres, DPI, teléfonos): el archivo lo descarga el responsable de la empresa y la descarga queda auditada.
 *
 * Las tablas se leen por lotes con paginación por clave (`id > último`), sin cargarlas completas en memoria.
 */
import { APP_TZ } from '../utils/reservas';
import { BOM, filaCsv } from '../utils/csv';
import { ZipStream } from '../utils/zip';
import type { Consultable } from './suscripciones';

const LOTE = 2000;

/** Instante en hora de Guatemala, legible y sin ambigüedad de zona. */
const gt = (col: string): string => `to_char(${col} AT TIME ZONE '${APP_TZ}', 'YYYY-MM-DD HH24:MI:SS')`;

export interface ConjuntoDatos {
  archivo: string;
  columnas: string[];
  /** SELECT con `$1` = empresa y la columna `id` primera; debe terminar en `AND <alias>.id > $2 ORDER BY <alias>.id LIMIT $3`. */
  sql: string;
}

export const CONJUNTOS: ConjuntoDatos[] = [
  {
    archivo: 'sucursales.csv',
    columnas: ['id', 'nombre', 'direccion', 'tipo', 'activo', 'creada_en'],
    sql: `SELECT s.id, s.nombre, s.direccion, s.tipo, s.activo, ${gt('s.created_at')} AS creada_en
            FROM sucursales s WHERE s.empresa_id = $1 AND s.id > $2 ORDER BY s.id LIMIT $3`,
  },
  {
    archivo: 'usuarios.csv',
    columnas: ['id', 'nombre', 'email', 'rol', 'sucursal_id', 'activo', 'creado_en'],
    sql: `SELECT u.id, u.nombre, u.email, u.rol, u.sucursal_id, u.activo, ${gt('u.created_at')} AS creado_en
            FROM usuarios u LEFT JOIN sucursales s ON s.id = u.sucursal_id
           WHERE (u.empresa_id = $1 OR s.empresa_id = $1) AND u.id > $2 ORDER BY u.id LIMIT $3`,
  },
  {
    archivo: 'residentes.csv',
    columnas: ['id', 'sucursal_id', 'nombre', 'email', 'numero_casa', 'telefono', 'estado_pago', 'saldo_pendiente'],
    sql: `SELECT r.id, r.sucursal_id, u.nombre, u.email, r.numero_casa, r.telefono, r.estado_pago, r.saldo_pendiente
            FROM residentes r JOIN usuarios u ON u.id = r.usuario_id JOIN sucursales s ON s.id = r.sucursal_id
           WHERE s.empresa_id = $1 AND r.id > $2 ORDER BY r.id LIMIT $3`,
  },
  {
    archivo: 'visitas.csv',
    columnas: ['id', 'sucursal_id', 'residente_id', 'visitante', 'dpi', 'tipo', 'entrada', 'salida', 'autorizado', 'notas'],
    sql: `SELECT ra.id, ra.sucursal_id, ra.residente_id, v.nombre AS visitante, v.numero_dpi AS dpi, ra.tipo,
                 ${gt('ra.timestamp_entrada')} AS entrada, ${gt('ra.timestamp_salida')} AS salida, ra.autorizado, ra.notas
            FROM registros_acceso ra JOIN sucursales s ON s.id = ra.sucursal_id JOIN visitantes v ON v.id = ra.visitante_id
           WHERE s.empresa_id = $1 AND ra.id > $2 ORDER BY ra.id LIMIT $3`,
  },
  {
    archivo: 'pagos.csv',
    columnas: ['id', 'sucursal_id', 'residente_id', 'monto', 'metodo', 'estado', 'concepto', 'referencia', 'fecha_pago'],
    sql: `SELECT p.id, p.sucursal_id, p.residente_id, p.monto, p.metodo, p.estado, p.concepto, p.referencia, ${gt('p.fecha_pago')} AS fecha_pago
            FROM pagos p JOIN sucursales s ON s.id = p.sucursal_id WHERE s.empresa_id = $1 AND p.id > $2 ORDER BY p.id LIMIT $3`,
  },
  {
    // Sin código de activación ni huella del equipo: son credenciales.
    archivo: 'garitas.csv',
    columnas: ['id', 'sucursal_id', 'etiqueta', 'estado', 'activada_en', 'ultimo_contacto', 'creada_en'],
    sql: `SELECT l.id, l.sucursal_id, l.etiqueta, l.estado, ${gt('l.activado_en')} AS activada_en, ${gt('l.ultimo_heartbeat')} AS ultimo_contacto, ${gt('l.created_at')} AS creada_en
            FROM licencias_dispositivo l JOIN sucursales s ON s.id = l.sucursal_id WHERE s.empresa_id = $1 AND l.id > $2 ORDER BY l.id LIMIT $3`,
  },
  {
    archivo: 'facturas_saas.csv',
    columnas: ['id', 'numero', 'periodo', 'plan', 'cuota_centavos', 'visitas', 'visitas_incluidas', 'excedente_centavos', 'total_centavos', 'moneda', 'estado', 'emitida_en', 'vence_en', 'pagada_en', 'metodo_pago', 'referencia_pago'],
    sql: `SELECT f.id, f.numero, f.periodo, f.plan_nombre AS plan, f.cuota_centavos, f.visitas, f.visitas_incluidas, f.excedente_centavos, f.total_centavos, f.moneda,
                 f.estado, ${gt('f.emitida_en')} AS emitida_en, to_char(f.vence_en, 'YYYY-MM-DD') AS vence_en, ${gt('f.pagada_en')} AS pagada_en, f.metodo_pago, f.referencia_pago
            FROM facturas_saas f WHERE f.empresa_id = $1 AND f.id > $2 ORDER BY f.id LIMIT $3`,
  },
];

const ID_INICIAL = '00000000-0000-0000-0000-000000000000';

/** Lee un conjunto por lotes y lo entrega como texto CSV (con encabezado). Devuelve también cuántas filas hubo mediante `contar`. */
export async function* csvDeConjunto(db: Consultable, empresaId: string, c: ConjuntoDatos, contar: (n: number) => void): AsyncGenerator<string> {
  yield BOM + filaCsv(c.columnas);
  let ultimo = ID_INICIAL;
  for (;;) {
    const r = await db.query(c.sql, [empresaId, ultimo, LOTE]);
    if (r.rows.length === 0) return;
    let lote = '';
    for (const fila of r.rows as Array<Record<string, unknown>>) lote += filaCsv(c.columnas.map(k => fila[k]));
    contar(r.rows.length);
    yield lote;
    ultimo = (r.rows[r.rows.length - 1] as { id: string }).id;
    if (r.rows.length < LOTE) return;
  }
}

/** Datos de la empresa y su plan en un par de CSV de una fila. */
async function* csvEmpresa(db: Consultable, empresaId: string): AsyncGenerator<string> {
  const r = await db.query(
    `SELECT e.id, e.nombre, e.nit, e.activo, e.suspendida, ${gt('e.created_at')} AS creada_en,
            p.codigo AS plan, su.estado AS estado_suscripcion, ${gt('su.inicio_en')} AS suscrita_en
       FROM empresas e LEFT JOIN suscripciones su ON su.empresa_id = e.id LEFT JOIN planes p ON p.id = su.plan_id WHERE e.id = $1`, [empresaId]);
  const cols = ['id', 'nombre', 'nit', 'activo', 'suspendida', 'creada_en', 'plan', 'estado_suscripcion', 'suscrita_en'];
  yield BOM + filaCsv(cols);
  for (const f of r.rows as Array<Record<string, unknown>>) yield filaCsv(cols.map(k => f[k]));
}

export interface ResumenExportacion { empresa: string; archivos: Record<string, number>; generado_en: string }

/** Escribe el .zip completo en `zip`. Devuelve el resumen de filas por archivo. */
export async function exportarEmpresa(db: Consultable, empresaId: string, nombreEmpresa: string, zip: ZipStream): Promise<ResumenExportacion> {
  const archivos: Record<string, number> = {};
  const generado = await db.query(`SELECT ${gt('NOW()')} AS ahora`);
  const resumen: ResumenExportacion = { empresa: nombreEmpresa, archivos, generado_en: generado.rows[0].ahora };

  await zip.agregar('empresa.csv', csvEmpresa(db, empresaId));
  archivos['empresa.csv'] = 1;
  for (const c of CONJUNTOS) {
    archivos[c.archivo] = 0;
    await zip.agregar(c.archivo, csvDeConjunto(db, empresaId, c, n => { archivos[c.archivo] += n; }));
  }
  const leeme = [
    `Exportación de datos de ${nombreEmpresa}`,
    `Generada: ${resumen.generado_en} (hora de Guatemala)`,
    '',
    'Archivos (CSV, UTF-8; ábrelos con Excel, Sheets o cualquier editor):',
    ...Object.entries(archivos).map(([a, n]) => `  - ${a}: ${n} fila(s)`),
    '',
    'Esta exportación contiene DATOS PERSONALES de residentes, visitantes y personal (nombres, DPI, teléfonos, correos). Trátala con cuidado y guárdala cifrada.',
    'No incluye contraseñas, códigos de verificación, códigos de activación de garitas ni fotografías.',
    'Las fechas están en hora de Guatemala. Los montos de las facturas de SecureGate están en centavos (divide entre 100 para quetzales).',
    'Las celdas que empezaban con = + - o @ llevan un apóstrofo al inicio para que las hojas de cálculo no las ejecuten como fórmulas.',
    '',
  ].join('\r\n');
  await zip.agregar('LEEME.txt', [BOM + leeme]);
  return resumen;
}
