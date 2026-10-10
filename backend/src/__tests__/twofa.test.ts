/**
 * Verificación en dos pasos — piezas puras (SCRUM-123). Sin base de datos.
 *
 * El TOTP es una implementación propia del RFC 6238, así que se comprueba contra los vectores oficiales (RFC 4226 apéndice D
 * y RFC 6238 apéndice B) y, aparte, contra una librería de referencia durante el desarrollo. Aquí además: el cifrado del
 * secreto en reposo, los códigos de recuperación y el desafío entre la contraseña y el segundo factor.
 *
 * El flujo HTTP completo (activar, ingresar, bloquear por intentos, códigos de un solo uso) está en
 * `integration/twofa.int.test.ts`, contra Postgres.
 */
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'prueba-dos-pasos-'.padEnd(48, 'x');

jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: jest.fn() },
}));

import {
  base32Codificar, base32Decodificar, cifrarSecreto, codigoTotp, descifrarSecreto, firmarDesafio, generarCodigosRecuperacion,
  hashCodigoRecuperacion, leerDesafio, limpiarCodigo, normalizarCodigoRecuperacion, nuevoSecreto, pasoDe, urlOtpauth, verificarTotp,
  CANTIDAD_CODIGOS,
} from '../utils/twofa';
import { verifyToken } from '../middleware/auth.middleware';

/** El secreto de los vectores del RFC: la cadena ASCII «12345678901234567890» (20 bytes). */
const SECRETO_RFC = base32Codificar(Buffer.from('12345678901234567890'));

describe('TOTP: vectores oficiales', () => {
  it('el secreto del RFC en base32 es el conocido', () => {
    expect(SECRETO_RFC).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('RFC 4226 apéndice D: los 10 primeros códigos HOTP', () => {
    const esperados = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    esperados.forEach((codigo, contador) => expect(codigoTotp(SECRETO_RFC, contador)).toBe(codigo));
  });

  it('RFC 6238 apéndice B (SHA-1): los códigos de 8 dígitos terminan en los de 6 que damos', () => {
    // 59 → 94287082, 1111111109 → 07081804, 1111111111 → 14050471, 1234567890 → 89005924, 2000000000 → 69279037, 20000000000 → 65353130
    const casos: Array<[number, string]> = [
      [59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130'],
    ];
    for (const [segundos, codigo] of casos) expect(codigoTotp(SECRETO_RFC, pasoDe(segundos * 1000))).toBe(codigo);
  });
});

describe('base32', () => {
  it('ida y vuelta con cualquier longitud', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) & 255));
      expect(base32Decodificar(base32Codificar(bytes))).toEqual(bytes);
    }
  });

  it('acepta minúsculas, espacios y relleno; rechaza símbolos que no son del alfabeto', () => {
    expect(base32Decodificar('GEZDGNBV').toString()).toBe('12345');
    expect(base32Decodificar('gezd gnbv====')).toEqual(base32Decodificar('GEZDGNBV'));
    expect(() => base32Decodificar('GEZ1GNBV')).toThrow();    // el 1 no existe en base32
    expect(() => base32Decodificar('GEZ!GNBV')).toThrow();
  });
});

describe('secreto nuevo y URL del QR', () => {
  it('32 caracteres base32 (160 bits) y distinto cada vez', () => {
    const a = nuevoSecreto(); const b = nuevoSecreto();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decodificar(a)).toHaveLength(20);
    expect(a).not.toBe(b);
  });

  it('la URL otpauth lleva emisor, correo codificado y los parámetros que leen las apps', () => {
    const url = urlOtpauth('JBSWY3DPEHPK3PXP', 'ana.pérez+prueba@empresa.com');
    expect(url.startsWith('otpauth://totp/SecureGate:')).toBe(true);
    expect(url).toContain(encodeURIComponent('ana.pérez+prueba@empresa.com'));
    const q = new URL(url).searchParams;
    expect(q.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(q.get('issuer')).toBe('SecureGate');
    expect(q.get('algorithm')).toBe('SHA1');
    expect(q.get('digits')).toBe('6');
    expect(q.get('period')).toBe('30');
  });
});

