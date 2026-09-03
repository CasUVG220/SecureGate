import { Request, Response } from 'express';

const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';

/**
 * Fallo técnico real del servicio de OCR (red caída, timeout, credencial
 * inválida, cuota excedida, respuesta 5xx de Google). Nunca debe traducirse
 * en un 200 OK — el cliente necesita saber que el servicio falló, no que el
 * documento es ilegible.
 */
export class OcrTechnicalError extends Error {
  status: number;
  details: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'OcrTechnicalError';
    this.status = status;
    this.details = details;
  }
}

/** Error de negocio: la imagen en sí es ilegible/corrupta/de mal formato. */
export class OcrDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrDocumentError';
  }
}

const callVision = async (base64: string): Promise<string> => {
  const key = process.env.GOOGLE_CLOUD_API_KEY;

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${VISION_URL}?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: base64 },
          features: [{ type: 'TEXT_DETECTION' }],
        }],
      }),
    });
  } catch (err) {
    throw new OcrTechnicalError('No se pudo conectar con el servicio de OCR', 503, err);
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json() as Record<string, unknown>;
  } catch (err) {
    throw new OcrTechnicalError('Respuesta inválida del servicio de OCR', 502, err);
  }

  if (!res.ok) {
    const errInfo = data.error as { status?: string; message?: string } | undefined;
    const googleStatus = errInfo?.status;

    if (googleStatus === 'PERMISSION_DENIED' || googleStatus === 'UNAUTHENTICATED') {
      throw new OcrTechnicalError('Credenciales inválidas para el servicio de OCR', 500, errInfo);
    }
    if (googleStatus === 'RESOURCE_EXHAUSTED') {
      throw new OcrTechnicalError('Cuota del servicio de OCR excedida', 503, errInfo);
    }
    if (googleStatus === 'UNAVAILABLE' || googleStatus === 'DEADLINE_EXCEEDED' || res.status >= 500) {
      throw new OcrTechnicalError('Servicio de OCR no disponible', 503, errInfo);
    }
    throw new OcrTechnicalError(`Error del servicio de OCR (HTTP ${res.status})`, 500, errInfo);
  }

  const responses = data.responses as Array<Record<string, unknown>> | undefined;
  const firstResponse = responses?.[0];

  // Vision responde 200 pero marca un error por-imagen (ej. "Bad image data")
  // cuando el archivo enviado es inválido/corrupto — eso sí es culpa del
  // documento, no del servicio.
  const visionError = firstResponse?.error as { message?: string } | undefined;
  if (visionError) {
    throw new OcrDocumentError(visionError.message ?? 'Imagen no válida');
  }

  const annotations = firstResponse?.textAnnotations as Array<{ description: string }> | undefined;
  return annotations?.[0]?.description ?? '';
};

const logOcrError = (endpoint: string, docType: string, err: unknown) => {
  console.error(`[ocr.controller] fallo en ${endpoint}`, {
    endpoint,
    docType,
    timestamp: new Date().toISOString(),
    error: err instanceof Error
      ? { name: err.name, message: err.message, ...(err instanceof OcrTechnicalError ? { status: err.status, details: err.details } : {}) }
      : err,
  });
};

const handleOcrFailure = (res: Response, endpoint: string, docType: string, err: unknown, illegibleMessage: string) => {
  logOcrError(endpoint, docType, err);

  if (err instanceof OcrDocumentError) {
    return res.status(422).json({ error: illegibleMessage });
  }

  const status = err instanceof OcrTechnicalError ? err.status : 500;
  return res.status(status).json({ error: 'No se pudo procesar el documento en este momento, intenta de nuevo más tarde' });
};

const SKIP_WORDS = /REPÚBLICA|GUATEMALA|LICENCIA|DOCUMENTO|IDENTIFICACIÓN|PERSONAL|CONDUCIR|RENAP|CATEGORIA|CATEGORÍA|VENCE|EMITIDA|CLASE|TIPO|FECHA|BLOOD|SANGRE|SEXO|NACIMIENTO|CENTROAMERICA|REGISTRO|NACIONAL|PERSONAS/i;

const cleanName = (s: string) => s.trim().replace(/\s+/g, ' ');


