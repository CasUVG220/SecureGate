import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from '../pages/LoginPage';
import { login, logout, PortalIncorrectoError, EmpresaBloqueadaError } from '../services/api';

vi.mock('../services/api', async () => {
  class PortalIncorrectoError extends Error {
    portalCorrecto: 'personal' | 'residente';
    constructor(mensaje: string, portalCorrecto: 'personal' | 'residente') {
      super(mensaje);
      this.name = 'PortalIncorrectoError';
      this.portalCorrecto = portalCorrecto;
    }
  }
  class EmpresaBloqueadaError extends Error {
    bloqueo: unknown;
    constructor(b: { error: string }) { super(b.error); this.name = 'EmpresaBloqueadaError'; this.bloqueo = b; }
  }
  const guardado: { v: string | null } = { v: null };
  return {
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    PortalIncorrectoError,
    EmpresaBloqueadaError,
    tomarBloqueoGuardado: vi.fn(() => { const b = guardado.v ? JSON.parse(guardado.v) : null; guardado.v = null; return b; }),
    tomarAvisoSesionGuardado: vi.fn(() => null),
    __guardarBloqueo: (b: unknown) => { guardado.v = JSON.stringify(b); },
  };
});

const mockLogin = login as unknown as ReturnType<typeof vi.fn>;
const mockLogout = logout as unknown as ReturnType<typeof vi.fn>;

