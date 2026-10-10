import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import LoginPage from '../pages/LoginPage';
import MiCuentaPage from '../pages/MiCuentaPage';
import {
  login, logout, verificarDosPasos, getDosPasosEstado, iniciarDosPasos, confirmarDosPasos,
  desactivarDosPasos, regenerarCodigosRecuperacion,
} from '../services/api';

vi.mock('../services/api', async () => {
  class DosPasosError extends Error {
    codigo: string; status: number; espera_s?: number;
    constructor(mensaje: string, codigo: string, status: number, espera_s?: number) {
      super(mensaje); this.name = 'DosPasosError'; this.codigo = codigo; this.status = status; this.espera_s = espera_s;
    }
  }
  class EmpresaBloqueadaError extends Error {
    bloqueo: unknown;
    constructor(b: { error: string }) { super(b.error); this.name = 'EmpresaBloqueadaError'; this.bloqueo = b; }
  }
  class PortalIncorrectoError extends Error {}
  return {
    DosPasosError, EmpresaBloqueadaError, PortalIncorrectoError,
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    tomarBloqueoGuardado: vi.fn(() => null),
    verificarDosPasos: vi.fn(),
    getDosPasosEstado: vi.fn(),
    iniciarDosPasos: vi.fn(),
    confirmarDosPasos: vi.fn(),
    desactivarDosPasos: vi.fn(),
    regenerarCodigosRecuperacion: vi.fn(),
    // Token de pruebas de «Mi cuenta».
    decodeTokenPayload: () => ({ id: 'yo', nombre: 'Ana Pérez', email: 'ana@empresa.com', rol: 'admin_sucursal' }),
  };
});

// jsdom no tiene canvas: el QR se sustituye por una imagen fija.
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QR') } }));

const api = await import('../services/api');
const mockLogin = login as unknown as ReturnType<typeof vi.fn>;
const mockLogout = logout as unknown as ReturnType<typeof vi.fn>;
const mockVerificar = verificarDosPasos as unknown as ReturnType<typeof vi.fn>;
const mockEstado = getDosPasosEstado as unknown as ReturnType<typeof vi.fn>;
const mockIniciar = iniciarDosPasos as unknown as ReturnType<typeof vi.fn>;
const mockConfirmar = confirmarDosPasos as unknown as ReturnType<typeof vi.fn>;
const mockDesactivar = desactivarDosPasos as unknown as ReturnType<typeof vi.fn>;
const mockRegenerar = regenerarCodigosRecuperacion as unknown as ReturnType<typeof vi.fn>;

const error2fa = (codigo: string, status = 400, espera_s?: number) =>
  new (api as unknown as { DosPasosError: new (m: string, c: string, s: number, e?: number) => Error }).DosPasosError('mensaje del servidor', codigo, status, espera_s);

const CODIGOS = ['AAAAA-BBBBB', 'CCCCC-DDDDD', 'EEEEE-FFFFF', 'GGGGG-HHHHH', 'JJJJJ-KKKKK', 'LLLLL-MMMMM', 'NNNNN-PPPPP', 'QQQQQ-RRRRR', 'SSSSS-TTTTT', 'UUUUU-VVVVV'];

// ── Segundo paso del inicio de sesión ──────────────────────────────────────────────────────────

