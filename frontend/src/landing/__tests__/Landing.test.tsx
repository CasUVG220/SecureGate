import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Landing from '../Landing';

describe('Landing · estructura y navegación', () => {
  it('tiene un solo h1, con el titular', () => {
    render(<Landing />);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Quién entra, a qué hora y quién lo autorizó. Todo registrado.');
  });

  it('el enlace para saltar al contenido apunta al <main>', () => {
    render(<Landing />);
    expect(screen.getByRole('link', { name: 'Saltar al contenido' })).toHaveAttribute('href', '#contenido');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'contenido');
  });

  it('«Ingresar» lleva a la ruta de acceso de la app y «Pedir demo» baja al formulario', () => {
    render(<Landing />);
    expect(screen.getByRole('link', { name: 'Ingresar' })).toHaveAttribute('href', '/personal');
    const demos = screen.getAllByRole('link', { name: /Pedir demo/ });
    expect(demos.length).toBeGreaterThanOrEqual(2);   // barra y hero
    for (const a of demos) expect(a).toHaveAttribute('href', '#contacto');
    expect(screen.getByRole('link', { name: 'Ver precios' })).toHaveAttribute('href', '#precios');
  });

  it('la barra tiene los cuatro enlaces de sección', () => {
    render(<Landing />);
    const [barra] = screen.getAllByRole('navigation', { name: 'Secciones' });
    expect(within(barra).getAllByRole('link').map(a => a.getAttribute('href')))
      .toEqual(['#como-funciona', '#que-hace', '#precios', '#preguntas']);
  });

  it('en teléfono, «Menú» abre y cierra el panel (aria-expanded) y Escape lo cierra', () => {
    render(<Landing />);
    const boton = screen.getByRole('button', { name: 'Menú' });
    const panel = document.getElementById('l-menu')!;
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    expect(panel).toHaveAttribute('hidden');
    fireEvent.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveAttribute('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Menú' })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Landing · encabezados', () => {
  it('no saltan niveles (h1 → h2 → h3)', () => {
    render(<Landing />);
    const niveles = [...document.querySelectorAll('h1, h2, h3, h4')].map(h => Number(h.tagName[1]));
    for (let i = 1; i < niveles.length; i++) expect(niveles[i] - niveles[i - 1]).toBeLessThanOrEqual(1);
  });

  it('las tres partes del sistema son h3 bajo su h2', () => {
    render(<Landing />);
    const seccion = screen.getByRole('heading', { level: 2, name: 'Las tres partes de SecureGate' }).closest('section')!;
    expect(within(seccion).getAllByRole('heading', { level: 3 }).map(h => h.textContent))
      .toEqual(['Garita', 'Portal del residente', 'Administración']);
  });
});

describe('Landing · cómo funciona', () => {
  it('cuatro pasos en una lista ordenada, en la sección oscura', () => {
    render(<Landing />);
    const seccion = document.getElementById('como-funciona')!;
    expect(seccion).toHaveClass('l-oscuro');
    expect(within(seccion).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual([
      'Paso 1: El residente invita', 'Paso 2: La garita lee placa o DPI', 'Paso 3: Se autoriza o se rechaza', 'Paso 4: Queda en la bitácora',
    ]);
    expect(seccion.querySelector('ol')!.children).toHaveLength(4);
  });

  it('el registro de ejemplo se declara ficticio y usa el formato de placa de la app', () => {
    render(<Landing />);
    const seccion = document.getElementById('como-funciona')!;
    expect(within(seccion).getByText(/datos ficticios/i)).toBeInTheDocument();
    expect(within(seccion).getByText('P-123ABC')).toBeInTheDocument();
  });
});

describe('Landing · lo que hace hoy', () => {
  it('es una lista de especificación (dl), no tarjetas: ocho funciones con su rótulo técnico', () => {
    render(<Landing />);
    const seccion = document.getElementById('que-hace')!;
    const nombres = [...seccion.querySelectorAll('dt')].map(dt => dt.textContent?.replace(/^\d{2}/, ''));
    expect(nombres).toHaveLength(8);
    expect(nombres[0]).toBe('Garita que no depende del internet');
    for (const tecnica of ['SQLCipher', 'OCR local', 'ONVIF · RTSP · MJPEG', 'TOTP']) {
      expect(within(seccion).getByText(tecnica)).toBeInTheDocument();
    }
  });

  it('las dos imágenes intercaladas tienen texto alternativo y pie', () => {
    render(<Landing />);
    const seccion = document.getElementById('que-hace')!;
    const imgs = within(seccion).getAllByRole('img');
    expect(imgs.map(i => i.getAttribute('src'))).toEqual(['/landing/seccion-camaras.jpg', '/landing/seccion-qr.jpg']);
    for (const i of imgs) expect(i.getAttribute('alt')!.length).toBeGreaterThan(20);
    expect(seccion.querySelectorAll('figcaption')).toHaveLength(2);
  });
});

describe('Landing · preguntas frecuentes', () => {
  it('ocho preguntas en <details>/<summary> nativos, cerradas al cargar', () => {
    render(<Landing />);
    const detalles = document.querySelectorAll('#preguntas details');
    expect(detalles).toHaveLength(8);
    for (const d of detalles) {
      expect(d.querySelector('summary')).not.toBeNull();
      expect(d).not.toHaveAttribute('open');
    }
  });

  it('lo que no se sabe queda visible como [POR CONFIRMAR], no inventado', () => {
    render(<Landing />);
    const resumen = (texto: string) => [...document.querySelectorAll('#preguntas summary')].find(s => s.textContent === texto)!;
    for (const q of ['¿Cuánto tarda la instalación?', '¿Qué cuenta como un hogar para el cobro?', '¿Cómo se pide factura?']) {
      expect(resumen(q).parentElement!.textContent).toMatch(/\[POR CONFIRMAR: .+\]/);
    }
    expect(resumen('¿Cuál es el contrato mínimo del alquiler?').parentElement!.textContent).toContain('36 meses');
  });
});

describe('Landing · anti-plantilla (criterio de aceptación)', () => {
  const texto = () => {
    render(<Landing />);
    return document.body.textContent ?? '';
  };

  it('sin emojis', () => {
    expect(texto()).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('sin superlativos ni frases de plantilla', () => {
    const t = texto().toLowerCase();
    for (const frase of [
      'el mejor', 'la mejor', 'superior', 'revolucionari', 'solución definitiva', 'potencia tu', 'potenciá',
      'rápida y sencilla', 'rápido y sencillo', 'de forma rápida', 'líder', 'innovador', 'de clase mundial', 'confían en nosotros',
    ]) {
      expect([frase, t.includes(frase)]).toEqual([frase, false]);
    }
  });

  it('voseo consistente: sin imperativos ni formas de tuteo en lo que se lee', () => {
    const t = texto().toLowerCase();
    // «se pide» (impersonal) no es tuteo: solo cuenta el imperativo suelto.
    for (const tuteo of [/(?<!se )\bpide\b/, /\bescríbenos\b/, /\belige\b/, /\bdéjanos\b/, /\brevisa\b/, /\bpuedes\b/, /\btienes\b/, /\bcontáctanos\b/]) {
      expect([String(tuteo), tuteo.test(t)]).toEqual([String(tuteo), false]);
    }
  });
});
