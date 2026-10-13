/**
 * U · Validaciones del alta autoservicio y proyección del mes (T12, sin base).
 * Entradas hostiles: se rechazan antes de tocar la base.
 */
import { validarSolicitud, validarBorrador, normalizarEmail, texto } from '../services/onboarding';
import { proyectarMes } from '../services/suscripciones';

describe('normalizarEmail', () => {
  it('acepta correos normales y los pasa a minúsculas', () => {
    expect(normalizarEmail('  Ana.Lopez+gt@Empresa.com.gt ')).toBe('ana.lopez+gt@empresa.com.gt');
  });
  it.each(['', 'sin-arroba', 'a@b', 'a b@c.com', '@c.com', 'a@.com', 'a@c..com', 'a@c.com\nBcc: x@y.com', 'a@c.com,b@d.com', '<x>@c.com', `${'a'.repeat(65)}@c.com`, `a@${'b'.repeat(250)}.com`, 12, null, undefined, ['a@b.com']])(
    'rechaza %p', v => { expect(normalizarEmail(v as never)).toBeNull(); });
});

describe('texto', () => {
  it('recorta, junta espacios y respeta los límites', () => {
    expect(texto('  Residencial   Los Pinos  ', 2, 50)).toBe('Residencial Los Pinos');
    expect(texto('a', 2, 50)).toBeNull();
    expect(texto('x'.repeat(151), 2, 150)).toBeNull();
  });
  it('rechaza < > y caracteres de control', () => {
    for (const malo of ['<script>alert(1)</script>', 'a>b', 'nombre\u0000', 'tab\tinterno\u0007', 'x\u007F']) expect(texto(malo, 1, 100)).toBeNull();
    expect(texto('Edificio "El Roble" & Cía.', 1, 100)).toBe('Edificio "El Roble" & Cía.');
    expect(texto(42 as never, 1, 5)).toBeNull();
  });
});

describe('validarSolicitud', () => {
  const ok = { email: 'a@b.com', empresa_nombre: 'Mi Empresa', acepta_terminos: true };
  it('acepta lo correcto', () => { expect(validarSolicitud(ok)).toEqual({ ok: true, valores: { email: 'a@b.com', empresa_nombre: 'Mi Empresa' } }); });
  it('exige aceptar los términos', () => {
    expect(validarSolicitud({ ...ok, acepta_terminos: false })).toMatchObject({ ok: false });
    expect(validarSolicitud({ ...ok, acepta_terminos: 'true' })).toMatchObject({ ok: false });
    expect(validarSolicitud({ email: ok.email, empresa_nombre: ok.empresa_nombre })).toMatchObject({ ok: false });
  });
  it('rechaza correo y nombre inválidos', () => {
    expect(validarSolicitud({ ...ok, email: 'x' })).toMatchObject({ ok: false });
    expect(validarSolicitud({ ...ok, empresa_nombre: '<b>x</b>' })).toMatchObject({ ok: false });
    expect(validarSolicitud({ ...ok, empresa_nombre: 'a' })).toMatchObject({ ok: false });
  });
});

