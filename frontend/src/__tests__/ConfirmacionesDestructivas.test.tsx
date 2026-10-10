/**
 * SCRUM-115 / H12 — cada acción destructiva pide confirmación en un diálogo de la app que dice qué va a pasar,
 * no hace nada hasta confirmar y no usa los cuadros del navegador.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AnunciosPage from '../pages/AnunciosPage';
import PreautPage from '../pages/PreautPage';
import GestionSucursales from '../pages/admin_empresa/GestionSucursales';
import OwnerEmpresas from '../pages/owner/OwnerEmpresas';
import AreasComunesPage from '../pages/AreasComunesPage';
import * as api from '../services/api';

vi.mock('../services/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  getAnuncios: vi.fn(), deleteAnuncio: vi.fn(),
  getPreautorizaciones: vi.fn(), deletePreautorizacion: vi.fn(), getResidentes: vi.fn(),
  getSucursales: vi.fn(), deleteSucursal: vi.fn(), getUsuarios: vi.fn(), deleteUsuario: vi.fn(),
  getInvitaciones: vi.fn(), revocarInvitacion: vi.fn(),
  getEmpresas: vi.fn(), deleteEmpresa: vi.fn(),
  getAreas: vi.fn(), deleteArea: vi.fn(),
  decodeTokenPayload: vi.fn(() => ({ empresa_id: 'emp-1', sucursal_id: 's1' })),
}));

const m = (k: string) => (api as unknown as Record<string, ReturnType<typeof vi.fn>>)[k];

/** Abre el diálogo, comprueba lo que dice y confirma con el botón que nombra la acción. */
const confirmarEn = async (nombreDialogo: string, mensaje: RegExp, botonConfirmar: string) => {
  const dialogo = await screen.findByRole('dialog', { name: nombreDialogo });
  expect(within(dialogo).getByText(mensaje)).toBeInTheDocument();
  fireEvent.click(within(dialogo).getByRole('button', { name: botonConfirmar }));
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('token', 'x');
  Element.prototype.scrollIntoView = vi.fn();
});

