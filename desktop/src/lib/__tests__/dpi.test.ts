import { describe, expect, it } from 'vitest';
import { resumenLectura, textosRevision } from '../dpi';
import type { ResultadoDpi } from '../tauri';

const lectura = (over: Partial<ResultadoDpi> = {}): ResultadoDpi => ({
  origen: 'local', cui: '1234567890101', nombres: 'ANA', apellidos: 'LOPEZ', nombre_completo: 'ANA LOPEZ',
  confianza: { cui: 0.97, nombres: 0.95, apellidos: 0.96 }, cui_valido: true, revision_obligatoria: false,
  motivos: [], correcciones: 0, ms_total: 500, aviso: null, ...over,
});

describe('textos de la lectura del DPI (T5)', () => {
  it('traduce los motivos técnicos a frases sin jerga y sin duplicados', () => {
    const t = textosRevision({ motivos: ['cui_corregido', 'cui_corregido', 'cui_confianza_baja'] });
    expect(t).toEqual([
      'Había caracteres dudosos en el número (por ejemplo una letra donde va un dígito) y se corrigieron.',
      'El número se leyó con poca seguridad.',
    ]);
  });

  it('un motivo desconocido se resume en una frase general (no se muestra el código)', () => {
    expect(textosRevision({ motivos: ['algo_nuevo'] })).toEqual(['Algunos datos se leyeron con dudas.']);
    expect(textosRevision({ motivos: [] })).toEqual([]);
  });

  it('el resumen dice de dónde salió y nunca incluye el número ni el nombre', () => {
    for (const r of [lectura(), lectura({ origen: 'remoto', revision_obligatoria: true })]) {
      const t = resumenLectura(r);
      expect(t).not.toContain('1234567890101');
      expect(t).not.toContain('ANA');
    }
    expect(resumenLectura(lectura())).toContain('leído en este equipo');
    expect(resumenLectura(lectura({ origen: 'remoto', revision_obligatoria: true }))).toContain('servicio remoto');
    expect(resumenLectura(lectura({ revision_obligatoria: true }))).toContain('confírmalos antes de registrar');
  });
});
