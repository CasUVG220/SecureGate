/** Lector ZIP mínimo para las pruebas: lee el directorio central, descomprime cada entrada y verifica su CRC-32. No es un unzip general. */
import { inflateRawSync } from 'zlib';
import { crc32 } from '../../utils/zip';

export interface EntradaZip { nombre: string; contenido: Buffer; texto: string }

export function leerZip(zip: Buffer): EntradaZip[] {
  const fin = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fin < 0) throw new Error('zip: no hay registro de fin de directorio');
  const total = zip.readUInt16LE(fin + 10);
  let p = zip.readUInt32LE(fin + 16);
  const entradas: EntradaZip[] = [];
  for (let i = 0; i < total; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: entrada de directorio corrupta');
    const metodo = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const comprimido = zip.readUInt32LE(p + 20);
    const original = zip.readUInt32LE(p + 24);
    const lnombre = zip.readUInt16LE(p + 28);
    const lextra = zip.readUInt16LE(p + 30);
    const lcomentario = zip.readUInt16LE(p + 32);
    const offset = zip.readUInt32LE(p + 42);
    const nombre = zip.subarray(p + 46, p + 46 + lnombre).toString('utf8');
    p += 46 + lnombre + lextra + lcomentario;

    if (zip.readUInt32LE(offset) !== 0x04034b50) throw new Error(`zip: encabezado local corrupto en ${nombre}`);
    const datos = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const crudo = zip.subarray(datos, datos + comprimido);
    const contenido = metodo === 8 ? inflateRawSync(crudo) : Buffer.from(crudo);
    if (contenido.length !== original) throw new Error(`zip: tamaño distinto en ${nombre}`);
    if (crc32(contenido) !== crc) throw new Error(`zip: CRC distinto en ${nombre}`);
    // El descriptor de datos que sigue al contenido debe repetir lo mismo.
    const desc = datos + comprimido;
    if (zip.readUInt32LE(desc) !== 0x08074b50 || zip.readUInt32LE(desc + 4) !== crc) throw new Error(`zip: descriptor inválido en ${nombre}`);
    entradas.push({ nombre, contenido, texto: contenido.toString('utf8') });
  }
  return entradas;
}

/** Parser de supertest que junta el cuerpo binario en un Buffer. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const comoBuffer = (res: any, cb: (err: any, body: Buffer) => void): void => {
  const partes: Buffer[] = [];
  res.on('data', (c: Buffer) => partes.push(c));
  res.on('end', () => cb(null, Buffer.concat(partes)));
};
