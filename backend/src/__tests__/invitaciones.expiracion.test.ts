/**
 * ── Hallazgo S-02 (backend/securitytest, Sprint 8) ───────────────────────────
 * Backend con TZ=America/Guatemala + Postgres en UTC: `pg` lee los TIMESTAMP sin
 * zona como hora local, o sea 6 h en el futuro. La caducidad de la invitación se
 * comparaba en JS y una invitación vencida hace 1 minuto seguía aceptándose.
 * Ahora la decide Postgres (`vencida = expira_en <= NOW()`); estos tests fijan
 * que el estado efectivo obedece a esa bandera y NO al Date de Node.
 */
import { estadoEfectivo } from '../controllers/invitaciones.controller';

const enElFuturoPorLaZona = new Date(Date.now() + 6 * 3600_000 - 60_000); // vencida hace 1 min, leída como +6 h

it('vencida según Postgres → expirada, aunque Node crea que la fecha es futura (el bug original)', () => {
  expect(estadoEfectivo({ estado: 'pendiente', expira_en: enElFuturoPorLaZona, vencida: true })).toBe('expirada');
});

it('no vencida según Postgres → sigue pendiente', () => {
  expect(estadoEfectivo({ estado: 'pendiente', expira_en: new Date(Date.now() - 3600_000), vencida: false })).toBe('pendiente');
});

it('sin la bandera cae a la comparación de fechas (compatibilidad)', () => {
  expect(estadoEfectivo({ estado: 'pendiente', expira_en: new Date(Date.now() - 1000) })).toBe('expirada');
  expect(estadoEfectivo({ estado: 'pendiente', expira_en: new Date(Date.now() + 3600_000) })).toBe('pendiente');
});

it.each(['aceptada', 'revocada', 'expirada'] as const)('un estado terminal (%s) no cambia', estado => {
  expect(estadoEfectivo({ estado, expira_en: new Date(0), vencida: false })).toBe(estado);
});
