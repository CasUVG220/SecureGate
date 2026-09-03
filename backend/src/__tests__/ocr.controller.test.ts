/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * ocr.controller.ts llamaba a Google Vision y, ante CUALQUIER fallo (API
 * caída, timeout, credencial inválida, cuota excedida), respondía 200 OK con
 * campos vacíos — indistinguible de "el documento está borroso". El catch
 * vacío tampoco dejaba rastro en logs. Estos tests fijan el contrato correcto:
 * un fallo técnico del servicio de OCR debe salir como 4xx/5xx (nunca 200),
 * un documento ilegible debe salir como 422 (nunca 200 con campos vacíos), y
 * el happy path original no debe romperse.
 */
import type { Request, Response } from 'express';
import { scanDpi, scanPlaca } from '../controllers/ocr.controller';

function makeRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

const makeReq = (body: Record<string, unknown> = { image: 'base64img' }) =>
  ({ body }) as unknown as Request;

const visionOk = (text: string) => ({
  ok: true,
  status: 200,
  json: async () => ({
    responses: [
      { textAnnotations: text ? [{ description: text }] : [] },
    ],
  }),
});

const visionOkWithError = (message: string) => ({
  ok: true,
  status: 200,
  json: async () => ({
    responses: [{ error: { message } }],
  }),
});

const visionHttpError = (status: number, googleStatus: string, message = 'boom') => ({
  ok: false,
  status,
  json: async () => ({ error: { status: googleStatus, message } }),
});

describe('scanDpi', () => {
  const originalFetch = global.fetch;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    consoleErrorSpy.mockRestore();
  });

  it('éxito normal: extrae nombre y DPI y responde 200 (happy path sin romper)', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      visionOk('NOMBRES: JUAN PEREZ\nAPELLIDOS: LOPEZ\n1234 56789 0123')
    ) as unknown as typeof fetch;

    const res = makeRes();
    await scanDpi(makeReq(), res);

    expect(res.status).not.toHaveBeenCalledWith(422);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.numero_dpi).toBe('1234567890123');
    expect(payload.nombre).toContain('JUAN PEREZ');
    expect(payload.error).toBeUndefined();
  });

  it('error técnico (red caída) → 503, no 200, y se loguea', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const res = makeRes();
    await scanDpi(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: expect.any(String) });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('credencial inválida (PERMISSION_DENIED de Google) → 500, no 200, y se loguea con detalle', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      visionHttpError(403, 'PERMISSION_DENIED', 'API key invalid')
    ) as unknown as typeof fetch;

    const res = makeRes();
    await scanDpi(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(consoleErrorSpy).toHaveBeenCalled();
    const loggedContext = consoleErrorSpy.mock.calls[0][1];
    expect(loggedContext.endpoint).toBe('scanDpi');
    expect(loggedContext.error.status).toBe(500);
  });

  it('cuota excedida (RESOURCE_EXHAUSTED) → 503, no 200', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      visionHttpError(429, 'RESOURCE_EXHAUSTED')
    ) as unknown as typeof fetch;

    const res = makeRes();
    await scanDpi(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('servicio no disponible (UNAVAILABLE) → 503, no 200', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      visionHttpError(503, 'UNAVAILABLE')
    ) as unknown as typeof fetch;

    const res = makeRes();
    await scanDpi(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('documento ilegible (imagen corrupta reportada por Vision) → 422, no 200 con campos vacíos', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      visionOkWithError('Bad image data.')
    ) as unknown as typeof fetch;

    const res = makeRes();
    await scanDpi(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect((res.json as jest.Mock).mock.calls[0][0].error).toMatch(/foto más clara/i);
  });

  it('documento sin texto detectable (foto borrosa) → 422, no 200 con campos vacíos', async () => {
    global.fetch = jest.fn().mockResolvedValue(visionOk('')) as unknown as typeof fetch;

    const res = makeRes();
    await scanDpi(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('sin imagen en el body → 400', async () => {
    const res = makeRes();
    await scanDpi(makeReq({}), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('scanPlaca', () => {
  const originalFetch = global.fetch;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    consoleErrorSpy.mockRestore();
  });

  it('éxito normal: extrae la placa y responde 200 (happy path sin romper)', async () => {
    global.fetch = jest.fn().mockResolvedValue(visionOk('P123ABC')) as unknown as typeof fetch;

    const res = makeRes();
    await scanPlaca(makeReq(), res);

    expect(res.status).not.toHaveBeenCalledWith(422);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.placa).toBe('P123ABC');
    expect(payload.error).toBeUndefined();
  });

  it('error técnico del servicio OCR → 500/503, no 200, y se loguea', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;

    const res = makeRes();
    await scanPlaca(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('placa ilegible (sin texto detectado) → 422, no 200 con campos vacíos', async () => {
    global.fetch = jest.fn().mockResolvedValue(visionOk('')) as unknown as typeof fetch;

    const res = makeRes();
    await scanPlaca(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(422);
  });
});
