import { describe, expect, it } from 'vitest';
// @ts-expect-error script sin tipos: sólo interesa que corra
import { diferencias } from '../../../../scripts/sync-ui.mjs';

/**
 * El kit de UI es una copia byte a byte de frontend/src/components/ui (ver
 * scripts/sync-ui.mjs). Si alguien edita la copia o la web cambia un
 * componente, este test lo detecta antes de que las dos apps diverjan.
 */
describe('kit de UI compartido', () => {
  it('desktop/src/components/ui es idéntico a frontend/src/components/ui', () => {
    expect(diferencias()).toEqual([]);
  });
});
