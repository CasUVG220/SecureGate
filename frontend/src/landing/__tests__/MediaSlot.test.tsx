import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaSlot } from '../componentes/MediaSlot';

const conMovimientoReducido = (reducido: boolean) => {
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
    matches: reducido && query.includes('prefers-reduced-motion'),
    media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
};

afterEach(() => vi.restoreAllMocks());

describe('MediaSlot · imagen', () => {
  it('carga desde public/landing con medidas explícitas, lazy y texto alternativo', () => {
    render(<MediaSlot archivo="card-garita.jpg" ancho={1200} alto={1500} alt="Pantalla de la garita" />);
    const img = screen.getByRole('img', { name: 'Pantalla de la garita' });
    expect(img).toHaveAttribute('src', '/landing/card-garita.jpg');
    expect(img).toHaveAttribute('width', '1200');
    expect(img).toHaveAttribute('height', '1500');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('la imagen prioritaria (póster del hero) no es lazy y pide prioridad alta', () => {
    render(<MediaSlot archivo="hero-poster.jpg" ancho={1920} alto={1080} alt="Garita" prioridad />);
    const img = screen.getByRole('img', { name: 'Garita' });
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high');
  });

  it('si el archivo no existe muestra el hueco con el nombre, la proporción y las medidas, y conserva el alt', () => {
    const { container } = render(<MediaSlot archivo="seccion-qr.jpg" ancho={1500} alto={1000} alt="Invitación con QR en un teléfono" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Invitación con QR en un teléfono' })).toBeInTheDocument();
    expect(screen.getByText('seccion-qr.jpg')).toBeInTheDocument();
    expect(screen.getByText('3:2 · 1500 × 1000 px')).toBeInTheDocument();
    expect(screen.getByText('public/landing/')).toBeInTheDocument();
  });

  it('reserva el espacio con aspect-ratio y aplica el recorte como clip-path', () => {
    const { container } = render(
      <MediaSlot archivo="card-admin.jpg" ancho={1200} alto={1500} alt="Panel" proporcion="1 / 1" recorte="0 0, 100 0, 100 88, 0 100" />,
    );
    const caja = container.firstElementChild as HTMLElement;
    expect(caja.style.aspectRatio).toBe('1 / 1');
    expect(caja.style.getPropertyValue('--l-recorte')).toBe('polygon(0% 0%, 100% 0%, 100% 88%, 0% 100%)');
    expect(caja).toHaveClass('l-recorte');
  });
});

describe('MediaSlot · video', () => {
  const video = { mp4: 'hero.mp4', webm: 'hero.webm' };

  it('monta <video autoplay muted loop playsinline preload="metadata" poster> sobre el póster', () => {
    conMovimientoReducido(false);
    const { container } = render(<MediaSlot archivo="hero-poster.jpg" ancho={1920} alto={1080} alt="Garita" prioridad video={video} />);
    const v = container.querySelector('video')!;
    expect(v).not.toBeNull();
    expect(v.autoplay).toBe(true);
    expect(v.muted).toBe(true);
    expect(v).toHaveAttribute('muted');
    expect(v.loop).toBe(true);
    expect(v).toHaveAttribute('playsinline');
    expect(v).toHaveAttribute('preload', 'metadata');
    expect(v).toHaveAttribute('poster', '/landing/hero-poster.jpg');
    expect([...v.querySelectorAll('source')].map(s => s.getAttribute('src'))).toEqual(['/landing/hero.webm', '/landing/hero.mp4']);
  });

  it('con prefers-reduced-motion queda solo el póster', () => {
    conMovimientoReducido(true);
    const { container } = render(<MediaSlot archivo="hero-poster.jpg" ancho={1920} alto={1080} alt="Garita" prioridad video={video} />);
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByRole('img', { name: 'Garita' })).toBeInTheDocument();
  });

  it('sin video ni póster, el hueco nombra los tres archivos', () => {
    conMovimientoReducido(false);
    const { container } = render(<MediaSlot archivo="hero-poster.jpg" ancho={1920} alto={1080} alt="Garita" prioridad video={video} />);
    fireEvent.error(container.querySelectorAll('source')[1]);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByText('hero.mp4 · hero.webm · hero-poster.jpg')).toBeInTheDocument();
    expect(screen.getByText('16:9 · 1920 × 1080 px')).toBeInTheDocument();
  });

  it('el video que se mueve solo se puede pausar (WCAG 2.2.2)', () => {
    conMovimientoReducido(false);
    const pausa = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const { container } = render(<MediaSlot archivo="hero-poster.jpg" ancho={1920} alto={1080} alt="Garita" prioridad video={video} />);
    const v = container.querySelector('video')!;
    Object.defineProperty(v, 'paused', { configurable: true, get: () => false });
    fireEvent.playing(v);
    fireEvent.click(screen.getByRole('button', { name: 'Pausar video' }));
    expect(pausa).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Reproducir video' })).toBeInTheDocument();
  });
});
