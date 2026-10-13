/**
 * U · Planes y suscripciones (unitarias, sin base) — T10
 * Valida el cuerpo de un plan (dinero solo en centavos enteros), los meses y los límites con un pool simulado.
 */
import {
  validarPlan, parsearMes, mesSiguiente, periodoTexto, reservarCupo, mensajeLimite, asignarSuscripcion, type Plan,
} from '../services/suscripciones';

const completo = { codigo: 'mi-plan', nombre: 'Mi plan', precio_mensual_centavos: 25000, visitas_incluidas: 500, precio_visita_extra_centavos: 50 };

describe('validarPlan', () => {
  it('acepta un plan completo y aplica límites opcionales', () => {
    const r = validarPlan({ ...completo, max_sucursales: 3, max_garitas: null, dias_prueba: 14 }, false);
    expect(r).toEqual({ ok: true, valores: expect.objectContaining({ codigo: 'mi-plan', max_sucursales: 3, max_garitas: null, dias_prueba: 14 }) });
  });

  it.each([
    ['precio con decimales', { precio_mensual_centavos: 250.5 }],
    ['precio en texto', { precio_mensual_centavos: '25000' }],
    ['precio negativo', { precio_mensual_centavos: -1 }],
    ['precio NaN', { precio_mensual_centavos: NaN }],
    ['excedente decimal', { precio_visita_extra_centavos: 0.1 + 0.2 }],
    ['visitas negativas', { visitas_incluidas: -5 }],
    ['código con mayúsculas', { codigo: 'MiPlan' }],
    ['código corto', { codigo: 'a' }],
    ['nombre vacío', { nombre: '   ' }],
    ['límite en cero', { max_sucursales: 0 }],
    ['días de prueba de más', { dias_prueba: 91 }],
    ['activo en texto', { activo: 'si' }],
  ])('rechaza %s', (_n, cambio) => {
    expect(validarPlan({ ...completo, ...cambio }, false)).toMatchObject({ ok: false });
  });

  it('exige los campos obligatorios al crear, pero no al editar', () => {
    expect(validarPlan({ nombre: 'x' }, false)).toMatchObject({ ok: false });
    expect(validarPlan({ nombre: 'Nuevo nombre' }, true)).toEqual({ ok: true, valores: { nombre: 'Nuevo nombre' } });
    expect(validarPlan({}, true)).toMatchObject({ ok: false });
  });
});

describe('meses', () => {
  it('parsea AAAA-MM y rechaza lo demás', () => {
    expect(parsearMes('2026-10')).toEqual({ anio: 2026, mes: 10 });
    for (const malo of ['2026-13', '2026-00', '2026-1', '26-10', '', undefined, null, 202610, ['2026-10'], '2026-10-01', '1999-12']) {
      expect(parsearMes(malo)).toBeNull();
    }
  });
  it('el mes siguiente salta de año', () => {
    expect(mesSiguiente({ anio: 2026, mes: 12 })).toEqual({ anio: 2027, mes: 1 });
    expect(mesSiguiente({ anio: 2026, mes: 9 })).toEqual({ anio: 2026, mes: 10 });
    expect(periodoTexto({ anio: 2026, mes: 3 })).toBe('2026-03');
  });
});

describe('límites y asignación con pool simulado', () => {
  const plan = (o: Partial<Plan> = {}) => ({
    id: 'p1', codigo: 'x', nombre: 'Básico', descripcion: null, precio_mensual_centavos: 100, visitas_incluidas: 10, precio_visita_extra_centavos: 5,
    max_sucursales: 2, max_garitas: 1, dias_prueba: 14, moneda: 'GTQ', supuesto: true, activo: true, orden: 1, ...o,
  });
  const dbCon = (susc: Plan | null, usos: { sucursales: number; garitas: number }) => ({
    query: jest.fn(async (sql: string) => {
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('FROM suscripciones s JOIN planes')) {
        return { rows: susc ? [{ id: 's1', empresa_id: 'e', plan_id: susc.id, estado: 'activa', ciclo: 'mensual', inicio_en: 'x', prueba_hasta: null, cancelada_en: null, p_id: susc.id, ...susc }] : [] };
      }
      return { rows: [usos] };
    }),
  });

  it('toma el candado de la empresa antes de contar', async () => {
    const db = dbCon(plan(), { sucursales: 1, garitas: 0 });
    await reservarCupo(db, 'e', 'sucursales');
    expect(db.query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  });
  it('cabe si usados < límite; no cabe al llegar al tope', async () => {
    expect(await reservarCupo(dbCon(plan(), { sucursales: 1, garitas: 0 }), 'e', 'sucursales')).toMatchObject({ ok: true, usados: 1, limite: 2 });
    expect(await reservarCupo(dbCon(plan(), { sucursales: 2, garitas: 0 }), 'e', 'sucursales')).toMatchObject({ ok: false, usados: 2, limite: 2 });
    expect(await reservarCupo(dbCon(plan(), { sucursales: 0, garitas: 1 }), 'e', 'garitas')).toMatchObject({ ok: false, limite: 1 });
  });
  it('límite nulo = sin tope; sin suscripción = sin tope', async () => {
    expect((await reservarCupo(dbCon(plan({ max_sucursales: null }), { sucursales: 999, garitas: 0 }), 'e', 'sucursales')).ok).toBe(true);
    expect((await reservarCupo(dbCon(null, { sucursales: 999, garitas: 999 }), 'e', 'garitas')).ok).toBe(true);
  });
  it('el mensaje dice el plan, el tope y cuánto se usa', () => {
    expect(mensajeLimite('garitas', { ok: false, usados: 1, limite: 1, plan: 'Básico' })).toBe('Tu plan Básico permite hasta 1 garitas y ya usas 1. Pide un plan mayor para agregar más.');
  });

  it('asignar sin suscripción previa y sin plan es un error de programación', async () => {
    const db = { query: jest.fn(async () => ({ rows: [] })) };
    await expect(asignarSuscripcion(db, { empresaId: 'e', usuarioId: null })).rejects.toThrow(/plan/);
  });
});
