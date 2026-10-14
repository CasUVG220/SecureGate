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

  it('voseo consistente: sin imperativos de tuteo en lo que se lee', () => {
    const t = ` ${texto().toLowerCase()} `;
    for (const tuteo of [' pide ', ' escríbenos ', ' elige ', ' déjanos ', ' revisa ', ' puedes ', ' tienes ', ' contáctanos ']) {
      expect([tuteo.trim(), t.includes(tuteo)]).toEqual([tuteo.trim(), false]);
    }
  });
});