const parseIdentificacion = (text: string): { nombre: string; numero_dpi: string } => {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // ── CUI / DPI number (always 13 digits) ──────────────────────────────────
  const dpiMatch = text.match(/\b(\d{4}\s?\d{5}\s?\d{4})\b/);
  const numero_dpi = dpiMatch ? dpiMatch[1].replace(/\s+/g, '') : '';

  // ── Name extraction ───────────────────────────────────────────────────────
  let nombre = '';
  let nombresPart = '';
  let apellidosPart = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const upper = line.toUpperCase();

    // DPI Front & License Front Strategy
    if (upper.includes('NOMBRE') && !upper.includes('PRIMER') && !upper.includes('SEGUNDO')) {
      const parts = line.split(/NOMBRES?(?:\s*\/\s*GIVEN\s*NAMES)?\s*[:\-]?\s*/i);
      if (parts.length > 1 && parts[1].trim().length > 0) {
        nombresPart = parts[1].trim();
      } else if (i + 1 < lines.length && !nombresPart) {
        const nextLine = lines[i + 1];
        if (!nextLine.toUpperCase().includes('APELLIDO') && !nextLine.match(/\d/)) {
          nombresPart = nextLine;
        }
      }
    }

    if (upper.includes('APELLIDO') && !upper.includes('PRIMER') && !upper.includes('SEGUNDO')) {
      const parts = line.split(/APELLIDOS?(?:\s*\/\s*SURNAME)?\s*[:\-]?\s*/i);
      if (parts.length > 1 && parts[1].trim().length > 0) {
        apellidosPart = parts[1].trim();
      } else if (i + 1 < lines.length && !apellidosPart) {
        const nextLine = lines[i + 1];
        if (!nextLine.toUpperCase().includes('NACIONALIDAD') && !nextLine.toUpperCase().includes('NUMERO') && !nextLine.match(/\d/)) {
          apellidosPart = nextLine;
        }
      }
    }
  }

  if (nombresPart || apellidosPart) {
    nombre = cleanName(`${nombresPart} ${apellidosPart}`);
  }

  // Strategy 1: DPI Back (fallback)
  if (!nombre) {
    const pNombre = text.match(/Primer\s+Nombre\s*:?\s*([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ]+)/i)?.[1];
    const sNombre = text.match(/Segundo\s+Nombre\s*:?\s*([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ]+)/i)?.[1];
    const pApell  = text.match(/Primer\s+Apellido\s*:?\s*([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ]+)/i)?.[1];
    const sApell  = text.match(/Segundo\s+Apellido\s*:?\s*([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ]+)/i)?.[1];

    if (pNombre || pApell) {
      nombre = cleanName([pNombre, sNombre, pApell, sApell].filter(Boolean).join(' '));
    }
  }

  // Strategy 2: Single "Nombre:" field
  if (!nombre) {
    const m = text.match(/(?:^|\n)\s*Nombre\s*:?\s*([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ\s]{2,50})(?:\n|$)/im);
    if (m) nombre = cleanName(m[1]);
  }

  // Strategy 3: Fallback — first line that looks like a person's name
  if (!nombre) {
    for (const line of lines) {
      if (/\d/.test(line)) continue;
      if (line.length < 4 || line.length > 65) continue;
      if (SKIP_WORDS.test(line)) continue;
      if (/^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ\s]{3,}$/.test(line)) {
        nombre = line;
        break;
      }
    }
  }

  return { nombre: cleanName(nombre), numero_dpi };
};

const parsePlaca = (text: string): string => {
  const upper = text.toUpperCase().replace(/[^A-Z0-9\-\s]/g, ' ');
  const matches = upper.match(/[A-Z]{1,3}[-\s]?[0-9A-Z]{3,6}/g);
  if (!matches || matches.length === 0) return '';
  return matches.sort((a, b) => b.length - a.length)[0].trim().replace(/\s+/g, '-');
};

export const scanDpi = async (req: Request, res: Response) => {
  const { image } = req.body as { image?: string };
  if (!image) return res.status(400).json({ error: 'image requerida' });

  try {
    const texto_completo = await callVision(image);
    if (!texto_completo) {
      return res.status(422).json({ error: 'No se pudo leer el documento, intenta con una foto más clara' });
    }
    const { nombre, numero_dpi } = parseIdentificacion(texto_completo);
    res.json({ nombre, numero_dpi, texto_completo });
  } catch (err) {
    handleOcrFailure(res, 'scanDpi', 'DPI', err, 'No se pudo leer el documento, intenta con una foto más clara');
  }
};

export const scanPlaca = async (req: Request, res: Response) => {
  const { image } = req.body as { image?: string };
  if (!image) return res.status(400).json({ error: 'image requerida' });

  try {
    const texto_completo = await callVision(image);
    if (!texto_completo) {
      return res.status(422).json({ error: 'No se pudo leer la placa, intenta con una foto más clara' });
    }
    const placa = parsePlaca(texto_completo);
    res.json({ placa, texto_completo });
  } catch (err) {
    handleOcrFailure(res, 'scanPlaca', 'PLACA', err, 'No se pudo leer la placa, intenta con una foto más clara');
  }
};

