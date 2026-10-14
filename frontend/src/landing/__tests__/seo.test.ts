import { describe, expect, it } from 'vitest';
import { etiquetasSeo, jsonLd } from '../seo';

describe('SEO del landing', () => {
  it('JSON-LD SoftwareApplication con los montos de planes.ts y sin calificaciones inventadas', () => {
    const d = jsonLd('https://securegate.example');
    expect(d['@type']).toBe('SoftwareApplication');
    expect(d.offers).toMatchObject({ '@type': 'AggregateOffer', priceCurrency: 'GTQ', lowPrice: '896.00', highPrice: '15120.00' });
    expect(JSON.stringify(d)).not.toMatch(/aggregateRating|review|ratingValue/i);
  });

  it('con VITE_SITE_URL: og:image absoluta, og:url y canonical', () => {
    const html = etiquetasSeo('https://securegate.example/');
    expect(html).toContain('<meta property="og:image" content="https://securegate.example/landing/og.jpg" />');
    expect(html).toContain('<meta property="og:url" content="https://securegate.example/" />');
    expect(html).toContain('<link rel="canonical" href="https://securegate.example/" />');
    expect(html).toContain('<title>SecureGate · Control de acceso para residenciales</title>');
    expect(html.match(/<meta name="description" content="([^"]+)"/)![1].length).toBeLessThanOrEqual(160);
  });

  it('sin VITE_SITE_URL no inventa un dominio: imagen relativa y sin og:url', () => {
    const html = etiquetasSeo('');
    expect(html).toContain('content="/landing/og.jpg"');
    expect(html).not.toContain('og:url');
    expect(html).not.toContain('canonical');
  });

  it('el JSON-LD no puede cerrar el <script> que lo contiene', () => {
    expect(etiquetasSeo('https://x.example')).not.toMatch(/<\/script>.*<\/script>/s);
    const json = etiquetasSeo('').match(/<script type="application\/ld\+json">(.*)<\/script>/s)![1];
    expect(() => JSON.parse(json)).not.toThrow();
  });
});