describe('verificarTotp', () => {
  const secreto = nuevoSecreto();
  const ahora = 1_900_000_000_000;
  const paso = pasoDe(ahora);
  const en = (p: number) => codigoTotp(secreto, p);

  it('acepta el código del intervalo actual y devuelve cuál fue', () => {
    expect(verificarTotp(secreto, en(paso), null, ahora)).toEqual({ valido: true, paso });
  });

  it('tolera un intervalo de desfase de reloj, hacia atrás y hacia adelante, y ni uno más', () => {
    expect(verificarTotp(secreto, en(paso - 1), null, ahora)).toEqual({ valido: true, paso: paso - 1 });
    expect(verificarTotp(secreto, en(paso + 1), null, ahora)).toEqual({ valido: true, paso: paso + 1 });
    expect(verificarTotp(secreto, en(paso - 2), null, ahora).valido).toBe(false);
    expect(verificarTotp(secreto, en(paso + 2), null, ahora).valido).toBe(false);
  });

  it('un código ya usado no vale otra vez: se rechaza el intervalo aceptado y los anteriores', () => {
    expect(verificarTotp(secreto, en(paso), paso, ahora).valido).toBe(false);          // el mismo intervalo
    expect(verificarTotp(secreto, en(paso - 1), paso, ahora).valido).toBe(false);      // uno anterior
    expect(verificarTotp(secreto, en(paso + 1), paso, ahora)).toEqual({ valido: true, paso: paso + 1 });
    expect(verificarTotp(secreto, en(paso), String(paso - 1), ahora).valido).toBe(true); // el último paso llega de la base como texto
  });

  it('rechaza lo que no es un código de 6 dígitos', () => {
    for (const malo of ['', '12345', '1234567', 'abcdef', '12 3456', '١٢٣٤٥٦']) expect(verificarTotp(secreto, malo, null, ahora).valido).toBe(false);
  });

  it('con un secreto ilegible responde «no válido», no lanza', () => {
    expect(verificarTotp('no es base32!', '123456', null, ahora).valido).toBe(false);
  });

  it('otro secreto no valida el código', () => {
    expect(verificarTotp(nuevoSecreto(), en(paso), null, ahora).valido).toBe(false);
  });
});

describe('limpiarCodigo', () => {
  it('quita espacios y guiones y pasa a mayúsculas; lo que no es texto queda vacío', () => {
    expect(limpiarCodigo(' 123 456 ')).toBe('123456');
    expect(limpiarCodigo('abcde-fghjk')).toBe('ABCDEFGHJK');
    expect(limpiarCodigo(123456)).toBe('');
    expect(limpiarCodigo(undefined)).toBe('');
    expect(limpiarCodigo({})).toBe('');
  });
});

describe('secreto cifrado en reposo', () => {
  const secreto = nuevoSecreto();
  const usuario = '11111111-1111-4111-8111-111111111111';
  const previa = process.env.TWOFA_KEY;
  afterEach(() => { if (previa === undefined) delete process.env.TWOFA_KEY; else process.env.TWOFA_KEY = previa; });

  it('se guarda cifrado (no contiene el secreto) y se recupera igual', () => {
    const guardado = cifrarSecreto(secreto, usuario);
    expect(guardado.startsWith('v1.')).toBe(true);
    expect(guardado).not.toContain(secreto);
    expect(descifrarSecreto(guardado, usuario)).toBe(secreto);
  });

  it('cada cifrado usa un vector de inicialización nuevo', () => {
    expect(cifrarSecreto(secreto, usuario)).not.toBe(cifrarSecreto(secreto, usuario));
  });

  it('un valor alterado no descifra', () => {
    const [v, iv, tag, cifrado] = cifrarSecreto(secreto, usuario).split('.');
    const alterado = Buffer.from(cifrado, 'base64url'); alterado[0] ^= 1;
    expect(() => descifrarSecreto([v, iv, tag, alterado.toString('base64url')].join('.'), usuario)).toThrow();
    expect(() => descifrarSecreto('v1.abc', usuario)).toThrow();
    expect(() => descifrarSecreto('v9.a.b.c', usuario)).toThrow();
  });

  it('el secreto de una persona copiado a la fila de otra no descifra', () => {
    const guardado = cifrarSecreto(secreto, usuario);
    expect(() => descifrarSecreto(guardado, '22222222-2222-4222-8222-222222222222')).toThrow();
  });

  it('con TWOFA_KEY la llave cambia; si es igual al JWT_SECRET de antes, la llave derivada es la misma (así se rota JWT_SECRET)', () => {
    const guardado = cifrarSecreto(secreto, usuario);           // llave derivada de JWT_SECRET
    process.env.TWOFA_KEY = 'otra-llave-distinta-'.padEnd(40, 'z');
    expect(() => descifrarSecreto(guardado, usuario)).toThrow();
    process.env.TWOFA_KEY = process.env.JWT_SECRET;              // el procedimiento de rotación documentado
    expect(descifrarSecreto(guardado, usuario)).toBe(secreto);
    const nuevo = cifrarSecreto(secreto, usuario);               // cifrado con TWOFA_KEY…
    delete process.env.TWOFA_KEY;
    expect(descifrarSecreto(nuevo, usuario)).toBe(secreto);      // …y sigue valiendo con JWT_SECRET (misma llave)
  });
});

