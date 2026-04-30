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

const parseDpi = (text: string): { nombre: string; numero_dpi: string } => {
  const dpiMatch = text.match(/\b\d{13}\b/);
  const numero_dpi = dpiMatch?.[0] ?? '';

  let nombre = '';
  const nombreMatch = text.match(/(?:Nombre|Name)\s*:?\s*([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ\s]+)/);
  if (nombreMatch) {
    nombre = nombreMatch[1].trim().replace(/\s+/g, ' ');
  } else {
    for (const line of text.split('\n')) {
      const clean = line.trim();
      if (/^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ\s]{3,}$/.test(clean)) {
        nombre = clean;
        break;
      }
    }
  }

  return { nombre, numero_dpi };
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
    const { nombre, numero_dpi } = parseDpi(texto_completo);
    res.json({ nombre, numero_dpi, texto_completo });
  } catch {
    res.json({ nombre: '', numero_dpi: '', texto_completo: '', error: 'No se pudo leer el DPI' });
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