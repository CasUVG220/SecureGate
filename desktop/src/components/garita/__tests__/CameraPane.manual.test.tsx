/**
 * Garita sin cámara (SCRUM-111 / H04): cada tarea ofrece una alternativa manual y el
 * motivo de un botón apagado se lee en pantalla.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraPanel } from '../CameraPanel';
import { motivoDeshabilitado } from '../CameraPane';

const UUID = '3f1b2c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';

const base = {
  ocrDisponible: true, enLinea: true,
  disposicion: { layout: 1 as const, paneles: ['placa' as const] },
  onLayout: vi.fn(), onPanel: vi.fn(),
  onCaptura: vi.fn(), onQr: vi.fn(), qrPausado: false, ocupado: null,
  onEscribirPlaca: vi.fn(), onSalidaManual: vi.fn(),
};
const con = (p: 'qr' | 'placa' | 'dpi' | 'salida', extra: Record<string, unknown> = {}) =>
  ({ ...base, disposicion: { layout: 1 as const, paneles: [p] }, ...extra });

beforeEach(() => {
  [base.onCaptura, base.onQr, base.onEscribirPlaca, base.onSalidaManual].forEach(f => f.mockReset());
  // Sin cámara: este WebView no expone mediaDevices.
  // @ts-expect-error se limpia el mock
  delete navigator.mediaDevices;
});
afterEach(() => {
  // @ts-expect-error se limpia el mock
  delete navigator.mediaDevices;
});

describe('motivoDeshabilitado', () => {
  const ok = { activa: true, iniciando: false, ocupado: false, ocrDisponible: true, enLinea: true };
  it('explica cada causa en un texto legible', () => {
    expect(motivoDeshabilitado({ requiere: 'ocr' }, ok)).toBeNull();
    expect(motivoDeshabilitado({ requiere: 'ocr' }, { ...ok, activa: false })).toMatch(/No hay cámara/);
    expect(motivoDeshabilitado({ requiere: 'ocr' }, { ...ok, activa: false, iniciando: true })).toMatch(/Abriendo la cámara/);
    expect(motivoDeshabilitado({ requiere: 'ocr' }, { ...ok, ocrDisponible: false })).toMatch(/OCR local no está disponible/);
    expect(motivoDeshabilitado({ requiere: 'red' }, { ...ok, enLinea: false })).toMatch(/Sin conexión/);
    // El OCR no depende de la red, ni la red del OCR:
    expect(motivoDeshabilitado({ requiere: 'ocr' }, { ...ok, enLinea: false })).toBeNull();
    expect(motivoDeshabilitado({ requiere: 'red' }, { ...ok, ocrDisponible: false })).toBeNull();
    // Mientras procesa no se culpa a nadie:
    expect(motivoDeshabilitado({ requiere: 'red' }, { ...ok, ocupado: true, enLinea: false })).toBeNull();
  });
});

describe('sin cámara: Escribir placa y motivos visibles', () => {
  it('placa: el botón de lectura queda apagado CON el motivo en pantalla y «Escribir placa» enfoca el formulario', async () => {
    render(<CameraPanel {...con('placa')} />);
    expect(await screen.findByRole('button', { name: 'Leer placa' })).toBeDisabled();
    expect(screen.getByText('No hay cámara disponible en este panel.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Escribir placa' }));
    expect(base.onEscribirPlaca).toHaveBeenCalledTimes(1);
  });

  it('salida: «Escribir placa» abre el diálogo de salida aunque no haya cámara', async () => {
    render(<CameraPanel {...con('salida')} />);
    expect(await screen.findByRole('button', { name: 'Dar salida' })).toBeDisabled();
    expect(screen.getByText('No hay cámara disponible en este panel.')).toBeInTheDocument();
    const manual = screen.getByRole('button', { name: 'Escribir placa' });
    expect(manual).toBeEnabled();
    fireEvent.click(manual);
    expect(base.onSalidaManual).toHaveBeenCalledTimes(1);
  });

  it('salida sin red: «Escribir placa» se apaga y se explica por qué (la salida vive en el servidor)', async () => {
    render(<CameraPanel {...con('salida', { enLinea: false })} />);
    await screen.findByRole('button', { name: 'Dar salida' });
    expect(screen.getByRole('button', { name: 'Escribir placa' })).toBeDisabled();
    expect(screen.getAllByText(/Sin conexión|No hay cámara/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Usa «Abrir talanquera»|necesita el servidor/)).toBeInTheDocument();
  });

  it('dpi: el botón de lectura muestra su motivo', async () => {
    render(<CameraPanel {...con('dpi')} />);
    expect(await screen.findByRole('button', { name: 'Leer DPI' })).toBeDisabled();
    expect(screen.getByText('No hay cámara disponible en este panel.')).toBeInTheDocument();
  });
});

describe('sin cámara: código QR a mano', () => {
  const abrirQr = async (extra: Record<string, unknown> = {}) => {
    render(<CameraPanel {...con('qr', extra)} />);
    return screen.findByRole('form', { name: 'Código de la invitación' });
  };

  it('un código válido (con o sin prefijo, guiones o mayúsculas) se verifica con su UUID canónico', async () => {
    await abrirQr();
    const campo = screen.getByLabelText(/Escribe el código de la invitación/);
    const boton = screen.getByRole('button', { name: 'Verificar código' });
    expect(boton).toBeDisabled(); // vacío

    fireEvent.change(campo, { target: { value: `SGQR:${UUID.toUpperCase().replace(/-/g, ' ')}` } });
    expect(boton).toBeEnabled();
    fireEvent.click(boton);
    await waitFor(() => expect(base.onQr).toHaveBeenCalledWith(UUID));
    expect((campo as HTMLInputElement).value).toBe(''); // listo para el siguiente
  });

  it('un código con mal formato no se envía al servidor y explica qué pasó', async () => {
    await abrirQr();
    fireEvent.change(screen.getByLabelText(/Escribe el código de la invitación/), { target: { value: 'esto-no-es-un-codigo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar código' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El código no tiene el formato correcto');
    expect(base.onQr).not.toHaveBeenCalled();
  });

  it('sin red SIGUE funcionando y lo dice: el código se verifica con la copia de este equipo (SCRUM-126)', async () => {
    await abrirQr({ enLinea: false });
    fireEvent.change(screen.getByLabelText(/Escribe el código de la invitación/), { target: { value: UUID } });
    const boton = screen.getByRole('button', { name: 'Verificar código' });
    expect(boton).toBeEnabled();
    expect(screen.getByText('Sin conexión: el código se verifica con la copia de este equipo.')).toBeInTheDocument();
    fireEvent.click(boton);
    await waitFor(() => expect(base.onQr).toHaveBeenCalledWith(UUID));
  });

  it('mientras el escáner verifica otro código (pausado) no se acepta uno nuevo', async () => {
    await abrirQr({ qrPausado: true });
    fireEvent.change(screen.getByLabelText(/Escribe el código de la invitación/), { target: { value: UUID } });
    expect(screen.getByRole('button', { name: 'Verificar código' })).toBeDisabled();
  });
});
