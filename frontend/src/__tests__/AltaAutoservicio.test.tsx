import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import RegistroPage from '../pages/RegistroPage';
import OnboardingPage from '../pages/OnboardingPage';
import { pasoInicial } from '../utils/saas';
import { completarOnboarding, getOnboarding, guardarBorradorOnboarding, reenviarInvitacionOnboarding, solicitarAlta } from '../services/api';

vi.mock('../services/api', () => {
  class OnboardingError extends Error {
    status: number; codigo?: string;
    constructor(m: string, status: number, codigo?: string) { super(m); this.status = status; this.codigo = codigo; }
  }
  return {
    OnboardingError, solicitarAlta: vi.fn(), getOnboarding: vi.fn(), guardarBorradorOnboarding: vi.fn(), completarOnboarding: vi.fn(), reenviarInvitacionOnboarding: vi.fn(),
  };
});
const m = <T,>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const { OnboardingError } = await import('../services/api');
const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

describe('RegistroPage (pública)', () => {
  beforeEach(() => { m(solicitarAlta).mockReset(); });

  const llenar = () => {
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: ' ana@empresa.gt ' } });
    fireEvent.change(screen.getByLabelText(/Nombre de tu empresa/), { target: { value: ' Residencial Los Pinos ' } });
  };

  it('manda correo y empresa sin espacios sobrantes, con los términos aceptados, y avisa que revise el correo', async () => {
    m(solicitarAlta).mockResolvedValue({ ok: true, mensaje: 'x' });
    render(<RegistroPage onIrALogin={() => {}} />);
    llenar();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Enviarme el enlace' }));
    await waitFor(() => expect(m(solicitarAlta)).toHaveBeenCalledWith({ email: 'ana@empresa.gt', empresa_nombre: 'Residencial Los Pinos', acepta_terminos: true, sitio_web: '' }));
    expect(await screen.findByText('Revisa tu correo')).toBeInTheDocument();
    expect(screen.getByText(/Si ana@empresa\.gt puede crear una cuenta/)).toBeInTheDocument();      // no afirma que exista o no
  });

  it('sin aceptar los términos no envía nada', async () => {
    render(<RegistroPage onIrALogin={() => {}} />);
    llenar();
    fireEvent.submit(screen.getByRole('button', { name: 'Enviarme el enlace' }).closest('form')!);
    expect(await screen.findByText('Debes aceptar los términos de uso.')).toBeInTheDocument();
    expect(m(solicitarAlta)).not.toHaveBeenCalled();
  });

  it('el campo trampa existe pero está fuera de la vista, sin foco y oculto a lectores; si un robot lo llena, viaja para que el servidor lo descarte', async () => {
    m(solicitarAlta).mockResolvedValue({ ok: true, mensaje: 'x' });
    const { container } = render(<RegistroPage onIrALogin={() => {}} />);
    const trampa = container.querySelector('input[name="sitio_web"]') as HTMLInputElement;
    expect(trampa).toBeTruthy();
    expect(trampa.tabIndex).toBe(-1);
    expect(trampa.autocomplete).toBe('off');
    expect(trampa.closest('[aria-hidden="true"]')).not.toBeNull();
    llenar();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(trampa, { target: { value: 'http://spam.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviarme el enlace' }));
    await waitFor(() => expect(m(solicitarAlta)).toHaveBeenCalledWith(expect.objectContaining({ sitio_web: 'http://spam.example' })));
  });

  it('muestra el mensaje del servidor (p. ej. el tope por correo) y deja reintentar', async () => {
    m(solicitarAlta).mockRejectedValue(new Error('Ya pediste varios enlaces con este correo; revisa tu bandeja o inténtalo mañana'));
    render(<RegistroPage onIrALogin={() => {}} />);
    llenar();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Enviarme el enlace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya pediste varios enlaces');
    expect(screen.getByRole('button', { name: 'Enviarme el enlace' })).toBeEnabled();
  });

  it('«Iniciar sesión» lleva al acceso', () => {
    const ir = vi.fn();
    render(<RegistroPage onIrALogin={ir} />);
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(ir).toHaveBeenCalled();
  });
});