describe('LoginPage — segundo paso (verificación en dos pasos)', () => {
  beforeEach(() => {
    for (const m of [mockLogin, mockVerificar]) m.mockReset();
    mockLogout.mockClear();
    localStorage.clear();
  });

  const usuario = { id: 'u1', nombre: 'Ana', email: 'ana@empresa.com', rol: 'admin_sucursal' };

  /** Escribe correo y contraseña y envía; el backend responde que falta el código. */
  const pasarPrimerPaso = async (onLogin = vi.fn()) => {
    mockLogin.mockResolvedValue({ requiere_2fa: true, desafio: 'desafio-jwt' });
    const vista = render(<LoginPage onLogin={onLogin} />);
    fireEvent.change(screen.getByPlaceholderText('usuario@ejemplo.com'), { target: { value: 'ana@empresa.com' } });
    fireEvent.change(vista.container.querySelector('input[type="password"]')!, { target: { value: 'Clave#2026a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await screen.findByRole('heading', { name: 'Verificación en dos pasos' });
    return { onLogin, ...vista };
  };

  const escribirCodigo = (valor: string) =>
    fireEvent.change(screen.getByLabelText(/Código de verificación|Código de recuperación/), { target: { value: valor } });
  const enviar = () => fireEvent.click(screen.getByRole('button', { name: 'Verificar' }));

  it('con la contraseña correcta pide el código: no abre sesión ni guarda token, y la contraseña ya no está en pantalla', async () => {
    const { onLogin, container } = await pasarPrimerPaso();
    expect(onLogin).not.toHaveBeenCalled();
    expect(localStorage.getItem('token')).toBeNull();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByText(/código de seis dígitos que muestra tu app/)).toBeInTheDocument();
  });

  it('con el código correcto completa la sesión igual que un inicio de sesión normal', async () => {
    mockVerificar.mockResolvedValue({ token: 'tok-2fa', usuario });
    const { onLogin } = await pasarPrimerPaso();
    escribirCodigo('123456');
    enviar();
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('tok-2fa', 'admin_sucursal', expect.objectContaining({ id: 'u1' })));
    expect(mockVerificar).toHaveBeenCalledWith('desafio-jwt', '123456');
    expect(localStorage.getItem('token')).toBe('tok-2fa');
  });

  it('un código errado muestra el aviso, vacía el campo y deja intentar de nuevo', async () => {
    mockVerificar.mockRejectedValue(error2fa('CODIGO_INCORRECTO', 401));
    const { onLogin } = await pasarPrimerPaso();
    escribirCodigo('000000');
    enviar();
    expect(await screen.findByText(/El código no es correcto/)).toBeInTheDocument();
    expect(screen.getByLabelText('Código de verificación')).toHaveValue('');
    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Verificación en dos pasos' })).toBeInTheDocument();
  });

  it('sin escribir nada no llama al servidor', async () => {
    await pasarPrimerPaso();
    enviar();
    expect(await screen.findByText('Escribe el código.')).toBeInTheDocument();
    expect(mockVerificar).not.toHaveBeenCalled();
  });

  it('bloqueada por demasiados intentos: dice cuántos minutos esperar', async () => {
    mockVerificar.mockRejectedValue(error2fa('BLOQUEADO', 429, 900));
    await pasarPrimerPaso();
    escribirCodigo('000000');
    enviar();
    expect(await screen.findByText(/Espera 15 minutos/)).toBeInTheDocument();
  });

  it('si el desafío venció vuelve a pedir correo y contraseña, con el motivo', async () => {
    mockVerificar.mockRejectedValue(error2fa('DESAFIO_INVALIDO', 401));
    const { container } = await pasarPrimerPaso();
    escribirCodigo('123456');
    enviar();
    expect(await screen.findByText('La verificación venció. Escribe tu correo y contraseña de nuevo.')).toBeInTheDocument();
    expect(container.querySelector('input[type="password"]')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('usuario@ejemplo.com')).toHaveValue('ana@empresa.com');   // el correo se conserva
  });

  it('si la empresa se suspendió mientras tanto, muestra el aviso de suspensión', async () => {
    const Bloqueada = (api as unknown as { EmpresaBloqueadaError: new (b: unknown) => Error }).EmpresaBloqueadaError;
    mockVerificar.mockRejectedValue(new Bloqueada({
      codigo: 'empresa_suspendida', empresa: 'Condominio X', motivo: 'Factura pendiente', desde: null, error: 'Suspendida',
    }));
    await pasarPrimerPaso();
    escribirCodigo('123456');
    enviar();
    expect(await screen.findByText(/Condominio X/)).toBeInTheDocument();
    expect(screen.getByText('Factura pendiente')).toBeInTheDocument();
  });

  it('se puede cambiar a un código de recuperación y volver al de la app', async () => {
    mockVerificar.mockResolvedValue({ token: 'tok-rec', usuario });
    const { onLogin } = await pasarPrimerPaso();
    fireEvent.click(screen.getByRole('button', { name: 'Usar un código de recuperación' }));
    expect(screen.getByText(/Cada uno sirve una sola vez/)).toBeInTheDocument();
    escribirCodigo('abcde-fghjk');
    enviar();
    await waitFor(() => expect(onLogin).toHaveBeenCalled());
    expect(mockVerificar).toHaveBeenCalledWith('desafio-jwt', 'abcde-fghjk');
  });

  it('«Volver» regresa a correo y contraseña sin conservar la contraseña ni el desafío', async () => {
    const { container } = await pasarPrimerPaso();
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(screen.getByPlaceholderText('usuario@ejemplo.com')).toHaveValue('ana@empresa.com');
    expect(container.querySelector('input[type="password"]')).toHaveValue('');
    expect(screen.queryByRole('heading', { name: 'Verificación en dos pasos' })).toBeNull();
  });

  it('una cuenta de agente que pase el segundo paso tampoco entra a la web: se cierra la sesión', async () => {
    mockVerificar.mockResolvedValue({ token: 'tok', usuario: { ...usuario, rol: 'agente' } });
    const { onLogin } = await pasarPrimerPaso();
    escribirCodigo('123456');
    enviar();
    expect(await screen.findByText(/requiere la aplicación de escritorio/)).toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});

// ── Mi cuenta: activar, desactivar y regenerar ─────────────────────────────────────────────────

describe('Mi cuenta — verificación en dos pasos', () => {
  beforeEach(() => {
    for (const m of [mockEstado, mockIniciar, mockConfirmar, mockDesactivar, mockRegenerar]) m.mockReset();
  });

  const desactivada = { activado: false, activado_en: null, codigos_restantes: 0 };
  const activada = (restantes = 8) => ({ activado: true, activado_en: '2026-10-05T15:00:00Z', codigos_restantes: restantes });
  const escribir = (etiqueta: RegExp | string, valor: string) => fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });

  it('muestra los datos de la persona y el estado «No activada» con el botón Activar', async () => {
    mockEstado.mockResolvedValue(desactivada);
    render(<MiCuentaPage />);
    expect(await screen.findByText('No activada')).toBeInTheDocument();
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText('ana@empresa.com')).toBeInTheDocument();
    expect(screen.getByText('Administrador de sucursal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desactivar' })).toBeNull();
  });

  it('activar: muestra el QR y la clave a mano; con el primer código entrega los códigos de recuperación UNA vez', async () => {
    mockEstado.mockResolvedValueOnce(desactivada).mockResolvedValue(activada(10));
    mockIniciar.mockResolvedValue({ secreto: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', otpauth_url: 'otpauth://totp/SecureGate:ana?secret=X' });
    mockConfirmar.mockResolvedValue(CODIGOS);
    render(<MiCuentaPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Activar' }));
    const qr = await screen.findByAltText('Código QR para tu app de autenticación');
    expect(qr).toHaveAttribute('src', 'data:image/png;base64,QR');
    expect(screen.getByTestId('clave-manual')).toHaveTextContent('ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567');

    escribir('Código de verificación', '123456');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Activar' }));

    const lista = await screen.findByTestId('codigos-recuperacion');
    expect(mockConfirmar).toHaveBeenCalledWith('123456');
    expect(within(lista).getAllByRole('listitem').map(li => li.textContent)).toEqual(CODIGOS);

    // No se puede cerrar sin confirmar que se guardaron.
    const listo = screen.getByRole('button', { name: 'Listo' });
    expect(listo).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Ya guardé mis códigos/ }));
    expect(listo).toBeEnabled();
    fireEvent.click(listo);
    await waitFor(() => expect(screen.queryByTestId('codigos-recuperacion')).toBeNull());

    // El estado se recargó: ahora figura como activada y los códigos no se vuelven a ver.
    expect(await screen.findByText('Activada')).toBeInTheDocument();
    expect(screen.queryByText('AAAAA-BBBBB')).toBeNull();
  });

  it('activar con un código errado deja el diálogo abierto con el aviso y no entrega códigos', async () => {
    mockEstado.mockResolvedValue(desactivada);
    mockIniciar.mockResolvedValue({ secreto: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', otpauth_url: 'otpauth://x' });
    mockConfirmar.mockRejectedValue(error2fa('CODIGO_INCORRECTO'));
    render(<MiCuentaPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activar' }));
    await screen.findByAltText('Código QR para tu app de autenticación');
    escribir('Código de verificación', '000000');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Activar' }));
    expect(await screen.findByText(/El código no es correcto/)).toBeInTheDocument();
    expect(screen.queryByTestId('codigos-recuperacion')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('si no se puede iniciar la configuración lo dice y no deja confirmar', async () => {
    mockEstado.mockResolvedValue(desactivada);
    mockIniciar.mockRejectedValue(new Error('Error al iniciar la verificación en dos pasos'));
    render(<MiCuentaPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activar' }));
    expect(await screen.findByText('Error al iniciar la verificación en dos pasos')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Activar' })).toBeDisabled();
  });

  it('activada: dice desde cuándo, cuántos códigos quedan (con concordancia) y ofrece regenerar y desactivar', async () => {
    mockEstado.mockResolvedValue(activada(8));
    const { unmount } = render(<MiCuentaPage />);
    expect(await screen.findByText('Activada')).toBeInTheDocument();
    expect(screen.getByText(/Activada el 5 oct 2026/)).toBeInTheDocument();
    expect(screen.getByText('Te quedan 8 códigos de recuperación')).toBeInTheDocument();
    expect(screen.queryByText(/Te quedan pocos/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Generar códigos nuevos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desactivar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activar' })).toBeNull();
    unmount();

    mockEstado.mockResolvedValue(activada(1));
    render(<MiCuentaPage />);
    expect(await screen.findByText('Te queda 1 código de recuperación')).toBeInTheDocument();
    expect(screen.getByText(/Te quedan pocos/)).toBeInTheDocument();
  });

  it('desactivar pide la contraseña y un código; sin la contraseña ni llama al servidor', async () => {
    mockEstado.mockResolvedValueOnce(activada()).mockResolvedValue(desactivada);
    mockDesactivar.mockResolvedValue(undefined);
    const { container } = render(<MiCuentaPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar' }));

    escribir(/Código de verificación/, '123456');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desactivar' }));
    expect(await screen.findByText('Escribe tu contraseña.')).toBeInTheDocument();
    expect(mockDesactivar).not.toHaveBeenCalled();

    fireEvent.change(container.ownerDocument.querySelector('input[type="password"]')!, { target: { value: 'Clave#2026a' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desactivar' }));
    await waitFor(() => expect(mockDesactivar).toHaveBeenCalledWith('Clave#2026a', '123456'));
    expect(await screen.findByText('No activada')).toBeInTheDocument();
  });

  it('desactivar con la contraseña errada muestra el aviso y no desactiva', async () => {
    mockEstado.mockResolvedValue(activada());
    mockDesactivar.mockRejectedValue(error2fa('PASSWORD_INCORRECTA'));
    render(<MiCuentaPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar' }));
    escribir(/Código de verificación/, '123456');
    fireEvent.change(document.querySelector('input[type="password"]')!, { target: { value: 'mala' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desactivar' }));
    expect(await screen.findByText('La contraseña no es correcta.')).toBeInTheDocument();
    expect(screen.getByText('Activada')).toBeInTheDocument();
  });

  it('regenerar pide un código de la app y muestra los códigos nuevos una vez', async () => {
    mockEstado.mockResolvedValue(activada(2));
    const NUEVOS = CODIGOS.map(c => c.replace(/[A-E]/g, 'Z'));
    mockRegenerar.mockResolvedValue(NUEVOS);
    render(<MiCuentaPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generar códigos nuevos' }));
    escribir('Código de verificación', '654321');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Generar' }));
    const lista = await screen.findByTestId('codigos-recuperacion');
    expect(mockRegenerar).toHaveBeenCalledWith('654321');
    expect(within(lista).getAllByRole('listitem').map(li => li.textContent)).toEqual(NUEVOS);
  });

  it('bloqueada por demasiados intentos al regenerar: dice cuántos minutos esperar', async () => {
    mockEstado.mockResolvedValue(activada());
    mockRegenerar.mockRejectedValue(error2fa('BLOQUEADO', 429, 600));
    render(<MiCuentaPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generar códigos nuevos' }));
    escribir('Código de verificación', '000000');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Generar' }));
    expect(await screen.findByText(/Espera 10 minutos/)).toBeInTheDocument();
  });

  it('si no se puede consultar el estado lo avisa y no ofrece acciones a ciegas', async () => {
    mockEstado.mockRejectedValue(new Error('caído'));
    render(<MiCuentaPage />);
    expect(await screen.findByText(/No se pudo consultar la seguridad de tu cuenta/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activar' })).toBeNull();
  });
});
