/**
 * SCRUM-115 / H11 — anuncios: el residente tiene su página (separada de la campana), la campana lleva a ella y
 * en la tabla del administrador «Lecturas» se explica (y un cero dice por qué).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import MisAnunciosPage from '../pages/MisAnunciosPage';
import AnunciosPage from '../pages/AnunciosPage';
import AnnouncementsBell from '../components/AnnouncementsBell';
import { ANUNCIOS_CAMBIARON, avisarAnunciosCambiaron } from '../utils/eventos';
import * as api from '../services/api';

vi.mock('../services/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  getMisAnuncios: vi.fn(), marcarAnuncioLeido: vi.fn(), getAnuncios: vi.fn(),
  decodeTokenPayload: vi.fn(() => ({ sucursal_id: 's1' })),
}));
const m = (k: string) => (api as unknown as Record<string, ReturnType<typeof vi.fn>>)[k];

const mi = (over: Partial<api.MiAnuncio>): api.MiAnuncio => ({
  id: 'a', titulo: 'Anuncio', contenido: 'Texto', prioridad: 'normal', vigente_desde: '2026-10-01T00:00:00Z', vigente_hasta: null,
  created_at: '2026-10-01T12:00:00Z', leido: false, leido_at: null, es_personal: false, ...over,
});
const LISTA = [
  mi({ id: 'c1', titulo: 'Corte de agua', contenido: 'Mañana de 9 a 12\nTraigan reservas', prioridad: 'urgente', vigente_hasta: '2026-12-31T00:00:00Z' }),
  mi({ id: 'c2', titulo: 'Reunión de vecinos', leido: true, leido_at: '2026-10-02T00:00:00Z' }),
  mi({ id: 'p1', titulo: 'Tu comprobante fue aprobado', es_personal: true, prioridad: 'importante' }),
];

beforeEach(() => {
  vi.clearAllMocks();
  m('getMisAnuncios').mockResolvedValue(LISTA);
  m('marcarAnuncioLeido').mockResolvedValue({ anuncio_id: 'x', leido: true });
});

describe('MisAnunciosPage', () => {
  it('separa los avisos para la persona de los comunicados de la comunidad y muestra el texto entero', async () => {
    render(<MisAnunciosPage />);
    const personales = await screen.findByRole('region', { name: 'Avisos para ti' });
    expect(within(personales).getByText('Tu comprobante fue aprobado')).toBeInTheDocument();
    const comunidad = screen.getByRole('region', { name: 'Comunicados de la comunidad' });
    expect(within(comunidad).getByText('Corte de agua')).toBeInTheDocument();
    expect(within(comunidad).getByText('Reunión de vecinos')).toBeInTheDocument();
    expect(within(comunidad).queryByText('Tu comprobante fue aprobado')).not.toBeInTheDocument();
    expect(within(comunidad).getByText(/Traigan reservas/)).toBeInTheDocument();       // sin recortar
    expect(within(comunidad).getByText('Urgente')).toBeInTheDocument();
    expect(within(comunidad).getByText(/Vigente hasta 31 dic 2026/)).toBeInTheDocument();
  });

  it('lo no leído se marca «Nuevo» y se puede marcar uno o todos; avisa a la campana', async () => {
    const aviso = vi.fn();
    window.addEventListener(ANUNCIOS_CAMBIARON, aviso);
    render(<MisAnunciosPage />);
    await screen.findByText('Corte de agua');
    expect(screen.getAllByText('Nuevo')).toHaveLength(2);

    const tarjeta = screen.getByRole('article', { name: 'Corte de agua' });
    fireEvent.click(within(tarjeta).getByRole('button', { name: 'Marcar como leído' }));
    await waitFor(() => expect(m('marcarAnuncioLeido')).toHaveBeenCalledWith('c1'));
    expect(within(tarjeta).queryByText('Nuevo')).not.toBeInTheDocument();
    await waitFor(() => expect(aviso).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Marcar todos como leídos' }));
    await waitFor(() => expect(m('marcarAnuncioLeido')).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(screen.queryByText('Nuevo')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Marcar todos como leídos' })).not.toBeInTheDocument();
    window.removeEventListener(ANUNCIOS_CAMBIARON, aviso);
  });

  it('si no se pudo marcar, vuelve a «Nuevo» y avisa', async () => {
    m('marcarAnuncioLeido').mockRejectedValue(new Error('x'));
    render(<MisAnunciosPage />);
    await screen.findByText('Corte de agua');
    const tarjeta = screen.getByRole('article', { name: 'Corte de agua' });
    fireEvent.click(within(tarjeta).getByRole('button', { name: 'Marcar como leído' }));
    await waitFor(() => expect(within(tarjeta).getByText('Nuevo')).toBeInTheDocument());
  });

  it('el filtro «Sin leer» deja solo lo pendiente y cuenta cuántos hay', async () => {
    render(<MisAnunciosPage />);
    await screen.findByText('Corte de agua');
    fireEvent.click(screen.getByRole('button', { name: 'Sin leer (2)' }));
    expect(screen.queryByText('Reunión de vecinos')).not.toBeInTheDocument();
    expect(screen.getByText('Corte de agua')).toBeInTheDocument();
  });

  it('sin anuncios, y con error, dice qué pasa', async () => {
    m('getMisAnuncios').mockResolvedValueOnce([]);
    const { unmount } = render(<MisAnunciosPage />);
    expect(await screen.findByText('No hay anuncios por ahora.')).toBeInTheDocument();
    unmount();

    m('getMisAnuncios').mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(LISTA);
    render(<MisAnunciosPage />);
    expect(await screen.findByText('No se pudieron cargar los anuncios.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Corte de agua')).toBeInTheDocument();
  });
});

describe('AnnouncementsBell', () => {
  it('rotula lo personal, y el pie lleva a la página de anuncios', async () => {
    const onVerTodos = vi.fn();
    render(<AnnouncementsBell onVerTodos={onVerTodos} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Anuncios' }));
    expect(await screen.findByText('Para ti')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver todos los anuncios' }));
    expect(onVerTodos).toHaveBeenCalledTimes(1);
  });

  it('sin la ruta no ofrece el enlace, y recalcula cuando la página marca algo', async () => {
    render(<AnnouncementsBell />);
    await screen.findByRole('button', { name: 'Anuncios' });
    expect(screen.queryByRole('button', { name: 'Ver todos los anuncios' })).not.toBeInTheDocument();
    m('getMisAnuncios').mockClear();
    avisarAnunciosCambiaron('pagina');
    await waitFor(() => expect(m('getMisAnuncios')).toHaveBeenCalled());
  });
});

describe('AnunciosPage (administrador) — «Lecturas» explicada', () => {
  const adm = (over: Partial<api.Anuncio>): api.Anuncio => ({
    id: 'a1', sucursal_id: 's1', titulo: 'Corte de agua', contenido: 'x', prioridad: 'normal',
    vigente_desde: '2026-10-01T00:00:00Z', vigente_hasta: null, creado_por: 'u', created_at: '2026-10-01T00:00:00Z',
    sucursal_nombre: 'P', creado_por_nombre: 'A', total_lecturas: 3, total_residentes: 45, ...over,
  });

  it('dice qué cuenta, «3 de 45», y un cero explica por qué', async () => {
    m('getAnuncios').mockResolvedValue([
      adm({ id: 'a1', titulo: 'Con lecturas' }),
      adm({ id: 'a2', titulo: 'Sin leer', total_lecturas: 0 }),
      adm({ id: 'a3', titulo: 'Futuro', total_lecturas: 0, vigente_desde: '2099-01-01T00:00:00Z' }),
      adm({ id: 'a4', titulo: 'Vencido', total_lecturas: 0, vigente_hasta: '2020-01-01T00:00:00Z' }),
      adm({ id: 'a5', titulo: 'Todos', total_lecturas: 45 }),
    ]);
    render(<AnunciosPage />);
    await screen.findAllByText('Con lecturas');
    expect(screen.getAllByText('Residentes que ya lo abrieron').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3 de 45').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Nadie lo ha abierto todavía').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Aún no está vigente: nadie puede verlo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ya no está vigente').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lo abrieron todos').length).toBeGreaterThan(0);
  });

  it('«Editar» está a la vista y «Eliminar» en el menú, no al mismo nivel', async () => {
    m('getAnuncios').mockResolvedValue([adm({})]);
    render(<AnunciosPage />);
    await screen.findAllByText('Corte de agua');
    expect(screen.getAllByRole('button', { name: 'Editar' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /Acciones: Corte de agua/ })[0]);
    expect(await screen.findByRole('menuitem', { name: 'Eliminar' })).toBeInTheDocument();
  });
});
