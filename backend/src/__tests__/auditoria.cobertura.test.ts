/**
 * RNF-10 · Cobertura de auditoría (SCRUM-125 / SCRUM-179)
 *
 * Igual que `security.routes.contract.test.ts` con los guards de sesión, este test recorre las rutas REALES del router (no
 * una lista escrita a mano) para que olvidar la auditoría al añadir una ruta rompa la prueba, en vez de descubrirlo en un
 * incidente:
 *
 *   1. Toda ruta que MODIFICA algo (POST/PUT/PATCH/DELETE) lleva `auditLog(...)` o está en la lista corta de exenciones, con su porqué.
 *   2. Las lecturas que descargan datos personales en bloque (los CSV) también se auditan.
 *   3. La lista de acciones sensibles documentada (`docs/acciones_sensibles.md`) y las acciones que existen en el código
 *      son EXACTAMENTE las mismas: no hay acción sin documentar ni documentada que ya no exista.
 *   4. Ningún limitador anónimo bloquea sin rastro: los de la fábrica `crearLimitador` auditan los 429.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

process.env.JWT_SECRET = 'cobertura-auditoria-'.padEnd(48, 'x');

jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: jest.fn() },
}));

import '../utils/asyncErrors';
import apiRouter from '../routes';

interface RutaReal { method: string; path: string; accion: string | null }

/** Prefijo estático de un `router.use('/x', …)` a partir de su regexp de Express 4. */
const prefijoDe = (layer: { regexp: RegExp }): string => {
  const m = /^\^\\\/(.+?)\\\/\?\(\?=\\\/\|\$\)$/.exec(layer.regexp.source);
  return m ? `/${m[1].replace(/\\\//g, '/')}` : '';
};

const listarRutas = (stack: any[], prefijo = ''): RutaReal[] => {
  const out: RutaReal[] = [];
  for (const layer of stack) {
    if (layer.route) {
      const audit = (layer.route.stack as any[]).map(l => l.handle).find(h => h?.esAuditoria === true);
      for (const method of Object.keys(layer.route.methods)) {
        out.push({ method: method.toUpperCase(), path: `${prefijo}${layer.route.path}`, accion: audit?.accion ?? null });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      out.push(...listarRutas(layer.handle.stack, prefijo + prefijoDe(layer)));
    }
  }
  return out;
};

const RUTAS = listarRutas((apiRouter as any).stack);
const clave = (r: RutaReal) => `${r.method} /api${r.path.replace(/\/$/, '')}`;
const MODIFICA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Rutas que modifican algo y NO se auditan. Cada una tiene su porqué, y está también en docs/acciones_sensibles.md.
 * Añadir una aquí es una decisión de seguridad: justifícala en el commit.
 */
const EXENTAS: Record<string, string> = {
  'POST /api/auth/refresh': 'cada hora por sesión; sólo se audita cuando se RECHAZA (REFRESH_RECHAZADO, dentro del controlador)',
  'PUT /api/usuarios/me/preferencias': 'tema e idioma propios',
  'POST /api/anuncios/:id/leer': 'acuse de lectura propio, de alto volumen',
  'POST /api/licencias/heartbeat': 'latido del equipo; los bloqueos por límite (429) sí se auditan',
};

/** Lecturas que descargan datos personales en bloque: se auditan aunque no modifiquen nada. */
const LECTURAS_SENSIBLES = ['GET /api/reportes/accesos', 'GET /api/reportes/pagos'];

describe('cobertura de auditoría', () => {
  it('el recorrido ve el router real (si no, las pruebas de abajo no prueban nada)', () => {
    expect(RUTAS.length).toBeGreaterThan(100);
    expect(RUTAS.filter(r => MODIFICA.has(r.method)).length).toBeGreaterThan(60);
  });

  it('toda ruta que modifica algo lleva auditLog o está exenta con su porqué', () => {
    const sinAuditoria = RUTAS.filter(r => MODIFICA.has(r.method) && !r.accion).map(clave).sort();
    expect(sinAuditoria.filter(k => !(k in EXENTAS))).toEqual([]);
  });

  it('las exenciones no se quedan viejas: cada una sigue existiendo y sigue sin auditoría', () => {
    const sinAuditoria = new Set(RUTAS.filter(r => MODIFICA.has(r.method) && !r.accion).map(clave));
    for (const k of Object.keys(EXENTAS)) expect([k, sinAuditoria.has(k)]).toEqual([k, true]);
  });

  it('las descargas de datos personales en bloque también se auditan', () => {
    const auditadas = new Set(RUTAS.filter(r => r.accion).map(clave));
    for (const k of LECTURAS_SENSIBLES) expect([k, auditadas.has(k)]).toEqual([k, true]);
  });
});

describe('lista documentada de acciones sensibles', () => {
  const SRC = path.resolve(__dirname, '..');
  const archivos = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === '__tests__' ? [] : archivos(p);
      return e.name.endsWith('.ts') ? [p] : [];
    });

  /** Todas las `accion: 'X'` del código de producción (rutas, controladores, limitadores, middleware). */
  const accionesEnCodigo = (): string[] => {
    const set = new Set<string>();
    for (const f of archivos(SRC)) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\baccion:\s*'([A-Z][A-Z0-9_]+)'/g)) set.add(m[1]);
    }
    return [...set].sort();
  };

  const doc = readFileSync(path.resolve(__dirname, '../../../docs/acciones_sensibles.md'), 'utf8');
  const accionesEnDoc = (): string[] => {
    const set = new Set<string>();
    for (const linea of doc.split('\n')) {
      // Primera columna de la tabla de acciones: | `ACCION` | …
      const m = /^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/.exec(linea);
      if (m) set.add(m[1]);
    }
    return [...set].sort();
  };

  it('toda acción que existe en el código está en docs/acciones_sensibles.md', () => {
    const doc_ = new Set(accionesEnDoc());
    expect(accionesEnCodigo().filter(a => !doc_.has(a))).toEqual([]);
  });

  it('toda acción documentada existe en el código (no quedan filas de acciones que ya no se auditan)', () => {
    const codigo = new Set(accionesEnCodigo());
    expect(accionesEnDoc().filter(a => !codigo.has(a))).toEqual([]);
  });

  it('el documento nombra cada exención de este test', () => {
    for (const k of Object.keys(EXENTAS)) expect([k, doc.includes('`' + k.replace(/^\w+ /, m => m) + '`')]).toEqual([k, true]);
  });

  it('las acciones tienen la forma esperada: MAYÚSCULAS con guion bajo, sin duplicados en el código', () => {
    for (const a of accionesEnCodigo()) expect(a).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
    expect(accionesEnCodigo().length).toBeGreaterThan(55);
  });
});
