/**
 * SCRUM-125 / RNF-10 — el panel de auditoría del owner muestra todas las acciones (también las nuevas), se filtra por ellas, por
 * resultado y por persona, y explica los intentos bloqueados por un límite de tasa.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AuditLogsPage from '../pages/owner/AuditLogsPage';
import * as api from '../services/api';

vi.mock('../services/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  getAuditLogs: vi.fn(), getAuditAcciones: vi.fn(),
}));
const getLogs = api.getAuditLogs as unknown as ReturnType<typeof vi.fn>;
const getAcciones = api.getAuditAcciones as unknown as ReturnType<typeof vi.fn>;

const fila = (over: Partial<api.AuditLog>): api.AuditLog => ({
  id: crypto.randomUUID(), created_at: '2026-10-10T15:30:00.000Z', usuario_nombre: 'Ana Gómez', usuario_email: 'ana@x.com',
  accion: 'TICKET_CREADO', tabla_afectada: 'tickets', ip_address: '10.0.0.8', sucursal_id: 'a1b2c3d4-0000-0000-0000-000000000000',
  status_code: 201, datos_nuevos: null, ...over,
});

const FILAS = [
  fila({ accion: 'EMPRESA_CREADA', usuario_nombre: 'Dueño', usuario_email: 'owner@x.com', tabla_afectada: 'empresas' }),
  fila({ accion: 'TICKET_CREADO', status_code: 429, datos_nuevos: { limite: 'ticket-crear-usuario' } }),
  fila({ accion: 'ACCESO_DENEGADO', status_code: 403, datos_nuevos: { guarda: 'personal', metodo: 'PUT', ruta: '/api/tickets/123/cerrar', rol: 'residente' } }),
  fila({ accion: 'LOGIN', usuario_nombre: null, usuario_email: null, status_code: 401, datos_nuevos: { email: 'nadie@x.com' } }),
  fila({ accion: 'LIMITE_TASA_GENERAL', usuario_nombre: null, usuario_email: null, status_code: 429, datos_nuevos: { limite: 'general-ip', intentos_callados: 7 } }),
];

beforeEach(() => {
  vi.clearAllMocks();
  getLogs.mockResolvedValue({ logs: FILAS, total: 120 });
  getAcciones.mockResolvedValue([
    { accion: 'EMPRESA_CREADA', total: 4, ultima: '2026-10-10' }, { accion: 'LOGIN', total: 90, ultima: '2026-10-10' },
    { accion: 'TICKET_CREADO', total: 12, ultima: '2026-10-10' }, { accion: 'LOGOUT', total: 30, ultima: '2026-10-10' },
    { accion: 'ACCESO_DENEGADO', total: 2, ultima: '2026-10-10' }, { accion: 'LIMITE_TASA_GENERAL', total: 1, ultima: '2026-10-10' },
  ]);
});

describe('AuditLogsPage', () => {
  it('muestra cada acción con su nombre en español, su resultado y su detalle', async () => {
    render(<AuditLogsPage />);
    await screen.findByText('Empresa creada');
    expect(screen.getByText('Dueño')).toBeInTheDocument();
    expect(screen.getAllByText('Solicitud creada').length).toBeGreaterThan(0);
    // 429: bloqueada por límite, con el límite que la frenó
    expect(screen.getByText('Límite: ticket-crear-usuario')).toBeInTheDocument();
    expect(screen.getAllByText('Bloqueada por límite').length).toBe(2);
    // acceso denegado: la ruta y lo que exigía
    expect(screen.getByText('Acceso denegado por rol')).toBeInTheDocument();
    expect(screen.getByText('PUT /api/tickets/123/cerrar · exige personal')).toBeInTheDocument();
    // login sin sesión: el correo intentado, no «Sistema»
    expect(screen.getByText(/Intentó con/)).toBeInTheDocument();
    expect(screen.getByText('nadie@x.com')).toBeInTheDocument();
    // el límite general trae la cuenta de lo que se calló
    expect(screen.getByText(/Límite: general-ip · \+7 intentos más en ese minuto/)).toBeInTheDocument();
    // la fecha va en la zona del condominio (15:30Z = 09:30 en Guatemala)
    expect(screen.getAllByText('10 oct 2026, 09:30').length).toBeGreaterThan(0);
  });

  it('el filtro de acción lista las acciones que EXISTEN, agrupadas y con su cantidad (también las nuevas)', async () => {
    render(<AuditLogsPage />);
    await screen.findByText('Empresa creada');
    const select = screen.getByLabelText('Acción') as HTMLSelectElement;
    const grupos = [...select.querySelectorAll('optgroup')].map(g => g.label);
    expect(grupos).toEqual(['Sesión y acceso', 'Empresas, sucursales e invitaciones', 'Comunidad']);
    const opciones = [...select.options].map(o => o.textContent);
    expect(opciones).toEqual(expect.arrayContaining([
      'Todas las acciones', 'Cierre de sesión (30)', 'Acceso denegado por rol (2)', 'Solicitud creada (12)', 'Exceso de peticiones (límite general) (1)',
    ]));
  });

  it('filtrar por acción y por resultado vuelve a pedir al servidor y regresa a la primera página', async () => {
    render(<AuditLogsPage />);
    await screen.findByText('Empresa creada');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(getLogs).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })));

    fireEvent.change(screen.getByLabelText('Acción'), { target: { value: 'TICKET_CREADO' } });
    await waitFor(() => expect(getLogs).toHaveBeenLastCalledWith(expect.objectContaining({ accion: 'TICKET_CREADO', offset: 0 })));

    fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'bloqueado' } });
    await waitFor(() => expect(getLogs).toHaveBeenLastCalledWith(expect.objectContaining({ accion: 'TICKET_CREADO', estado: 'bloqueado', offset: 0 })));
    const resultados = [...(screen.getByLabelText('Resultado') as HTMLSelectElement).options].map(o => o.textContent);
    expect(resultados).toEqual(['Todos los resultados', 'Correctas', 'Rechazadas', 'Bloqueadas por límite', 'Con error del servidor']);
  });

  it('la búsqueda por persona se manda al servidor al dejar de escribir (no en cada tecla)', async () => {
    render(<AuditLogsPage />);
    await screen.findByText('Empresa creada');
    getLogs.mockClear();
    fireEvent.change(screen.getByLabelText('Persona o correo'), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText('Persona o correo'), { target: { value: 'ana@' } });
    await waitFor(() => expect(getLogs).toHaveBeenCalledWith(expect.objectContaining({ buscar: 'ana@' })), { timeout: 2000 });
    expect(getLogs.mock.calls.some(([p]) => p.buscar === 'a')).toBe(false);
  });

  it('«Limpiar filtros» aparece solo con filtros y los quita todos', async () => {
    render(<AuditLogsPage />);
    await screen.findByText('Empresa creada');
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'rechazado' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Limpiar filtros' }));
    await waitFor(() => expect(getLogs).toHaveBeenLastCalledWith(expect.objectContaining({ estado: undefined, accion: undefined })));
    expect((screen.getByLabelText('Resultado') as HTMLSelectElement).value).toBe('');
  });

  it('con error del servidor lo dice, y sin resultados lo explica', async () => {
    getLogs.mockRejectedValueOnce(new Error('x'));
    const { unmount } = render(<AuditLogsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar los registros de auditoría.');
    unmount();

    getLogs.mockResolvedValue({ logs: [], total: 0 });
    render(<AuditLogsPage />);
    expect(await screen.findByText('No hay registros con esos filtros.')).toBeInTheDocument();
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
  });

  it('pagina: «Mostrando 1–50 de 120» y 1 / 3', async () => {
    render(<AuditLogsPage />);
    await screen.findByText('Empresa creada');
    expect(screen.getByText('Mostrando 1–50 de 120')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    const tabla = screen.getByRole('table');
    expect(within(tabla).getAllByRole('row').length).toBe(FILAS.length + 1);
  });

  // SCRUM-123: los eventos de dos pasos se leen sin abrir el JSON; nunca traen códigos ni contraseñas.
  it('explica la verificación en dos pasos: contraseña sin código, por dónde entró y por qué falló', async () => {
    getLogs.mockResolvedValue({
      total: 4,
      logs: [
        fila({ accion: 'LOGIN', status_code: 200, datos_nuevos: { email: 'ana@x.com', segundo_paso: 'pendiente' } }),
        fila({ accion: 'TWOFA_VERIFICACION', status_code: 200, datos_nuevos: { via: 'recuperacion' } }),
        fila({ accion: 'TWOFA_VERIFICACION', status_code: 429, datos_nuevos: { motivo: 'bloqueado' } }),
        fila({ accion: 'REFRESH_RECHAZADO', status_code: 401, datos_nuevos: { motivo: 'token_revocado' } }),
      ],
    });
    render(<AuditLogsPage />);
    await screen.findByText('Contraseña correcta; falta el código de dos pasos');
    expect(screen.getAllByText('Verificación en dos pasos: código al iniciar sesión')).toHaveLength(2);
    expect(screen.getByText('Entró con un código de recuperación')).toBeInTheDocument();
    expect(screen.getByText('Motivo: persona bloqueada por demasiados intentos')).toBeInTheDocument();
    expect(screen.getByText('Motivo: token revocado')).toBeInTheDocument();
  });

  it('un motivo que no conoce no se muestra (ni se inventa un texto)', async () => {
    getLogs.mockResolvedValue({ total: 1, logs: [fila({ accion: 'REFRESH_RECHAZADO', status_code: 401, datos_nuevos: { motivo: 'algo_nuevo' } })] });
    render(<AuditLogsPage />);
    await screen.findByText('Renovación de sesión rechazada');
    expect(screen.queryByText(/Motivo:/)).toBeNull();
  });
});
