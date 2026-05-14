import { Request, Response } from 'express';

const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';

const callVision = async (base64: string): Promise<string> => {
  const key = process.env.GOOGLE_CLOUD_API_KEY;
  const res = await fetch(`${VISION_URL}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content: base64 },
        features: [{ type: 'TEXT_DETECTION' }],
      }],
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  const responses = data.responses as Array<Record<string, unknown>> | undefined;
  const annotations = responses?.[0]?.textAnnotations as Array<{ description: string }> | undefined;
  return annotations?.[0]?.description ?? '';
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

  // Vehículos particulares: 3 letras + separador opcional + 3 dígitos  (ej. ABC 123, ABC-123)
  const particular = upper.match(/\b([A-Z]{3})[\s\-]?(\d{3})\b/g);
  if (particular && particular.length > 0) {
    return particular[0].replace(/[\s\-]+/g, '-').trim();
  }

  // Motocicletas / placas cortas: 1-2 letras + separador + 3-5 dígitos  (ej. M-12345)
  const moto = upper.match(/\b([A-Z]{1,2})[\s\-](\d{3,5})\b/g);
  if (moto && moto.length > 0) {
    return moto[0].replace(/[\s\-]+/g, '-').trim();
  }

  return '';
};

export const scanDpi = async (req: Request, res: Response) => {
  const { image } = req.body as { image?: string };
  if (!image) return res.status(400).json({ error: 'image requerida' });

  try {
    const texto_completo = await callVision(image);
    const { nombre, numero_dpi } = parseIdentificacion(texto_completo);
    res.json({ nombre, numero_dpi, texto_completo });
  } catch {
    res.json({ nombre: '', numero_dpi: '', texto_completo: '', error: 'No se pudo leer el documento' });
  }
};

export const scanPlaca = async (req: Request, res: Response) => {
  const { image } = req.body as { image?: string };
  if (!image) return res.status(400).json({ error: 'image requerida' });

  try {
    const texto_completo = await callVision(image);
    const placa = parsePlaca(texto_completo);
    res.json({ placa, texto_completo });
  } catch {
    res.json({ placa: '', error: 'No se pudo leer la placa' });
  }
};

