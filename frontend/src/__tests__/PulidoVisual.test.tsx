/**
 * SCRUM-115 / H12 — pulido visual: el logo se sube como archivo, «Tipo» es una lista y la pantalla de detalle de
 * empresa deja de pedir identificadores pegados a mano.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import EmpresaModal from '../components/EmpresaModal';
import TipoSucursalSelect from '../components/TipoSucursalSelect';
import GestionSucursales from '../pages/admin_empresa/GestionSucursales';
import OwnerEmpresas from '../pages/owner/OwnerEmpresas';
import EmpresaDetail from '../pages/owner/EmpresaDetail';
import { archivoALogo, ImagenError } from '../utils/imagen';
import { etiquetaTipoSucursal } from '../utils/sucursal';
import * as api from '../services/api';

vi.mock('../utils/imagen', async importOriginal => ({ ...(await importOriginal<typeof import('../utils/imagen')>()), archivoALogo: vi.fn() }));
vi.mock('../services/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  createEmpresa: vi.fn(), updateEmpresa: vi.fn(), getEmpresas: vi.fn(), getUsuarios: vi.fn(), getInvitaciones: vi.fn(),
  getSucursales: vi.fn(), getEmpresaStats: vi.fn(), createSucursal: vi.fn(), assignAdminSucursal: vi.fn(), deleteSucursal: vi.fn(),
  decodeTokenPayload: vi.fn(() => ({ empresa_id: 'emp-1' })),
}));

const m = (k: string) => (api as unknown as Record<string, ReturnType<typeof vi.fn>>)[k];
const mockLogo = archivoALogo as unknown as ReturnType<typeof vi.fn>;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

const EMPRESA = {
  id: 'emp-1', nombre: 'Condominio X', nit: null, logo_url: null as string | null, activo: true, suspendida: false,
  suspension_motivo: null, suspendida_en: null, created_at: '2026-01-01', total_sucursales: 1, tiene_admin: true,
};
const SUC = {
  id: 'suc-1', empresa_id: 'emp-1', empresa_nombre: 'Condominio X', nombre: 'Torre Norte', direccion: null, tipo: 'residencial' as string | null,
  activo: true, total_residentes: 0, total_agentes: 0, created_at: '2026-01-01', tiene_admin: true,
};

const elegirArchivo = (dialogo: HTMLElement, tipo = 'image/png') => {
  const input = within(dialogo).getByTestId('logo-archivo');
  fireEvent.change(input, { target: { files: [new File(['x'], 'logo.png', { type: tipo })] } });
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('token', 'x');
  m('getUsuarios').mockResolvedValue([]);
  m('getInvitaciones').mockResolvedValue([]);
});

describe('Logo como archivo', () => {
  it('al crear: se elige la imagen, se ve la vista previa y viaja como logo_url', async () => {
    mockLogo.mockResolvedValue(PNG);
    m('createEmpresa').mockResolvedValue({ ...EMPRESA, logo_url: PNG });
    render(<EmpresaModal open onClose={vi.fn()} onSaved={vi.fn()} />);
    const d = await screen.findByRole('dialog', { name: 'Nueva empresa' });
    expect(within(d).queryByLabelText(/URL/i)).not.toBeInTheDocument();           // ya no se escribe una URL
    expect(within(d).getByText('Elegir imagen')).toBeInTheDocument();
    elegirArchivo(d);
    expect(await within(d).findByAltText('Vista previa del logo')).toHaveAttribute('src', PNG);
    fireEvent.change(within(d).getByLabelText(/Nombre/), { target: { value: 'Residenciales Sol' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(m('createEmpresa')).toHaveBeenCalledWith({ nombre: 'Residenciales Sol', nit: undefined, logo_url: PNG }));
  });

  it('una imagen que no sirve muestra el motivo y no cambia el logo', async () => {
    mockLogo.mockRejectedValue(new ImagenError('El logo debe ser JPG, PNG o WebP.'));
    render(<EmpresaModal open onClose={vi.fn()} onSaved={vi.fn()} />);
    const d = await screen.findByRole('dialog', { name: 'Nueva empresa' });
    elegirArchivo(d, 'image/svg+xml');
    expect(await within(d).findByText('El logo debe ser JPG, PNG o WebP.')).toBeInTheDocument();
    expect(within(d).queryByAltText('Vista previa del logo')).not.toBeInTheDocument();
  });

  it('al editar: cambiar solo el nombre NO vuelve a mandar el logo; «Quitar logo» lo manda vacío para borrarlo', async () => {
    m('updateEmpresa').mockResolvedValue({ ...EMPRESA });
    const conLogo = { ...EMPRESA, logo_url: 'https://cdn.ejemplo.com/logo.png' };
    const { unmount } = render(<EmpresaModal open onClose={vi.fn()} empresa={conLogo} onSaved={vi.fn()} />);
    let d = await screen.findByRole('dialog', { name: 'Editar empresa' });
    expect(within(d).getByAltText('Vista previa del logo')).toHaveAttribute('src', 'https://cdn.ejemplo.com/logo.png');
    fireEvent.change(within(d).getByLabelText(/Nombre/), { target: { value: 'Otro nombre' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(m('updateEmpresa')).toHaveBeenCalledWith('emp-1', { nombre: 'Otro nombre', nit: undefined }));
    unmount();

    m('updateEmpresa').mockClear();
    render(<EmpresaModal open onClose={vi.fn()} empresa={conLogo} onSaved={vi.fn()} />);
    d = await screen.findByRole('dialog', { name: 'Editar empresa' });
    fireEvent.click(within(d).getByRole('button', { name: 'Quitar logo' }));
    fireEvent.click(within(d).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(m('updateEmpresa')).toHaveBeenCalledWith('emp-1', { nombre: 'Condominio X', nit: undefined, logo_url: '' }));
  });

  it('en la lista de empresas el logo se ve como miniatura, no como texto de URL', async () => {
    m('getEmpresas').mockResolvedValue([{ ...EMPRESA, logo_url: PNG }]);
    const { container } = render(<OwnerEmpresas />);
    await screen.findByText('Condominio X');
    expect(container.querySelector(`img[src="${PNG}"]`)).not.toBeNull();
    expect(screen.queryByText(PNG)).not.toBeInTheDocument();
  });
});

describe('«Tipo» de sucursal como lista', () => {
  it('ofrece las opciones y conserva un tipo escrito a mano antes de que existiera la lista', () => {
    const onChange = vi.fn();
    const { rerender } = render(<TipoSucursalSelect value="" onChange={onChange} />);
    const select = screen.getByLabelText('Tipo') as HTMLSelectElement;
    expect([...select.options].map(o => o.textContent)).toEqual([
      '— sin especificar —', 'Residencial', 'Condominio', 'Edificio de apartamentos', 'Centro comercial', 'Oficinas', 'Otro',
    ]);
    fireEvent.change(select, { target: { value: 'oficinas' } });
    expect(onChange).toHaveBeenCalledWith('oficinas');

    rerender(<TipoSucursalSelect value="Colonia vieja" onChange={onChange} />);
    expect([...(screen.getByLabelText('Tipo') as HTMLSelectElement).options].map(o => o.value)).toContain('Colonia vieja');
  });

  it('etiquetaTipoSucursal traduce los conocidos, deja el resto tal cual y pone raya si no hay', () => {
    const t = (k: string) => ({ 'sucursal.tipo.residencial': 'Residencial' } as Record<string, string>)[k] ?? k;
    expect(etiquetaTipoSucursal(t, 'residencial')).toBe('Residencial');
    expect(etiquetaTipoSucursal(t, 'Colonia vieja')).toBe('Colonia vieja');
    expect(etiquetaTipoSucursal(t, null)).toBe('—');
  });

  it('el formulario de sucursal usa la lista y la tabla muestra la etiqueta', async () => {
    m('getSucursales').mockResolvedValue([SUC, { ...SUC, id: 'suc-2', nombre: 'Torre Vieja', tipo: 'Colonia vieja' }]);
    m('createSucursal').mockResolvedValue({ ...SUC, id: 'suc-9', nombre: 'Torre Sur', tipo: 'oficinas' });
    render(<GestionSucursales />);
    await screen.findByText('Torre Norte');
    expect(screen.getByText('Residencial')).toBeInTheDocument();
    expect(screen.getByText('Colonia vieja')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '+ Nueva sucursal' }));
    const d = await screen.findByRole('dialog', { name: 'Nueva sucursal' });
    expect(within(d).getByLabelText('Tipo').tagName).toBe('SELECT');
    fireEvent.change(within(d).getByLabelText(/Nombre/), { target: { value: 'Torre Sur' } });
    fireEvent.change(within(d).getByLabelText('Tipo'), { target: { value: 'oficinas' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Crear sucursal' }));
    await waitFor(() => expect(m('createSucursal')).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Torre Sur', tipo: 'oficinas' })));
  });
});

describe('Detalle de empresa (owner)', () => {
  const STATS = { total_sucursales: 1, total_residentes: 0, total_accesos_hoy: 0, total_pagos_pendientes: 0, sucursales: [] };
  beforeEach(() => {
    m('getEmpresaStats').mockResolvedValue(STATS);
    m('getSucursales').mockResolvedValue([SUC]);
    m('getUsuarios').mockResolvedValue([
      { id: 'u1', nombre: 'Luis Agente', email: 'luis@x.com', rol: 'agente', activo: true },
      { id: 'u2', nombre: 'Dueño', email: 'owner@x.com', rol: 'owner', activo: true },
      { id: 'u3', nombre: 'Vecina', email: 'vecina@x.com', rol: 'residente', activo: true },
    ]);
    m('assignAdminSucursal').mockResolvedValue(undefined);
  });

  it('asignar administrador se elige de una lista (sin owner ni residentes) en vez de pegar un UUID', async () => {
    render(<EmpresaDetail empresaId="emp-1" onBack={vi.fn()} />);
    await screen.findByText('Torre Norte');
    fireEvent.click(screen.getByRole('button', { name: 'Asignar administrador' }));      // la acción principal de la fila
    const d = await screen.findByRole('dialog', { name: 'Asignar administrador' });
    expect(within(d).queryByPlaceholderText(/UUID/)).not.toBeInTheDocument();
    const select = within(d).getByLabelText('— seleccionar —') as HTMLSelectElement;
    expect([...select.options].map(o => o.textContent)).toEqual(['— seleccionar —', 'Luis Agente (luis@x.com)']);
    fireEvent.change(select, { target: { value: 'u1' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Asignar' }));
    await waitFor(() => expect(m('assignAdminSucursal')).toHaveBeenCalledWith('suc-1', 'u1'));
  });

  it('crear sucursal desde aquí también usa la lista de tipos', async () => {
    render(<EmpresaDetail empresaId="emp-1" onBack={vi.fn()} />);
    await screen.findByText('Torre Norte');
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva sucursal' }));
    const d = await screen.findByRole('dialog', { name: 'Crear sucursal' });
    expect(within(d).getByLabelText('Tipo').tagName).toBe('SELECT');
  });
});