const planes = [
  { codigo: 'basico', nombre: 'Básico', descripcion: null, precio_mensual_centavos: 25000, visitas_incluidas: 500, precio_visita_extra_centavos: 50, max_sucursales: 1, max_garitas: 1, dias_prueba: 14, moneda: 'GTQ', supuesto: true },
  { codigo: 'profesional', nombre: 'Profesional', descripcion: null, precio_mensual_centavos: 150000, visitas_incluidas: 8000, precio_visita_extra_centavos: 25, max_sucursales: null, max_garitas: null, dias_prueba: 14, moneda: 'GTQ', supuesto: true },
];
const estado = (over: Record<string, unknown> = {}) => ({
  estado: 'abierta', email: 'ana@empresa.gt', borrador: { empresa_nombre: 'Residencial Los Pinos' }, expira_en: '2026-10-18T00:00:00Z', invitacion: null, planes, ...over,
});

describe('OnboardingPage (asistente)', () => {
  beforeEach(() => { for (const f of [getOnboarding, guardarBorradorOnboarding, completarOnboarding, reenviarInvitacionOnboarding]) m(f).mockReset(); });

  it('pasoInicial retoma donde se quedó', () => {
    expect(pasoInicial({ empresa_nombre: 'X' })).toBe(0);
    expect(pasoInicial({ empresa_nombre: 'X', sucursal_nombre: 'S' })).toBe(2);
    expect(pasoInicial({ empresa_nombre: 'X', sucursal_nombre: 'S', plan_codigo: 'basico' })).toBe(3);
  });

  it('recorre los cuatro pasos guardando el borrador en cada «Siguiente» y crea la empresa al final', async () => {
    m(getOnboarding).mockResolvedValue(estado());
    m(guardarBorradorOnboarding)
      .mockResolvedValueOnce({ borrador: { empresa_nombre: 'Residencial Los Pinos', nit: '1234567-8' } })
      .mockResolvedValueOnce({ borrador: { empresa_nombre: 'Residencial Los Pinos', nit: '1234567-8', sucursal_nombre: 'Sede Central', direccion: 'Zona 10', tipo: 'condominio' } })
      .mockResolvedValueOnce({ borrador: { empresa_nombre: 'Residencial Los Pinos', nit: '1234567-8', sucursal_nombre: 'Sede Central', direccion: 'Zona 10', tipo: 'condominio', plan_codigo: 'basico' } });
    m(completarOnboarding).mockResolvedValue({ ok: true, email: 'ana@empresa.gt', mensaje: 'x' });
    render(<OnboardingPage token={TOKEN} onIrALogin={() => {}} />);

    // 1. Empresa (precargada con lo que se pidió en /registro)
    expect(await screen.findByLabelText(/Nombre de la empresa/)).toHaveValue('Residencial Los Pinos');
    fireEvent.change(screen.getByLabelText(/NIT/), { target: { value: ' 1234567-8 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(m(guardarBorradorOnboarding)).toHaveBeenNthCalledWith(1, TOKEN, { empresa_nombre: 'Residencial Los Pinos', nit: '1234567-8' }));

    // 2. Primera sucursal
    fireEvent.change(await screen.findByLabelText(/Nombre de tu primera sucursal/), { target: { value: 'Sede Central' } });
    fireEvent.change(screen.getByLabelText(/Dirección/), { target: { value: 'Zona 10' } });
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'condominio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(m(guardarBorradorOnboarding)).toHaveBeenNthCalledWith(2, TOKEN, { sucursal_nombre: 'Sede Central', direccion: 'Zona 10', tipo: 'condominio' }));

    // 3. Plan: con precios en quetzales, lo incluido, los límites y la marca de «por confirmar»
    expect(await screen.findByText('Q250.00')).toBeInTheDocument();
    expect(screen.getByText('Q1,500.00')).toBeInTheDocument();
    expect(screen.getByText(/Hasta ∞ sucursales y ∞ garitas/)).toBeInTheDocument();
    expect(screen.getByText(/todavía está por confirmar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));                    // sin elegir plan no avanza
    expect(await screen.findByText('Elige un plan para continuar.')).toBeInTheDocument();
    expect(m(guardarBorradorOnboarding)).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('radio', { name: /Básico/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(m(guardarBorradorOnboarding)).toHaveBeenNthCalledWith(3, TOKEN, { plan_codigo: 'basico' }));

    // 4. Revisar y crear
    expect(await screen.findByText('Revisa tus datos')).toBeInTheDocument();
    const resumen = screen.getByText('Revisa tus datos').parentElement!.querySelector('dl')!;
    expect(resumen).toHaveTextContent('Residencial Los Pinos');
    expect(resumen).toHaveTextContent('Sede Central');
    expect(resumen).toHaveTextContent('ana@empresa.gt');
    fireEvent.click(screen.getByRole('button', { name: 'Crear mi empresa' }));
    await waitFor(() => expect(m(completarOnboarding)).toHaveBeenCalledWith(TOKEN));
    expect(await screen.findByText('¡Casi listo!')).toBeInTheDocument();
    expect(screen.getByText(/Te mandamos la invitación a ana@empresa\.gt/)).toBeInTheDocument();
  });

  it('retoma el borrador guardado: si ya hay sucursal salta al plan, y «Volver» regresa sin perder lo llenado', async () => {
    m(getOnboarding).mockResolvedValue(estado({ borrador: { empresa_nombre: 'Residencial Los Pinos', sucursal_nombre: 'Sede Central' } }));
    render(<OnboardingPage token={TOKEN} onIrALogin={() => {}} />);
    expect(await screen.findByText('Elige tu plan')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(await screen.findByLabelText(/Nombre de tu primera sucursal/)).toHaveValue('Sede Central');
  });

  it('un enlace vencido (410) y uno inválido se distinguen, y los dos ofrecen pedir el alta de nuevo', async () => {
    m(getOnboarding).mockRejectedValueOnce(new OnboardingError('El enlace venció', 410));
    const { unmount } = render(<OnboardingPage token={TOKEN} onIrALogin={() => {}} />);
    expect(await screen.findByText('Este enlace venció')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pedir el alta de nuevo' })).toBeInTheDocument();
    unmount();
    m(getOnboarding).mockRejectedValueOnce(new OnboardingError('Enlace no válido', 404));
    render(<OnboardingPage token={TOKEN} onIrALogin={() => {}} />);
    expect(await screen.findByText('Este enlace no es válido')).toBeInTheDocument();
  });

  it('si el servidor rechaza un paso (p. ej. NIT inválido) muestra el motivo y se queda en el paso', async () => {
    m(getOnboarding).mockResolvedValue(estado());
    m(guardarBorradorOnboarding).mockRejectedValue(new OnboardingError('nit inválido (ejemplo: 1234567-8)', 400));
    render(<OnboardingPage token={TOKEN} onIrALogin={() => {}} />);
    fireEvent.change(await screen.findByLabelText(/NIT/), { target: { value: 'ABC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('nit inválido');
    expect(screen.getByLabelText(/Nombre de la empresa/)).toBeInTheDocument();
  });

  it('una solicitud ya completada muestra que la invitación está enviada y permite reenviarla (una vez por clic)', async () => {
    m(getOnboarding).mockResolvedValue(estado({ estado: 'invitada', planes: [], invitacion: { estado: 'pendiente', puede_reenviar: true } }));
    m(reenviarInvitacionOnboarding).mockResolvedValue({ ok: true, mensaje: 'x' });
    render(<OnboardingPage token={TOKEN} onIrALogin={() => {}} />);
    expect(await screen.findByText('¡Casi listo!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar la invitación' }));
    await waitFor(() => expect(m(reenviarInvitacionOnboarding)).toHaveBeenCalledWith(TOKEN));
    expect(await screen.findByText('Listo: te la reenviamos.')).toBeInTheDocument();
  });

  it('si ya no se puede reenviar (tope o aceptada) no ofrece el botón', async () => {
    m(getOnboarding).mockResolvedValue(estado({ estado: 'invitada', planes: [], invitacion: { estado: 'aceptada', puede_reenviar: false } }));
    render(<OnboardingPage token={TOKEN} onIrALogin={() => {}} />);
    await screen.findByText('¡Casi listo!');
    expect(screen.queryByRole('button', { name: 'Reenviar la invitación' })).not.toBeInTheDocument();
    expect(within(document.body).getByText(/en «Mi plan» activas tu primera garita/)).toBeInTheDocument();
  });
});
