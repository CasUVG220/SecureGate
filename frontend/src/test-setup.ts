import '@testing-library/jest-dom';

// Vitest 4 puede iniciar jsdom con un localStorage incompleto cuando Node recibe
// --localstorage-file. Este shim mantiene el contrato usado por la aplicación y
// evita que las pruebas dependan del sistema de archivos del runner.
const createStorage = () => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key: string) { return values.get(String(key)) ?? null; },
    key(index: number) { return Array.from(values.keys())[index] ?? null; },
    removeItem(key: string) { values.delete(String(key)); },
    setItem(key: string, value: string) { values.set(String(key), String(value)); },
  };
};

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: createStorage(),
});

// jsdom no implementa matchMedia y varios componentes lo consultan para elegir
// el layout (tabla vs. tarjetas) o el tema inicial. El stub responde "no
// coincide", que equivale a un viewport de escritorio en tema claro.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