describe('LoginPage', () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockLogout.mockClear();
    localStorage.clear();
  });

  it('empresa suspendida (423): credenciales correctas pero ve el aviso con motivo y no entra', async () => {
    mockLogin.mockRejectedValue(new EmpresaBloqueadaError({
      codigo: 'empresa_suspendida', empresa: 'Condominio X', motivo: 'Factura de agosto pendiente',
      desde: '2026-09-01T00:00:00Z', error: 'Las operaciones de Condominio X están suspendidas: Factura de agosto pendiente.',
    }));
    const onLogin = vi.fn();
    const { container } = render(<LoginPage onLogin={onLogin} />);

    fireEvent.change(screen.getByPlaceholderText('usuario@ejemplo.com'), { target: { value: 'ana@x.com' } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByText('Las operaciones de Condominio X están suspendidas.')).toBeInTheDocument();
    expect(screen.getByText('Factura de agosto pendiente')).toBeInTheDocument();
    expect(screen.getByText(/garitas ni residentes/)).toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('si la sesión murió por una suspensión (refresh → 423), el aviso aparece al volver al login', async () => {
    const api = await import('../services/api') as unknown as { __guardarBloqueo: (b: unknown) => void };
    api.__guardarBloqueo({ codigo: 'empresa_inactiva', empresa: 'Condominio Y', motivo: null, desde: null, error: 'x' });
    render(<LoginPage onLogin={vi.fn()} />);
    expect(await screen.findByText('Condominio Y ya no opera en SecureGate.')).toBeInTheDocument();
  });

  it('si el servidor cerró la sesión por seguridad (token usado dos veces), el aviso se ve al volver al login', async () => {
    const api = await import('../services/api') as unknown as { tomarAvisoSesionGuardado: ReturnType<typeof vi.fn> };
    api.tomarAvisoSesionGuardado.mockReturnValueOnce('sesion_comprometida');
    render(<LoginPage onLogin={vi.fn()} />);
    expect(await screen.findByText(/Por seguridad cerramos tu sesión/)).toBeInTheDocument();
    expect(screen.getByText(/si no fuiste tú, cambia tu contraseña/)).toBeInTheDocument();
  });

  it('rol agente: no entra al dashboard web, ve el aviso de la app de escritorio y se cierra la sesión', async () => {
    mockLogin.mockResolvedValue({
      token: 'tok-agente',
      usuario: { id: 'u-ag', nombre: 'Agente Garita 1', email: 'agente1@securegate.com', rol: 'agente' },
    });
    const onLogin = vi.fn();
    const { container } = render(<LoginPage onLogin={onLogin} />);

    fireEvent.change(screen.getByPlaceholderText('usuario@ejemplo.com'), { target: { value: 'agente1@securegate.com' } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: 'agente123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByText(/requiere la aplicación de escritorio/)).toBeInTheDocument();
    const enlace = screen.getByRole('link', { name: /Descargar la aplicación de escritorio/ });
    expect(enlace).toHaveAttribute('href', expect.stringMatching(/^https?:\/\//));

    expect(onLogin).not.toHaveBeenCalled();
    expect(localStorage.getItem('token')).toBeNull();
    // La sesión que abrió el backend (cookie de refresh) se cierra al instante.
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('renderiza el formulario con inputs de email y password', () => {
    const { container } = render(<LoginPage onLogin={vi.fn()} />);

    expect(screen.getByPlaceholderText('usuario@ejemplo.com')).toBeInTheDocument();
    expect(container.querySelector('input[type="password"]')).toBeInTheDocument();
  });

  it('login exitoso: onLogin es llamada con el token recibido', async () => {
    mockLogin.mockResolvedValue({
      token: 'tok-abc123',
      usuario: { id: 'u1', nombre: 'Test', email: 'test@test.com', rol: 'admin' },
    });
    const onLogin = vi.fn();
    const { container } = render(<LoginPage onLogin={onLogin} />);

    fireEvent.change(screen.getByPlaceholderText('usuario@ejemplo.com'), { target: { value: 'test@test.com' } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('tok-abc123', 'admin', expect.objectContaining({ id: 'u1' }));
    });
    // El portal viaja siempre: por defecto se entra por el de personal.
    expect(mockLogin).toHaveBeenCalledWith('test@test.com', 'secret123', 'personal');
  });

  it('login fallido: muestra el mensaje de error "Credenciales inválidas"', async () => {
    mockLogin.mockRejectedValue(new Error('Credenciales inválidas'));
    const onLogin = vi.fn();
    const { container } = render(<LoginPage onLogin={onLogin} />);

    fireEvent.change(screen.getByPlaceholderText('usuario@ejemplo.com'), { target: { value: 'test@test.com' } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByText('Credenciales inválidas')).toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('manda el portal desde el que se está entrando', async () => {
    mockLogin.mockResolvedValue({
      token: 'tok', usuario: { id: 'u1', nombre: 'T', email: 't@t.com', rol: 'residente' },
    });
    const { container } = render(<LoginPage portal="residente" onLogin={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('usuario@ejemplo.com'), { target: { value: 't@t.com' } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('t@t.com', 'secret123', 'residente'));
  });

  it('portal equivocado: no abre sesión y ofrece el portal correcto', async () => {
    // Credenciales válidas pero de otro público: el backend las rechaza y la
    // pantalla ofrece la puerta buena en vez de dejar al usuario adivinando.
    mockLogin.mockRejectedValue(
      new PortalIncorrectoError('Estas credenciales no pertenecen a este portal', 'residente')
    );
    const onLogin = vi.fn();
    const onCambiarPortal = vi.fn();
    const { container } = render(
      <LoginPage portal="personal" onLogin={onLogin} onCambiarPortal={onCambiarPortal} />
    );

    fireEvent.change(screen.getByPlaceholderText('usuario@ejemplo.com'), { target: { value: 'r1@test.com' } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: 'res123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('no pertenecen a este portal');
    expect(onLogin).not.toHaveBeenCalled();
    expect(localStorage.getItem('token')).toBeNull();

    // El enlace al otro portal aparece una sola vez, no duplicado con el del pie.
    const enlaces = screen.getAllByRole('button', { name: /Eres residente/ });
    expect(enlaces).toHaveLength(1);

    fireEvent.click(enlaces[0]);
    expect(onCambiarPortal).toHaveBeenCalledWith('/residente');
  });
});
