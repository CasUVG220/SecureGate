/**
 * SCRUM-114 / H09 — altas con siguiente paso.
 *
 * Una empresa o sucursal recién creada no sirve sin administrador: tras crearla se ofrece «Invitar administrador»;
 * las listas marcan lo que sigue sin administrador; los paneles vacíos dan la bienvenida con el primer paso;
 * y la contraseña de los formularios de owner / admin de empresa se puede ver y muestra sus requisitos.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import EmpresaModal from '../components/EmpresaModal';
import InvitarAdminModal from '../components/InvitarAdminModal';
import OwnerDashboard from '../pages/owner/OwnerDashboard';
import OwnerEmpresas from '../pages/owner/OwnerEmpresas';
import GestionSucursales from '../pages/admin_empresa/GestionSucursales';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  getEmpresas: vi.fn(), createEmpresa: vi.fn(), updateEmpresa: vi.fn(), deleteEmpresa: vi.fn(),
  assignAdminEmpresa: vi.fn(), suspenderEmpresa: vi.fn(), reactivarEmpresa: vi.fn(), eliminarEmpresaDefinitivo: vi.fn(),
  getUsuarios: vi.fn(), createUsuario: vi.fn(), deleteUsuario: vi.fn(),
  getSucursales: vi.fn(), createSucursal: vi.fn(), updateSucursal: vi.fn(), deleteSucursal: vi.fn(), assignAdminSucursal: vi.fn(),
  getDashboard: vi.fn(),
  getInvitaciones: vi.fn(), crearInvitacion: vi.fn(), revocarInvitacion: vi.fn(), reenviarInvitacion: vi.fn(),
  decodeTokenPayload: vi.fn(() => ({ empresa_id: 'emp-1' })),
}));

const m = <K extends keyof typeof api>(k: K) => api[k] as unknown as ReturnType<typeof vi.fn>;

const EMPRESA = {
  id: 'emp-1', nombre: 'Condominio X', nit: null, logo_url: null, activo: true, suspendida: false,
  suspension_motivo: null, suspendida_en: null, created_at: '2026-01-01', total_sucursales: 1,
};
const SUCURSAL = {
  id: 'suc-1', empresa_id: 'emp-1', empresa_nombre: 'Condominio X', nombre: 'Torre Norte', direccion: null, tipo: null,
  activo: true, total_residentes: 0, total_agentes: 0, created_at: '2026-01-01',
};
const DASH = {
  accesos_hoy: 0, residentes_mora: 0, pagos_pendientes: 0, accesos_recientes: [],
  accesos_por_hora: Array(24).fill(0), accesos_ayer_misma_hora: 0, dentro_ahora: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('token', 'x');
  m('getUsuarios').mockResolvedValue([]);
  m('getInvitaciones').mockResolvedValue([]);
  m('getDashboard').mockResolvedValue(DASH);
});

describe('EmpresaModal — el único formulario para crear empresas', () => {
  it('al crear pasa al siguiente paso y «Invitar administrador» entrega la empresa creada', async () => {
    m('createEmpresa').mockResolvedValue({ ...EMPRESA, id: 'emp-9', nombre: 'Residenciales Sol' });
    const onSaved = vi.fn(); const onInvitar = vi.fn(); const onClose = vi.fn();
    render(<EmpresaModal open onClose={onClose} onSaved={onSaved} onInvitar={onInvitar} />);

    const dialogo = await screen.findByRole('dialog', { name: 'Nueva empresa' });
    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), { target: { value: '  Residenciales Sol ' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear' }));

    await waitFor(() => expect(m('createEmpresa')).toHaveBeenCalledWith({ nombre: 'Residenciales Sol', nit: undefined, logo_url: undefined }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'emp-9' }), true);

    // Paso siguiente: la empresa existe pero nadie la administra.
    const siguiente = await screen.findByRole('dialog', { name: 'Empresa creada' });
    expect(within(siguiente).getByText(/Residenciales Sol ya existe/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(within(siguiente).getByRole('button', { name: 'Invitar administrador' }));
    expect(onInvitar).toHaveBeenCalledWith(expect.objectContaining({ id: 'emp-9', nombre: 'Residenciales Sol' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('«Ahora no» cierra sin invitar', async () => {
    m('createEmpresa').mockResolvedValue(EMPRESA);
    const onInvitar = vi.fn(); const onClose = vi.fn();
    render(<EmpresaModal open onClose={onClose} onSaved={vi.fn()} onInvitar={onInvitar} />);
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva empresa' });
    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), { target: { value: 'Condominio X' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ahora no' }));
    expect(onClose).toHaveBeenCalled();
    expect(onInvitar).not.toHaveBeenCalled();
  });

  it('sin nombre no llama a la API y explica qué falta; un error del servidor queda a la vista', async () => {
    render(<EmpresaModal open onClose={vi.fn()} onSaved={vi.fn()} onInvitar={vi.fn()} />);
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva empresa' });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear' }));
    expect(await within(dialogo).findByText('El nombre de la empresa es requerido.')).toBeInTheDocument();
    expect(m('createEmpresa')).not.toHaveBeenCalled();

    m('createEmpresa').mockRejectedValue(new Error('logo_url debe ser una URL http(s) válida'));
    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), { target: { value: 'Condominio X' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear' }));
    expect(await within(dialogo).findByText('logo_url debe ser una URL http(s) válida')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Empresa creada' })).not.toBeInTheDocument();
  });

  it('editar guarda con los datos de la empresa y no ofrece el paso de invitar', async () => {
    m('updateEmpresa').mockResolvedValue({ ...EMPRESA, nombre: 'Condominio Y' });
    const onSaved = vi.fn(); const onClose = vi.fn(); const onInvitar = vi.fn();
    render(<EmpresaModal open onClose={onClose} empresa={EMPRESA} onSaved={onSaved} onInvitar={onInvitar} />);
    const dialogo = await screen.findByRole('dialog', { name: 'Editar empresa' });
    const nombre = within(dialogo).getByLabelText(/Nombre/) as HTMLInputElement;
    expect(nombre.value).toBe('Condominio X');
    fireEvent.change(nombre, { target: { value: 'Condominio Y' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(m('updateEmpresa')).toHaveBeenCalledWith('emp-1', { nombre: 'Condominio Y', nit: undefined, logo_url: undefined }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Condominio Y' }), false);
    expect(onClose).toHaveBeenCalled();
    expect(onInvitar).not.toHaveBeenCalled();
  });
});

describe('InvitarAdminModal — alcance ya decidido', () => {
  it('con empresa fija muestra su nombre, no pide elegir empresa y manda empresa_id', async () => {
    m('crearInvitacion').mockResolvedValue({ id: 'i1', email: 'ana@sol.com', enlace: 'http://x/invitacion/abc', estado: 'pendiente' });
    const onEnviada = vi.fn();
    render(<InvitarAdminModal open onClose={vi.fn()} modo="owner" empresaFija={{ id: 'emp-9', nombre: 'Residenciales Sol' }} onEnviada={onEnviada} />);
    const dialogo = await screen.findByRole('dialog', { name: 'Invitar administrador de empresa' });
    expect(within(dialogo).getByText('Empresa: Residenciales Sol')).toBeInTheDocument();
    expect(within(dialogo).queryByRole('tab')).not.toBeInTheDocument();
    expect(within(dialogo).queryByLabelText('Empresa')).not.toBeInTheDocument();

    fireEvent.change(within(dialogo).getByLabelText(/Correo del invitado/), { target: { value: 'ana@sol.com' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Enviar invitación' }));
    await waitFor(() => expect(m('crearInvitacion')).toHaveBeenCalledWith({ email: 'ana@sol.com', rol_invitado: 'admin_empresa', empresa_id: 'emp-9' }));
    expect(onEnviada).toHaveBeenCalled();
    // Tras enviar queda el enlace por si el correo no llega.
    expect(await within(dialogo).findByDisplayValue('http://x/invitacion/abc')).toBeInTheDocument();
  });

  it('con sucursal fija (admin de empresa) manda sucursal_id y rol admin_sucursal', async () => {
    m('crearInvitacion').mockResolvedValue({ id: 'i2', email: 'luis@sol.com', enlace: null, estado: 'pendiente' });
    render(<InvitarAdminModal open onClose={vi.fn()} modo="admin_empresa" sucursalFija={{ id: 'suc-1', nombre: 'Torre Norte' }} />);
    const dialogo = await screen.findByRole('dialog', { name: 'Invitar administrador de sucursal' });
    expect(within(dialogo).getByText('Sucursal: Torre Norte')).toBeInTheDocument();
    fireEvent.change(within(dialogo).getByLabelText(/Correo del invitado/), { target: { value: 'luis@sol.com' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Enviar invitación' }));
    await waitFor(() => expect(m('crearInvitacion')).toHaveBeenCalledWith({ email: 'luis@sol.com', rol_invitado: 'admin_sucursal', sucursal_id: 'suc-1' }));
  });

  it('sin alcance fijo sigue pidiendo elegir sucursal', async () => {
    render(<InvitarAdminModal open onClose={vi.fn()} modo="admin_empresa" sucursales={[SUCURSAL]} />);
    const dialogo = await screen.findByRole('dialog', { name: 'Invitar administrador de sucursal' });
    fireEvent.change(within(dialogo).getByLabelText(/Correo del invitado/), { target: { value: 'luis@sol.com' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Enviar invitación' }));
    // La sucursal es obligatoria: el formulario no se envía hasta elegir una.
    expect(within(dialogo).getByLabelText(/^Sucursal/)).toBeRequired();
    expect(m('crearInvitacion')).not.toHaveBeenCalled();
  });
});

describe('OwnerDashboard — bienvenida y aviso «sin administrador»', () => {
  it('sin empresas da la bienvenida con el primer paso y el botón abre el alta', async () => {
    m('getEmpresas').mockResolvedValue([]);
    render(<OwnerDashboard onSelectEmpresa={vi.fn()} />);
    expect(await screen.findByText('Bienvenido a SecureGate')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Crear la primera empresa' }));
    expect(await screen.findByRole('dialog', { name: 'Nueva empresa' })).toBeInTheDocument();
  });

  it('marca la empresa sin administrador y ofrece invitarlo; con invitación vigente lo dice', async () => {
    m('getEmpresas').mockResolvedValue([
      { ...EMPRESA, id: 'a', nombre: 'Sin Nadie', tiene_admin: false, invitacion_pendiente: false },
      { ...EMPRESA, id: 'b', nombre: 'Esperando', tiene_admin: false, invitacion_pendiente: true },
      { ...EMPRESA, id: 'c', nombre: 'Completa', tiene_admin: true, invitacion_pendiente: false },
    ]);
    render(<OwnerDashboard onSelectEmpresa={vi.fn()} />);
    await screen.findByText('Sin Nadie');
    expect(screen.getByText('Sin administrador')).toBeInTheDocument();
    expect(screen.getByText('Invitación pendiente')).toBeInTheDocument();
    // Solo hay aviso para las dos que lo necesitan.
    expect(screen.getAllByText(/Sin administrador|Invitación pendiente/)).toHaveLength(2);

    // Las dos filas sin administrador ofrecen el botón; la completa no.
    const invitar = screen.getAllByRole('button', { name: 'Invitar administrador' });
    expect(invitar).toHaveLength(2);
    fireEvent.click(invitar[0]);
    const dialogo = await screen.findByRole('dialog', { name: 'Invitar administrador de empresa' });
    expect(within(dialogo).getByText('Empresa: Sin Nadie')).toBeInTheDocument();

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: /Acciones: Completa/ }));
    expect(screen.queryByRole('menuitem', { name: 'Invitar administrador' })).not.toBeInTheDocument();
  });

  it('crear una empresa desde el panel termina en «Invitar administrador» con esa empresa', async () => {
    m('getEmpresas').mockResolvedValue([]);
    m('createEmpresa').mockResolvedValue({ ...EMPRESA, id: 'emp-9', nombre: 'Nueva SA' });
    render(<OwnerDashboard onSelectEmpresa={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Nueva Empresa/ }));
    const alta = await screen.findByRole('dialog', { name: 'Nueva empresa' });
    fireEvent.change(within(alta).getByLabelText(/Nombre/), { target: { value: 'Nueva SA' } });
    fireEvent.click(within(alta).getByRole('button', { name: 'Crear' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Invitar administrador' }));
    expect(await screen.findByText('Empresa: Nueva SA')).toBeInTheDocument();
  });
});

describe('OwnerEmpresas — un solo alta y contraseña visible', () => {
  it('el botón «Nueva empresa» abre el mismo formulario y «Asignar administrador» muestra los requisitos de la contraseña', async () => {
    m('getEmpresas').mockResolvedValue([{ ...EMPRESA, tiene_admin: true }]);
    render(<OwnerEmpresas />);
    await screen.findByText('Condominio X');

    fireEvent.click(screen.getByRole('button', { name: /Nueva empresa/ }));
    expect(await screen.findByRole('dialog', { name: 'Nueva empresa' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Nueva empresa' })).getByRole('button', { name: 'Cancelar' }));

    fireEvent.click(screen.getByRole('button', { name: /Acciones: Condominio X/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Asignar administrador' }));
    const asignar = await screen.findByRole('dialog', { name: 'Asignar administrador de empresa' });
    fireEvent.click(within(asignar).getByRole('tab', { name: 'Crear usuario' }));

    const clave = within(asignar).getByLabelText(/Contraseña/, { selector: 'input' }) as HTMLInputElement;
    expect(clave.type).toBe('password');
    expect(within(asignar).getByText(/Al menos 8 caracteres/)).toBeInTheDocument();
    fireEvent.click(within(asignar).getByRole('button', { name: 'Mostrar contraseña' }));
    expect(clave.type).toBe('text');

    // Sin cumplir los requisitos no se crea el usuario.
    fireEvent.change(within(asignar).getByLabelText(/Nombre/), { target: { value: 'Ana' } });
    fireEvent.change(within(asignar).getByLabelText(/Email/), { target: { value: 'ana@sol.com' } });
    fireEvent.change(clave, { target: { value: 'corta' } });
    fireEvent.click(within(asignar).getByRole('button', { name: 'Crear y asignar' }));
    expect(await within(asignar).findByText(/debe cumplir los requisitos/)).toBeInTheDocument();
    expect(m('createUsuario')).not.toHaveBeenCalled();
  });
});

describe('GestionSucursales — bienvenida, siguiente paso y contraseña', () => {
  it('sin sucursales da la bienvenida con el primer paso', async () => {
    m('getSucursales').mockResolvedValue([]);
    render(<GestionSucursales />);
    expect(await screen.findByText('Empecemos por tu primera sucursal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Crear la primera sucursal' }));
    expect(await screen.findByRole('dialog', { name: 'Nueva sucursal' })).toBeInTheDocument();
  });

  it('crear una sucursal pasa a «Invitar administrador» con esa sucursal ya elegida', async () => {
    m('getSucursales').mockResolvedValue([]);
    m('createSucursal').mockResolvedValue({ ...SUCURSAL, id: 'suc-9', nombre: 'Torre Sur' });
    render(<GestionSucursales />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Nueva sucursal' }));
    const alta = await screen.findByRole('dialog', { name: 'Nueva sucursal' });
    fireEvent.change(within(alta).getByLabelText(/Nombre/), { target: { value: 'Torre Sur' } });
    fireEvent.click(within(alta).getByRole('button', { name: 'Crear sucursal' }));
    await waitFor(() => expect(m('createSucursal')).toHaveBeenCalledWith(expect.objectContaining({ empresa_id: 'emp-1', nombre: 'Torre Sur' })));

    const siguiente = await screen.findByRole('dialog', { name: 'Sucursal creada' });
    expect(within(siguiente).getByText(/Torre Sur ya está creada/)).toBeInTheDocument();
    fireEvent.click(within(siguiente).getByRole('button', { name: 'Invitar administrador' }));
    expect(await screen.findByText('Sucursal: Torre Sur')).toBeInTheDocument();
  });

  it('marca la sucursal sin administrador y ofrece invitarlo', async () => {
    m('getSucursales').mockResolvedValue([
      { ...SUCURSAL, tiene_admin: false, invitacion_pendiente: false },
      { ...SUCURSAL, id: 'suc-2', nombre: 'Torre Sur', tiene_admin: true },
    ]);
    render(<GestionSucursales />);
    await screen.findByText('Torre Norte');
    expect(screen.getAllByText('Sin administrador')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Invitar administrador' }));
    expect(await screen.findByText('Sucursal: Torre Norte')).toBeInTheDocument();
  });

  it('el formulario de usuario nuevo muestra los requisitos de la contraseña y permite verla', async () => {
    m('getSucursales').mockResolvedValue([SUCURSAL]);
    render(<GestionSucursales />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Nuevo usuario' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo usuario' });
    const clave = within(dialogo).getByLabelText(/Contraseña/, { selector: 'input' }) as HTMLInputElement;
    expect(within(dialogo).getByText(/Letras y números/)).toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Mostrar contraseña' }));
    expect(clave.type).toBe('text');
  });
});
