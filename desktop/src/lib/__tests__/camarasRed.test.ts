import { describe, expect, it } from 'vitest';
import { NOMBRE_TIPO, camaraDeRedPara, estadoLegible, resumenTipo, urlVista } from '../camarasRed';
import type { CamaraRed } from '../tauri';

const cam = (over: Partial<CamaraRed> = {}): CamaraRed => ({
  id: 'c1', tipo: 'ip', nombre: 'Carril', url: 'rtsp://192.168.1.50/live', device_id: null, tareas: [], con_credenciales: false, creada_en: '2026-10-11T10:00:00Z', ...over,
});

describe('cámaras de red', () => {
  it('una tarea usa la cámara de red que la tiene asignada; las USB no cuentan', () => {
    const lista = [cam({ id: 'a', tareas: ['salida'] }), cam({ id: 'b', tipo: 'celular', tareas: ['placa', 'dpi'] }), cam({ id: 'u', tipo: 'usb', tareas: ['qr'] })];
    expect(camaraDeRedPara('placa', lista)?.id).toBe('b');
    expect(camaraDeRedPara('salida', lista)?.id).toBe('a');
    expect(camaraDeRedPara('qr', lista)).toBeUndefined();
    expect(camaraDeRedPara('dpi', [])).toBeUndefined();
  });

  it('la dirección de la vista previa va al puente local con el token y cambia con la versión', () => {
    const u = urlVista({ puerto: 41999, token: 'abc123' }, 'cam 1', 2);
    expect(u).toBe('http://127.0.0.1:41999/v/cam%201?t=abc123&r=2');
    expect(urlVista({ puerto: 1, token: 't' }, 'x')).toContain('&r=0');
  });

  it('cada estado de la cámara se explica con palabras claras', () => {
    expect(estadoLegible({ estado: 'conectada' })).toMatchObject({ tono: 'ok', corto: 'En vivo', titulo: null });
    expect(estadoLegible(null).titulo).toMatch(/Conectando/);
    const rec = estadoLegible({ estado: 'reconectando', intento: 2, proximo_en_s: 4, motivo: 'La cámara cerró la conexión.' });
    expect(rec.titulo).toBe('Se perdió la señal de la cámara');
    expect(rec.detalle).toBe('La cámara cerró la conexión. Reintentando en 4 s.');
    const caida = estadoLegible({ estado: 'caida', motivo: 'No respondió.', intentos: 5, reintentando: true });
    expect(caida.titulo).toBe('La cámara no responde');
    expect(caida.detalle).toMatch(/usa otra cámara o la captura manual/);
    expect(caida.reintentaSola).toBe(true);
    const permanente = estadoLegible({ estado: 'caida', motivo: 'El usuario o la contraseña de la cámara no son correctos.', intentos: 1, reintentando: false });
    expect(permanente.reintentaSola).toBe(false);
    expect(permanente.detalle).toMatch(/contraseña/);
    expect(estadoLegible({ estado: 'detenida' }).titulo).toMatch(/apagada/);
  });

  it('resumen de la lista de configuración', () => {
    const rot = (t: string) => ({ placa: 'Placa', salida: 'Salida' } as Record<string, string>)[t] ?? t;
    expect(resumenTipo(cam({ tareas: ['placa', 'salida'] }), rot)).toBe('Cámara IP · Placa, Salida');
    expect(resumenTipo(cam({ tipo: 'celular' }), rot)).toBe('Celular como cámara · sin tarea asignada');
    expect(NOMBRE_TIPO.usb).toBe('Cámara USB');
  });
});

/** Guardas del código: las credenciales de una cámara no existen del lado del frontend más que en el formulario de alta. */
const fuentes = import.meta.glob(['../../**/*.ts', '../../**/*.tsx', '!../../**/__tests__/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
// En Windows git entrega los archivos con CRLF: se normaliza para que los cortes por `\n}\n` funcionen igual (lo detectó el CI de Windows).
const tauriTs = (Object.entries(fuentes).find(([ruta]) => ruta.endsWith('/tauri.ts')) ?? ['', ''])[1].replace(/\r\n/g, '\n');

describe('las credenciales de las cámaras no llegan al frontend', () => {
  const bloque = (nombre: string) => {
    const i = tauriTs.indexOf(`export interface ${nombre} {`);
    return tauriTs.slice(i, tauriTs.indexOf('\n}\n', i));
  };

  it('lo que Rust devuelve (CamaraRed, ResultadoPrueba, FotogramaCapturado, DispositivoOnvif) no tiene campos de usuario ni contraseña', () => {
    expect(tauriTs.length).toBeGreaterThan(1000);
    for (const t of ['CamaraRed', 'ResultadoPrueba', 'FotogramaCapturado', 'DispositivoOnvif']) {
      const b = bloque(t);
      expect(b.length, t).toBeGreaterThan(20);
      expect(b, t).not.toMatch(/\b(usuario|clave|password|contrasena|secret)\b/i);
    }
    expect(bloque('CamaraRed')).toContain('con_credenciales: boolean');
  });

  it('solo el formulario de alta maneja usuario y clave: ningún otro archivo lee `camara.clave` ni `camara.usuario`', () => {
    const lecturas = Object.entries(fuentes)
      .filter(([ruta, src]) => !ruta.endsWith('CamaraRedDialog.tsx') && /\bcamara\w*\??\.(clave|usuario)\b/i.test(src))
      .map(([ruta]) => ruta);
    expect(lecturas).toEqual([]);
    // Y en los tipos de `tauri.ts`, la contraseña solo existe en lo que se ENVÍA (EntradaCamara).
    const conSecretos = [...tauriTs.matchAll(/export interface (\w+) \{([\s\S]*?)\n\}/g)]
      .filter(([, , cuerpo]) => /\bclave\b\??:/.test(cuerpo)).map(([, nombre]) => nombre);
    expect(conSecretos).toEqual(['EntradaCamara']);
  });
});
