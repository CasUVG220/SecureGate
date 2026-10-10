import { describe, expect, it } from 'vitest';
import { idDeCodigoManual } from '../qr';

const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('idDeCodigoManual', () => {
  it('acepta lo que lee el escáner y el id solo, en cualquier formato razonable', () => {
    expect(idDeCodigoManual(`SGQR:${ID}`)).toBe(ID);
    expect(idDeCodigoManual(`sgqr: ${ID}  `)).toBe(ID);
    expect(idDeCodigoManual(ID)).toBe(ID);
    expect(idDeCodigoManual(ID.toUpperCase())).toBe(ID);
    expect(idDeCodigoManual(ID.replace(/-/g, ''))).toBe(ID);
    expect(idDeCodigoManual(`3f2504e0 4f89 11d3 9a0c 0305e82c3301`)).toBe(ID);
  });

  it('rechaza lo que no es un id de invitación', () => {
    for (const malo of ['', '   ', 'hola', 'SGQR:', '3f2504e0-4f89-11d3-9a0c-0305e82c33', `${ID}0`, 'zzzzzzzz-4f89-11d3-9a0c-0305e82c3301', 'https://x.com/3f2504e0']) {
      expect(idDeCodigoManual(malo), JSON.stringify(malo)).toBeNull();
    }
  });
});