describe('códigos de recuperación', () => {
  it(`salen ${CANTIDAD_CODIGOS}, con forma XXXXX-XXXXX, sin símbolos confusos y sin repetirse`, () => {
    const codigos = generarCodigosRecuperacion();
    expect(codigos).toHaveLength(CANTIDAD_CODIGOS);
    expect(new Set(codigos).size).toBe(CANTIDAD_CODIGOS);
    for (const c of codigos) {
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
      expect(normalizarCodigoRecuperacion(c)).toBe(c.replace('-', ''));
    }
    expect(generarCodigosRecuperacion()).not.toEqual(codigos);
  });

  it('se reconocen aunque se escriban en minúsculas, con espacios o sin guion', () => {
    expect(normalizarCodigoRecuperacion('abcde-fghjk')).toBe('ABCDEFGHJK');
    expect(normalizarCodigoRecuperacion(' abcde fghjk ')).toBe('ABCDEFGHJK');
    expect(normalizarCodigoRecuperacion('ABCDEFGHJK')).toBe('ABCDEFGHJK');
  });

  it('lo que no tiene forma de código de recuperación se descarta', () => {
    for (const malo of ['', '123456', 'ABCDE', 'ABCDE-FGHJ0', 'ABCDE-FGHJI', 'ABCDE-FGHJKL', null, 42]) expect(normalizarCodigoRecuperacion(malo)).toBeNull();
  });

  it('el hash es estable, depende de la llave del servidor y no es un SHA-256 a secas', () => {
    const h = hashCodigoRecuperacion('ABCDEFGHJK');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCodigoRecuperacion('ABCDEFGHJK')).toBe(h);
    expect(hashCodigoRecuperacion('ABCDEFGHJL')).not.toBe(h);
    expect(h).not.toBe(require('crypto').createHash('sha256').update('ABCDEFGHJK').digest('hex'));
    const previa = process.env.TWOFA_KEY;
    process.env.TWOFA_KEY = 'una-llave-propia-'.padEnd(40, 'k');
    expect(hashCodigoRecuperacion('ABCDEFGHJK')).not.toBe(h);
    if (previa === undefined) delete process.env.TWOFA_KEY; else process.env.TWOFA_KEY = previa;
  });
});

describe('desafío entre la contraseña y el segundo factor', () => {
  const usuario = '33333333-3333-4333-8333-333333333333';

  it('se firma, se lee y devuelve la persona', () => {
    expect(leerDesafio(firmarDesafio(usuario))).toBe(usuario);
  });

  it('dura 5 minutos', () => {
    const { exp, iat } = jwt.decode(firmarDesafio(usuario)) as { exp: number; iat: number };
    expect(exp - iat).toBe(5 * 60);
  });

  it('un token de sesión, uno de licencia, uno vencido, uno alterado o con otra firma no sirven', () => {
    const secreto = process.env.JWT_SECRET as string;
    const sesion = jwt.sign({ id: usuario, rol: 'owner' }, secreto, { expiresIn: '1h' });
    const licencia = jwt.sign({ typ: 'licencia', id: usuario }, secreto, { expiresIn: '1h' });
    const vencido = jwt.sign({ typ: '2fa', id: usuario }, secreto, { expiresIn: -10 });
    const otraFirma = jwt.sign({ typ: '2fa', id: usuario }, 'otro-secreto-'.padEnd(48, 'o'), { expiresIn: '5m' });
    const sinAlgoritmo = jwt.sign({ typ: '2fa', id: usuario }, secreto, { algorithm: 'HS512', expiresIn: '5m' });
    for (const malo of [sesion, licencia, vencido, otraFirma, sinAlgoritmo, firmarDesafio(usuario) + 'x', '', 'basura', undefined, null, 42, {}]) {
      expect(leerDesafio(malo)).toBeNull();
    }
  });

  it('no abre sesión: verifyToken lo rechaza (el desafío lleva typ, las sesiones no)', () => {
    const req: any = { headers: { authorization: `Bearer ${firmarDesafio(usuario)}` } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    verifyToken(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