describe('confirmaciones destructivas', () => {
  it('Anuncios: eliminar explica que no se puede deshacer y recién entonces borra', async () => {
    m('getAnuncios').mockResolvedValue([{
      id: 'a1', sucursal_id: 's1', titulo: 'Corte de agua', contenido: 'x', prioridad: 'normal', vigente_desde: '2026-10-01T00:00:00Z',
      vigente_hasta: null, creado_por: 'u1', created_at: '2026-10-01T00:00:00Z', sucursal_nombre: 'P', creado_por_nombre: 'A', total_lecturas: 0,
    }]);
    m('deleteAnuncio').mockResolvedValue(undefined);
    render(<AnunciosPage />);
    await screen.findAllByText('Corte de agua');
    fireEvent.click((await screen.findAllByRole('button', { name: /Acciones: Corte de agua/ }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Eliminar' }));
    expect(m('deleteAnuncio')).not.toHaveBeenCalled();
    await confirmarEn('¿Eliminar el anuncio «Corte de agua»?', /No se puede deshacer/, 'Eliminar');
    await waitFor(() => expect(m('deleteAnuncio')).toHaveBeenCalledWith('a1'));
  });

  it('Anuncios: cancelar no borra nada', async () => {
    m('getAnuncios').mockResolvedValue([{
      id: 'a1', sucursal_id: 's1', titulo: 'Corte de agua', contenido: 'x', prioridad: 'normal', vigente_desde: '2026-10-01T00:00:00Z',
      vigente_hasta: null, creado_por: 'u1', created_at: '2026-10-01T00:00:00Z', sucursal_nombre: 'P', creado_por_nombre: 'A', total_lecturas: 0,
    }]);
    render(<AnunciosPage />);
    await screen.findAllByText('Corte de agua');
    fireEvent.click((await screen.findAllByRole('button', { name: /Acciones: Corte de agua/ }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Eliminar' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Eliminar el anuncio «Corte de agua»?' });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(m('deleteAnuncio')).not.toHaveBeenCalled();
  });

  it('Visitas avisadas: eliminar nombra a la persona', async () => {
    const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
    m('getPreautorizaciones').mockResolvedValue([{
      id: 'p1', residente_id: 'r1', nombre_visitante: 'Taxi Don Beto', numero_dpi: null, placa: 'P123ABC', fecha_inicio: hoy, fecha_fin: hoy,
      activo: true, created_at: '2026-01-01', numero_casa: 'A-12', residente_nombre: 'Ana',
    }]);
    m('getResidentes').mockResolvedValue([]);
    m('deletePreautorizacion').mockResolvedValue(undefined);
    render(<PreautPage />);
    await screen.findByText('Taxi Don Beto');
    fireEvent.click(screen.getByRole('button', { name: /Acciones: Taxi Don Beto/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Eliminar' }));
    await confirmarEn('¿Eliminar la visita avisada de Taxi Don Beto?', /La garita ya no la esperará/, 'Eliminar');
    await waitFor(() => expect(m('deletePreautorizacion')).toHaveBeenCalledWith('p1'));
  });

  it('Sucursales y personal: eliminar sucursal y dar de baja explican su efecto', async () => {
    m('getSucursales').mockResolvedValue([{
      id: 'suc-1', empresa_id: 'emp-1', empresa_nombre: 'X', nombre: 'Torre Norte', direccion: null, tipo: null, activo: true,
      total_residentes: 0, total_agentes: 0, created_at: '2026-01-01', tiene_admin: true,
    }]);
    m('getUsuarios').mockResolvedValue([{ id: 'u1', nombre: 'Luis Agente', email: 'l@x.com', rol: 'agente', activo: true, sucursal_nombre: 'Torre Norte' }]);
    m('getInvitaciones').mockResolvedValue([]);
    m('deleteSucursal').mockResolvedValue(undefined);
    m('deleteUsuario').mockResolvedValue(undefined);
    render(<GestionSucursales />);
    await screen.findByText('Luis Agente');

    fireEvent.click(screen.getByRole('button', { name: /Acciones: Torre Norte/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Eliminar' }));
    await confirmarEn('¿Eliminar la sucursal «Torre Norte»?', /se conserva su historial/, 'Eliminar');
    await waitFor(() => expect(m('deleteSucursal')).toHaveBeenCalledWith('suc-1'));

    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));   // el personal: única acción, a la vista
    await confirmarEn('¿Dar de baja a Luis Agente?', /se le cierran las sesiones/, 'Dar de baja');
    await waitFor(() => expect(m('deleteUsuario')).toHaveBeenCalledWith('u1'));
  });

  it('Empresas: dar de baja avisa de todo lo que apaga', async () => {
    m('getEmpresas').mockResolvedValue([{
      id: 'emp-1', nombre: 'Condominio X', nit: null, logo_url: null, activo: true, suspendida: false, suspension_motivo: null,
      suspendida_en: null, created_at: '2026-01-01', total_sucursales: 1, tiene_admin: true,
    }]);
    m('getUsuarios').mockResolvedValue([]);
    m('getInvitaciones').mockResolvedValue([]);
    m('deleteEmpresa').mockResolvedValue(undefined);
    render(<OwnerEmpresas />);
    await screen.findByText('Condominio X');
    fireEvent.click(screen.getByRole('button', { name: /Acciones: Condominio X/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Dar de baja \(reversible\)/ }));
    await confirmarEn('¿Dar de baja la empresa «Condominio X»?', /equipos de garita, y se cierran todas las sesiones/, 'Dar de baja');
    await waitFor(() => expect(m('deleteEmpresa')).toHaveBeenCalledWith('emp-1'));
  });

  it('Invitaciones: revocar pide confirmar y dice que el enlace deja de servir', async () => {
    m('getEmpresas').mockResolvedValue([]);
    m('getUsuarios').mockResolvedValue([]);
    m('getInvitaciones').mockResolvedValue([{
      id: 'i1', email: 'ana@sol.com', rol_invitado: 'admin_empresa', empresa_id: null, empresa_nombre: 'Sol', crea_empresa: true,
      sucursal_id: null, estado: 'pendiente', expira_en: '2099-01-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z',
      empresa_nombre_actual: null, sucursal_nombre: null,
    }]);
    m('revocarInvitacion').mockResolvedValue(undefined);
    render(<OwnerEmpresas />);
    await screen.findByText('ana@sol.com');
    fireEvent.click(screen.getByRole('button', { name: /Acciones: ana@sol.com/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Revocar' }));
    await confirmarEn('¿Revocar la invitación de ana@sol.com?', /El enlace dejará de funcionar/, 'Revocar');
    await waitFor(() => expect(m('revocarInvitacion')).toHaveBeenCalledWith('i1'));
  });

  it('Áreas comunes: «Eliminar» está en el menú, no al lado de «Editar», y avisa que antes hay que cancelar las reservas futuras', async () => {
    m('getAreas').mockResolvedValue([{
      id: 'ar1', sucursal_id: 's1', nombre: 'Salón Social', descripcion: null, imagen_url: null, tarifa_tipo: 'gratis',
      tarifa_monto: '0', requiere_aprobacion: null, activa: true, created_at: '2026-01-01',
    }]);
    m('deleteArea').mockResolvedValue(undefined);
    render(<AreasComunesPage />);
    await screen.findByText('Salón Social');
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Acciones: Salón Social/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Eliminar' }));
    await confirmarEn('¿Eliminar el área «Salón Social»?', /primero hay que cancelarlas/, 'Eliminar');
    await waitFor(() => expect(m('deleteArea')).toHaveBeenCalledWith('ar1'));
  });
});
