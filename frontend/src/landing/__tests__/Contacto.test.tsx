import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Landing from '../Landing';

const form = () => document.querySelector('#contacto form') as HTMLFormElement;
const campo = (nombre: string) => form().querySelector(`[name="${nombre}"]`) as HTMLInputElement;
const llenar = (datos: Record<string, string>) => {
  for (const [k, v] of Object.entries(datos)) fireEvent.change(campo(k), { target: { value: v } });
};
const VALIDO = { nombre: 'Ana López', residencial: 'Residencial Los Pinos', hogares: '200', telefono: '+502 5555 1234', email: 'ana@example.com' };
const responder = (status: number, cuerpo: unknown = {}) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } }));

afterEach(() => vi.restoreAllMocks());

describe('Contacto · formulario', () => {
  it('tiene los seis campos con etiqueta, el mensaje opcional y la trampa fuera del alcance', () => {
    render(<Landing />);
    const s = within(document.getElementById('contacto')!);
    for (const etiqueta of ['Nombre', 'Residencial', 'Número de hogares', 'Teléfono o WhatsApp', 'Correo']) {
      expect(s.getByLabelText(etiqueta)).toBeRequired();
    }
    expect(s.getByLabelText(/Mensaje/)).not.toBeRequired();
    const trampa = campo('sitio_web');
    expect(trampa).toHaveAttribute('tabindex', '-1');
    expect(trampa.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('no envía si faltan datos: marca los campos y lleva el foco al aviso', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    render(<Landing />);
    fireEvent.submit(form());
    expect(fetch).not.toHaveBeenCalled();
    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Revisá los campos marcados.');
    // El foco se mueve en un efecto, después de pintar el aviso: se espera (con la suite cargada podía llegar tarde).
    await waitFor(() => expect(aviso).toHaveFocus());
    expect(campo('nombre')).toHaveAttribute('aria-invalid', 'true');
    expect(campo('nombre')).toHaveAccessibleDescription('Escribí tu nombre (de 2 a 100 caracteres).');
    expect(campo('mensaje')).not.toHaveAttribute('aria-invalid');
  });

  it('201: envía a /api/contacto sin recargar, limpia el formulario y enfoca el mensaje de éxito', async () => {
    const fetch = responder(201, { ok: true });
    render(<Landing />);
    llenar(VALIDO);
    fireEvent.submit(form());
    expect(within(form()).getByRole('button', { name: 'Enviando…' })).toBeDisabled();
    const exito = await screen.findByText(/Recibimos tu solicitud/);
    expect(exito).toHaveAttribute('role', 'status');
    await waitFor(() => expect(exito).toHaveFocus());
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/contacto$/);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ ...VALIDO, mensaje: '', sitio_web: '' });
    expect(campo('nombre')).toHaveValue('');
  });

  it('400 del servidor: pinta el error de cada campo que devolvió', async () => {
    responder(400, { error: 'Revisá los datos del formulario.', campos: { email: 'Escribí un correo válido.' } });
    render(<Landing />);
    llenar(VALIDO);
    fireEvent.submit(form());
    await waitFor(() => expect(campo('email')).toHaveAttribute('aria-invalid', 'true'));
    expect(campo('email')).toHaveAccessibleDescription('Escribí un correo válido.');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  });

  it('429: explica el límite y ofrece WhatsApp', async () => {
    responder(429, { error: 'x' });
    render(<Landing />);
    llenar(VALIDO);
    fireEvent.submit(form());
    expect(await screen.findByRole('alert')).toHaveTextContent(/varias solicitudes desde tu conexión/);
  });

  it('sin conexión: mensaje de error en español y el formulario conserva lo escrito', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Landing />);
    llenar(VALIDO);
    fireEvent.submit(form());
    expect(await screen.findByRole('alert')).toHaveTextContent(/No pudimos enviar tu solicitud/);
    expect(campo('nombre')).toHaveValue('Ana López');
  });

  it('el tramo elegido en precios llega al número de hogares; el de por defecto, no', () => {
    render(<Landing />);
    expect(campo('hogares')).toHaveValue('');
    act(() => { fireEvent.click(within(document.getElementById('precios')!).getByRole('radio', { name: 'Más de 1,000' })); });
    expect(campo('hogares')).toHaveValue('1000+');
    fireEvent.change(campo('hogares'), { target: { value: '50' } });
    fireEvent.click(within(document.getElementById('precios')!).getByRole('radio', { name: '200' }));
    expect(campo('hogares')).toHaveValue('50');                          // lo que la persona eligió en el formulario manda
  });

  it('WhatsApp y correo pendientes se muestran como [POR CONFIRMAR] y el botón de WhatsApp queda deshabilitado', () => {
    render(<Landing />);
    const s = within(document.getElementById('contacto')!);
    expect(s.getByText(/POR CONFIRMAR: número de WhatsApp/)).toBeInTheDocument();
    expect(s.getByText(/POR CONFIRMAR: correo de contacto/)).toBeInTheDocument();
    expect(s.getByRole('button', { name: 'Abrir WhatsApp' })).toBeDisabled();
  });
});
