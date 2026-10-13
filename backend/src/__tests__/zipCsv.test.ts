/**
 * U · ZIP en streaming y CSV de la exportación de datos (T12). Se comprueba contra un lector independiente (helpers/leerZip.ts) que valida CRC y tamaños.
 */
import { Writable } from 'stream';
import { crc32, ZipStream } from '../utils/zip';
import { BOM, celdaCsv, filaCsv } from '../utils/csv';
import { leerZip } from './helpers/leerZip';

const recolector = () => {
  const partes: Buffer[] = [];
  const salida = new Writable({ write(chunk, _e, cb) { partes.push(Buffer.from(chunk)); cb(); } });
  return { salida, buffer: () => Buffer.concat(partes) };
};

describe('crc32', () => {
  it('valor de referencia del estándar', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
  it('es incremental', () => {
    const a = Buffer.from('hola '); const b = Buffer.from('mundo');
    expect(crc32(b, crc32(a))).toBe(crc32(Buffer.concat([a, b])));
  });
});

describe('ZipStream', () => {
  it('escribe varios archivos que un lector independiente descomprime con el mismo contenido', async () => {
    const { salida, buffer } = recolector();
    const zip = new ZipStream(salida, () => new Date('2026-10-05T12:00:00Z'));
    const grande = Array.from({ length: 5000 }, (_, i) => `fila ${i},${'x'.repeat(40)}\r\n`);
    await zip.agregar('a.csv', ['uno,dos\r\n', Buffer.from('1,2\r\n')]);
    await zip.agregar('datos/grande.csv', (async function* () { for (const l of grande) yield l; })());
    await zip.agregar('vacio.txt', []);
    await zip.agregar('acentos-ñ-é.txt', ['Guatemala: ñandú, ¿sí?']);
    await zip.finalizar();

    const e = leerZip(buffer());
    expect(e.map(x => x.nombre)).toEqual(['a.csv', 'datos/grande.csv', 'vacio.txt', 'acentos-ñ-é.txt']);
    expect(e[0].texto).toBe('uno,dos\r\n1,2\r\n');
    expect(e[1].texto).toBe(grande.join(''));
    expect(e[2].contenido.length).toBe(0);
    expect(e[3].texto).toBe('Guatemala: ñandú, ¿sí?');
    expect(buffer().length).toBeLessThan(grande.join('').length);         // realmente comprime
  });

  it('un archivo con bytes arbitrarios (no texto) sale idéntico', async () => {
    const { salida, buffer } = recolector();
    const zip = new ZipStream(salida);
    const bin = Buffer.from(Array.from({ length: 70_000 }, (_, i) => (i * 7919) & 0xff));
    await zip.agregar('b.bin', [bin.subarray(0, 30_000), bin.subarray(30_000)]);
    await zip.finalizar();
    expect(leerZip(buffer())[0].contenido.equals(bin)).toBe(true);
  });

  it('rechaza nombres peligrosos (ruta absoluta, .., barra invertida, vacío)', async () => {
    const zip = new ZipStream(recolector().salida);
    for (const malo of ['/etc/passwd', '../fuera.txt', 'a/../../b', 'a\\b.txt', '']) {
      await expect(zip.agregar(malo, ['x'])).rejects.toThrow(/nombre/);
    }
  });

  it('si la fuente falla a mitad, el error sube y no se da por bueno el archivo', async () => {
    const zip = new ZipStream(recolector().salida);
    const rota = (async function* () { yield 'parte 1'; throw new Error('la base se cayó'); })();
    await expect(zip.agregar('x.csv', rota)).rejects.toThrow('la base se cayó');
  });
});

describe('CSV', () => {
  it('cita comas, comillas, saltos de línea y espacios al borde', () => {
    expect(celdaCsv('a,b')).toBe('"a,b"');
    expect(celdaCsv('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(celdaCsv('línea1\nlínea2')).toBe('"línea1\nlínea2"');
    expect(celdaCsv(' con espacio')).toBe('" con espacio"');
    expect(celdaCsv('normal')).toBe('normal');
  });
  it('vacíos y tipos', () => {
    expect(celdaCsv(null)).toBe(''); expect(celdaCsv(undefined)).toBe('');
    expect(celdaCsv(0)).toBe('0'); expect(celdaCsv(false)).toBe('false');
    expect(celdaCsv(new Date('2026-10-01T06:00:00Z'))).toBe('2026-10-01T06:00:00.000Z');
    expect(celdaCsv({ a: 1 })).toBe('"{""a"":1}"');
  });
  it('neutraliza fórmulas (inyección de CSV)', () => {
    expect(celdaCsv('=1+1')).toBe("'=1+1");
    expect(celdaCsv('+502 5555-0000')).toBe("'+502 5555-0000");
    expect(celdaCsv('-5')).toBe("'-5");
    expect(celdaCsv('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(celdaCsv('=HYPERLINK("http://x","clic")')).toBe(`"'=HYPERLINK(""http://x"",""clic"")"`);
    expect(celdaCsv('\t=cmd')).toBe("'\t=cmd");
    expect(celdaCsv(-5)).toBe("'-5");                                      // un número negativo también (es texto para la hoja); los montos exportados no son negativos
  });
  it('una fila termina en CRLF y el BOM es el de UTF-8', () => {
    expect(filaCsv(['a', 1, null])).toBe('a,1,\r\n');
    expect(BOM).toBe('﻿');
  });
});
