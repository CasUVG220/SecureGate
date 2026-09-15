/**
 * Copia el kit de UI de la web (frontend/src/components/ui + el hook que usa)
 * a la app de escritorio, byte a byte.
 *
 *   node scripts/sync-ui.mjs           # copia
 *   node scripts/sync-ui.mjs --check   # falla si desktop/ quedó desfasado
 *
 * Por qué copiar y no importar `../frontend/src/...` desde Vite: los
 * componentes importan `react`, y un archivo bajo frontend/ lo resolvería
 * desde frontend/node_modules → dos copias de React en el bundle y "Invalid
 * hook call". Se puede parchear con alias/dedupe, pero obliga a tener
 * frontend/node_modules instalado en cada máquina que compile la app. Una
 * copia verificada es más barata hasta que exista un paquete compartido
 * (S9). Los tokens y el CSS no tienen ese problema y sí se importan directo
 * (tailwind.config.ts, src/index.css).
 *
 * `src/components/ui/__tests__/sync.test.ts` corre el --check en `npm test`.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, '..');
const FRONTEND = path.resolve(DESKTOP, '..', 'frontend', 'src');

/** [origen, destino] — directorios completos o archivos sueltos. */
export const PARES = [
  [path.join(FRONTEND, 'components', 'ui'), path.join(DESKTOP, 'src', 'components', 'ui')],
  [path.join(FRONTEND, 'hooks', 'useMediaQuery.ts'), path.join(DESKTOP, 'src', 'hooks', 'useMediaQuery.ts')],
];

/** Los tests de la web no se copian: la app tiene los suyos. */
const EXCLUIR = new Set(['__tests__']);

function listar(dir, base = dir) {
  const out = [];
  for (const nombre of readdirSync(dir)) {
    if (EXCLUIR.has(nombre)) continue;
    const abs = path.join(dir, nombre);
    if (statSync(abs).isDirectory()) out.push(...listar(abs, base));
    else out.push(path.relative(base, abs));
  }
  return out.sort();
}

/** Devuelve la lista de diferencias (vacía si está sincronizado). */
export function diferencias() {
  const difs = [];
  for (const [origen, destino] of PARES) {
    if (statSync(origen).isFile()) {
      if (!existsSync(destino) || !readFileSync(origen).equals(readFileSync(destino))) difs.push(path.relative(DESKTOP, destino));
      continue;
    }
    const esperados = listar(origen);
    const actuales = existsSync(destino) ? listar(destino) : [];
    for (const rel of esperados) {
      const a = path.join(origen, rel);
      const b = path.join(destino, rel);
      if (!existsSync(b) || !readFileSync(a).equals(readFileSync(b))) difs.push(path.relative(DESKTOP, b));
    }
    for (const rel of actuales) {
      if (!esperados.includes(rel)) difs.push(`${path.relative(DESKTOP, path.join(destino, rel))} (sobra)`);
    }
  }
  return difs;
}

export function sincronizar() {
  for (const [origen, destino] of PARES) {
    if (statSync(origen).isFile()) {
      mkdirSync(path.dirname(destino), { recursive: true });
      cpSync(origen, destino);
      continue;
    }
    // Se vacía el destino salvo lo excluido: el `__tests__` de desktop tiene
    // los tests propios de la app, entre ellos el que vigila esta copia. Antes
    // se borraba el directorio entero y cada sincronización se lo llevaba.
    if (existsSync(destino)) {
      for (const nombre of readdirSync(destino)) {
        if (!EXCLUIR.has(nombre)) rmSync(path.join(destino, nombre), { recursive: true, force: true });
      }
    }
    mkdirSync(destino, { recursive: true });
    cpSync(origen, destino, { recursive: true, filter: src => !EXCLUIR.has(path.basename(src)) });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const difs = diferencias();
    if (difs.length) {
      console.error('El kit de UI de desktop/ difiere de frontend/:\n  ' + difs.join('\n  ') + '\n\nCorre: npm run ui:sync');
      process.exit(1);
    }
    console.log('Kit de UI sincronizado con frontend/.');
  } else {
    sincronizar();
    console.log('Kit de UI copiado desde frontend/src/components/ui.');
  }
}
