import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Node ≥ 22 expone un `localStorage` global propio (Web Storage experimental)
 * que, sin `--localstorage-file`, es un objeto vacío sin métodos; el entorno
 * jsdom de Vitest no lo reemplaza. Se instala un Storage en memoria para que
 * ThemeContext y compañía vean uno real.
 */
function storageEnMemoria(): Storage {
  const datos = new Map<string, string>();
  return {
    get length() { return datos.size; },
    key: i => [...datos.keys()][i] ?? null,
    getItem: k => datos.get(String(k)) ?? null,
    setItem: (k, v) => { datos.set(String(k), String(v)); },
    removeItem: k => { datos.delete(String(k)); },
    clear: () => datos.clear(),
  } as Storage;
}
for (const nombre of ['localStorage', 'sessionStorage'] as const) {
  if (typeof (globalThis[nombre] as Storage | undefined)?.clear !== 'function') {
    Object.defineProperty(globalThis, nombre, { value: storageEnMemoria(), configurable: true, writable: true });
  }
}

// Sin `globals: true` RTL no se limpia sola entre tests.
afterEach(() => cleanup());
