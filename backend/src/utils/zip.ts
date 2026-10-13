/**
 * Escritor ZIP en streaming, sin dependencias (formato PKWARE APPNOTE 4.3: entradas «deflate» con descriptor de datos).
 *
 * Por qué propio: la exportación de datos de una empresa puede ser grande y se escribe fila por fila; las bibliotecas de ZIP son una dependencia más
 * (y superficie de cadena de suministro) para unas 100 líneas. Limitaciones asumidas: sin ZIP64 (cada archivo < 4 GiB y menos de 65 535 archivos; se
 * lanza un error si se rebasa), sin cifrado, nombres UTF-8 (bit 11).
 */
import { Readable, Transform, pipeline, type Writable } from 'stream';
import { createDeflateRaw } from 'zlib';

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE) incremental: `crc32(b, crc32(a)) === crc32(a + b)`. */
export function crc32(datos: Uint8Array, previo = 0): number {
  let c = ~previo >>> 0;
  for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const SIG_LOCAL = 0x04034b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_FIN = 0x06054b50;
const FLAGS = 0x0808;                  // bit 3: descriptor de datos tras el contenido · bit 11: nombre en UTF-8
const LIMITE = 0xffffffff;

interface Entrada { nombre: Buffer; crc: number; comprimido: number; original: number; offset: number; dosFecha: number; dosHora: number }

function fechaDos(d: Date): { dosFecha: number; dosHora: number } {
  const anio = Math.max(1980, d.getUTCFullYear());
  return {
    dosFecha: ((anio - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    dosHora: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
  };
}

export class ZipStream {
  private entradas: Entrada[] = [];
  private posicion = 0;

  constructor(private readonly salida: Writable, private readonly ahora: () => Date = () => new Date()) {}

  private escribir(b: Buffer): Promise<void> {
    this.posicion += b.length;
    return new Promise((ok, mal) => this.salida.write(b, err => (err ? mal(err) : ok())));
  }

  /** Agrega un archivo. `contenido` puede producir texto o buffers; se comprime y escribe sobre la marcha. */
  async agregar(nombre: string, contenido: AsyncIterable<string | Buffer> | Iterable<string | Buffer>): Promise<void> {
    if (this.entradas.length >= 0xffff) throw new Error('zip: demasiados archivos');
    const n = Buffer.from(nombre, 'utf8');
    if (n.length === 0 || n.length > 0xffff || nombre.includes('\\') || nombre.startsWith('/') || nombre.split('/').includes('..')) {
      throw new Error(`zip: nombre de archivo inválido: ${nombre}`);
    }
    const { dosFecha, dosHora } = fechaDos(this.ahora());
    const offset = this.posicion;

    const cab = Buffer.alloc(30);
    cab.writeUInt32LE(SIG_LOCAL, 0);
    cab.writeUInt16LE(20, 4);            // versión necesaria
    cab.writeUInt16LE(FLAGS, 6);
    cab.writeUInt16LE(8, 8);             // deflate
    cab.writeUInt16LE(dosHora, 10);
    cab.writeUInt16LE(dosFecha, 12);
    // crc y tamaños en 0: van en el descriptor de datos
    cab.writeUInt16LE(n.length, 26);
    await this.escribir(Buffer.concat([cab, n]));

    let crc = 0; let original = 0; let comprimido = 0;
    const contar = new Transform({
      transform(chunk: Buffer, _enc, cb) { crc = crc32(chunk, crc); original += chunk.length; cb(null, chunk); },
    });
    const deflate = createDeflateRaw();
    const fuente = Readable.from((async function* () { for await (const c of contenido) yield typeof c === 'string' ? Buffer.from(c, 'utf8') : c; })());
    pipeline(fuente, contar, deflate, () => { /* el error sale por la iteración de `deflate` */ });
    for await (const trozo of deflate) { comprimido += (trozo as Buffer).length; await this.escribir(trozo as Buffer); }
    if (original > LIMITE || comprimido > LIMITE) throw new Error('zip: archivo demasiado grande (sin ZIP64)');

    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(SIG_DESCRIPTOR, 0);
    desc.writeUInt32LE(crc, 4);
    desc.writeUInt32LE(comprimido, 8);
    desc.writeUInt32LE(original, 12);
    await this.escribir(desc);
    this.entradas.push({ nombre: n, crc, comprimido, original, offset, dosFecha, dosHora });
  }

  /** Escribe el directorio central y cierra el flujo. */
  async finalizar(): Promise<void> {
    const inicio = this.posicion;
    for (const e of this.entradas) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(SIG_CENTRAL, 0);
      c.writeUInt16LE(20, 4);            // versión que lo hizo
      c.writeUInt16LE(20, 6);            // versión necesaria
      c.writeUInt16LE(FLAGS, 8);
      c.writeUInt16LE(8, 10);
      c.writeUInt16LE(e.dosHora, 12);
      c.writeUInt16LE(e.dosFecha, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.comprimido, 20);
      c.writeUInt32LE(e.original, 24);
      c.writeUInt16LE(e.nombre.length, 28);
      c.writeUInt32LE(e.offset, 42);
      await this.escribir(Buffer.concat([c, e.nombre]));
    }
    if (this.posicion > LIMITE) throw new Error('zip: el archivo rebasa 4 GiB (sin ZIP64)');
    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(SIG_FIN, 0);
    fin.writeUInt16LE(this.entradas.length, 8);
    fin.writeUInt16LE(this.entradas.length, 10);
    fin.writeUInt32LE(this.posicion - inicio, 12);
    fin.writeUInt32LE(inicio, 16);
    await this.escribir(fin);
    await new Promise<void>(ok => this.salida.end(ok));
  }
}
