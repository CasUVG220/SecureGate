/**
 * getConfigQrEfectiva() es la fuente de verdad que consultan tanto el GET de
 * administración como registrarAcceso/createMisInvitacion — si no devuelve
 * los defaults correctos cuando la sucursal nunca guardó nada, cada sucursal
 * nueva heredaría reglas equivocadas en silencio (ej. DPI no obligatorio
 * cuando el default real es exigirlo).
 */
import { getConfigQrEfectiva, DEFAULTS_QR } from '../controllers/configQr.controller';

describe('getConfigQrEfectiva', () => {
  it('devuelve los defaults sin tocar la fila cuando la sucursal no tiene configuración guardada', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const config = await getConfigQrEfectiva({ query }, 'suc-sin-config');

    expect(config).toEqual(DEFAULTS_QR);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('devuelve los valores guardados cuando existe fila para la sucursal', async () => {
    const row = {
      sucursal_id: 'suc-1',
      dpi_obligatorio_individual: false,
      requiere_placa: true,
      autorizacion_automatica: true,
      max_intentos_fallidos: 10,
      bloqueo_minutos: 30,
      updated_at: new Date(),
    };
    const query = jest.fn().mockResolvedValue({ rows: [row] });
    const config = await getConfigQrEfectiva({ query }, 'suc-1');

    expect(config).toEqual({
      dpi_obligatorio_individual: false,
      requiere_placa: true,
      autorizacion_automatica: true,
      max_intentos_fallidos: 10,
      bloqueo_minutos: 30,
    });
  });
});
