import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archivoALogo, bytesDeDataUri, ImagenError, LOGO_LADO, LOGO_MAX_BYTES } from '../imagen';

/** jsdom no carga imágenes ni dibuja: se simulan `Image` y el canvas para comprobar el reescalado. */
let dibujado: { w: number; h: number; relleno: boolean } | null;
let salida: string;

beforeEach(() => {
  dibujado = null;
  salida = 'data:image/png;base64,AAAA';
  vi.stubGlobal('Image', class {
    width = 1024; height = 512; onload: (() => void) | null = null; onerror: (() => void) | null = null;
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return {
      fillRect: () => { dibujado = { w: this.width, h: this.height, relleno: true }; },
      drawImage: () => { dibujado = { w: this.width, h: this.height, relleno: dibujado?.relleno ?? false }; },
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => salida);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const archivo = (tipo: string, bytes = 100) => new File([new Uint8Array(bytes)], 'logo', { type: tipo });

describe('archivoALogo', () => {
  it('reescala al lado máximo del logo conservando la proporción', async () => {
    await expect(archivoALogo(archivo('image/png'))).resolves.toBe(salida);
    expect(dibujado).toMatchObject({ w: LOGO_LADO, h: LOGO_LADO / 2 });
  });

  it('un PNG conserva la transparencia (sin fondo blanco); un JPG sí lleva fondo', async () => {
    await archivoALogo(archivo('image/png'));
    expect(dibujado?.relleno).toBe(false);
    await archivoALogo(archivo('image/jpeg'));
    expect(dibujado?.relleno).toBe(true);
  });

  it('rechaza lo que no es JPG, PNG o WebP (SVG incluido) y lo que supera 5 MB', async () => {
    for (const tipo of ['image/svg+xml', 'application/pdf', 'image/gif']) {
      await expect(archivoALogo(archivo(tipo))).rejects.toBeInstanceOf(ImagenError);
    }
    await expect(archivoALogo(archivo('image/png', 5 * 1024 * 1024 + 1))).rejects.toThrow(/5 MB/);
  });

  it('si aun reducido pesa más de lo que admite el servidor, lo dice', async () => {
    salida = `data:image/png;base64,${'A'.repeat(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 100)}`;
    await expect(archivoALogo(archivo('image/png'))).rejects.toThrow(/pesa demasiado/);
  });
});

describe('bytesDeDataUri', () => {
  it('cuenta los bytes reales, sin el relleno =', () => {
    expect(bytesDeDataUri('data:image/png;base64,QUJD')).toBe(3);      // "ABC"
    expect(bytesDeDataUri('data:image/png;base64,QUI=')).toBe(2);      // "AB"
    expect(bytesDeDataUri('data:image/png;base64,QQ==')).toBe(1);      // "A"
  });
});