describe('validarBorrador', () => {
  const completo = { empresa_nombre: 'Mi Empresa', nit: '1234567-8', sucursal_nombre: 'Sede', direccion: 'Zona 10, Ciudad de Guatemala', tipo: 'condominio', plan_codigo: 'basico' };
  it('acepta un borrador completo (y normaliza el NIT)', () => {
    expect(validarBorrador({ ...completo, nit: '1234567-k' }, false)).toEqual({ ok: true, valores: { ...completo, nit: '1234567-K' } });
  });
  it('en parcial acepta solo lo llenado, pero no vacío', () => {
    expect(validarBorrador({ sucursal_nombre: 'Sede' }, true)).toEqual({ ok: true, valores: { sucursal_nombre: 'Sede' } });
    expect(validarBorrador({}, true)).toMatchObject({ ok: false });
  });
  it('en completo exige empresa, sucursal y plan; nit, dirección y tipo son opcionales', () => {
    expect(validarBorrador({ empresa_nombre: 'X1', sucursal_nombre: 'Y1', plan_codigo: 'basico' }, false)).toMatchObject({ ok: true });
    expect(validarBorrador({ sucursal_nombre: 'Y1', plan_codigo: 'basico' }, false)).toMatchObject({ ok: false });
    expect(validarBorrador({ empresa_nombre: 'X1', plan_codigo: 'basico' }, false)).toMatchObject({ ok: false });
    expect(validarBorrador({ empresa_nombre: 'X1', sucursal_nombre: 'Y1' }, false)).toMatchObject({ ok: false });
  });
  it('rechaza campos desconocidos (no se guarda nada a ciegas)', () => {
    expect(validarBorrador({ sucursal_nombre: 'Sede', empresa_id: 'x' }, true)).toMatchObject({ ok: false, error: expect.stringContaining('empresa_id') });
    expect(validarBorrador({ __proto__: { a: 1 }, plan_codigo: 'basico', rol: 'owner' } as never, true)).toMatchObject({ ok: false });
  });
  it.each([
    ['nit con letras', { nit: 'ABC' }], ['nit con SQL', { nit: "1'; DROP TABLE x;--" }], ['nit largo', { nit: '1'.repeat(20) }],
    ['tipo inventado', { tipo: 'castillo' }], ['plan con mayúsculas', { plan_codigo: 'Basico' }], ['plan con ruta', { plan_codigo: '../x' }],
    ['dirección con etiqueta', { direccion: '<img src=x onerror=alert(1)>' }], ['nombre con control', { sucursal_nombre: 'Sede\u0000' }],
    ['nombre numérico', { sucursal_nombre: 12345 }],
  ])('rechaza %s', (_n, cambio) => { expect(validarBorrador(cambio as never, true)).toMatchObject({ ok: false }); });
  it('nit, dirección y tipo vacíos o null se guardan como null', () => {
    expect(validarBorrador({ nit: '', direccion: null, tipo: '' }, true)).toEqual({ ok: true, valores: { nit: null, direccion: null, tipo: null } });
  });
});

describe('proyectarMes', () => {
  it('extiende el ritmo del mes: 150 visitas en 10 de 30 días → 450', () => {
    expect(proyectarMes(150, 10, 30, 400, 50)).toEqual({ visitas_proyectadas: 450, excedente_proyectado: 50, excedente_proyectado_centavos: 2500 });
  });
  it('redondea hacia arriba y no inventa excedente si cabe', () => {
    expect(proyectarMes(1, 3, 31, 500, 50)).toMatchObject({ visitas_proyectadas: 11, excedente_proyectado: 0, excedente_proyectado_centavos: 0 });   // 31/3 = 10,33 → 11
  });
  it('el último día proyecta lo que hay; el primero multiplica por los días', () => {
    expect(proyectarMes(120, 30, 30, 100, 10)).toMatchObject({ visitas_proyectadas: 120, excedente_proyectado: 20 });
    expect(proyectarMes(5, 1, 31, 100, 10)).toMatchObject({ visitas_proyectadas: 155, excedente_proyectado: 55, excedente_proyectado_centavos: 550 });
  });
  it('sin incluidas definidas (sin límite) no hay excedente', () => { expect(proyectarMes(1000, 1, 30, null, 50).excedente_proyectado).toBe(0); });
  it('rechaza valores imposibles', () => {
    expect(() => proyectarMes(-1, 1, 30, 1, 1)).toThrow();
    expect(() => proyectarMes(1, 0, 30, 1, 1)).toThrow();
    expect(() => proyectarMes(1, 31, 30, 1, 1)).toThrow();
    expect(() => proyectarMes(1.5, 1, 30, 1, 1)).toThrow();
  });
});
