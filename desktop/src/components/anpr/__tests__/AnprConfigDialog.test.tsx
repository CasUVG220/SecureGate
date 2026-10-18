import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnprConfigDialog } from '../AnprConfigDialog';
import { api, type CamaraRed } from '../../../lib/tauri';
import { carril } from './fixtures';

vi.mock('../../../lib/tauri', async () => {
  const real = await vi.importActual<typeof import('../../../lib/tauri')>('../../../lib/tauri');
  return {
    ...real,
    api: {
      anpr: { carriles: vi.fn(), guardarCarril: vi.fn(), eliminarCarril: vi.fn(), probarActuador: vi.fn() },
      camaras: { listar: vi.fn(), fotograma: vi.fn() },
    },
  };
});

const a = api.anpr as unknown as Record<string, ReturnType<typeof vi.fn>>;
const cams = api.camaras as unknown as Record<string, ReturnType<typeof vi.fn>>;

const CAMARAS: CamaraRed[] = [
  { id: 'cam1', tipo: 'ip', nombre: 'Portón norte', url: 'rtsp://192.168.1.50/x', device_id: null, tareas: [], con_credenciales: true, creada_en: '' },
  { id: 'usb1', tipo: 'usb', nombre: 'Webcam', url: null, device_id: 'd', tareas: ['qr'], con_credenciales: false, creada_en: '' },
];

beforeEach(() => {
  [...Object.values(a), ...Object.values(cams)].forEach(f => f.mockReset());
  cams.listar.mockResolvedValue(CAMARAS);
  a.guardarCarril.mockImplementation(async (c: unknown) => c);
});

const guardado = () => a.guardarCarril.mock.calls[a.guardarCarril.mock.calls.length - 1][0];

describe('AnprConfigDialog', () => {
  it('un carril nuevo nace apagado; al activarlo se propone Automático; solo ofrece cámaras de red', async () => {
    a.carriles.mockResolvedValueOnce([]).mockResolvedValue([]);
    const onCambio = vi.fn();
    render(<AnprConfigDialog onCerrar={vi.fn()} onCambio={onCambio} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo carril' }));

    const cam = screen.getByLabelText('Cámara');
    expect(cam).toHaveValue('cam1');
    expect(screen.queryByRole('option', { name: 'Webcam' })).not.toBeInTheDocument();
    const activar = screen.getByLabelText('Reconocer placas en este carril');
    expect(activar).not.toBeChecked();
    fireEvent.click(activar);
    expect(screen.getByLabelText('Automático (el residente entra solo)')).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(a.guardarCarril).toHaveBeenCalled());
    expect(guardado()).toMatchObject({ nombre: 'Carril 1', camara_id: 'cam1', modo: 'automatico', sentido: 'entrada', roi: [], actuador: { tipo: 'simulado' } });
    expect(onCambio).toHaveBeenCalled();
  });

  it('el área se dibuja con clics sobre una foto de la cámara; «Deshacer» y «Todo el cuadro»', async () => {
    a.carriles.mockResolvedValue([carril({ modo: 'verificacion' })]);
    cams.fotograma.mockResolvedValue({ jpeg_base64: '/9j/AA==', seq: 1, edad_ms: 10 });
    render(<AnprConfigDialog onCerrar={vi.fn()} onCambio={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tomar foto de la cámara' }));
    const editor = await screen.findByTestId('editor-roi');
    expect(cams.fotograma).toHaveBeenCalledWith('cam1');
    editor.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(editor, { clientX: 20, clientY: 10 });
    fireEvent.click(editor, { clientX: 180, clientY: 10 });
    expect(screen.getByText('2 puntos')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/al menos 3 puntos/, { selector: '[role="alert"] *, [role="alert"]' })).toBeInTheDocument();
    expect(a.guardarCarril).not.toHaveBeenCalled();

    fireEvent.click(editor, { clientX: 180, clientY: 90 });
    fireEvent.click(editor, { clientX: 20, clientY: 90 });
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer punto' }));
    expect(screen.getByText('3 puntos')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(a.guardarCarril).toHaveBeenCalled());
    expect(guardado().roi).toEqual([[0.1, 0.1], [0.9, 0.1], [0.9, 0.9]]);
    expect(guardado().modo).toBe('verificacion');

    fireEvent.click(screen.getByRole('button', { name: 'Todo el cuadro' }));
    expect(screen.getByText('Todo el cuadro', { selector: '.sg-status, span' })).toBeInTheDocument();
  });

  it('relé HTTP: valida la URL en pantalla, prueba sin guardar y guarda método, espera y cuerpo', async () => {
    a.carriles.mockResolvedValue([carril()]);
    a.probarActuador.mockResolvedValue('Relé HTTP 192.168.1.50: abrió.');
    render(<AnprConfigDialog onCerrar={vi.fn()} onCambio={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Qué abre cuando un residente entra solo'), { target: { value: 'rele_http' } });
    const probar = screen.getByRole('button', { name: 'Probar barrera' });
    expect(probar).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Dirección del relé'), { target: { value: 'http://rele.local/abrir' } });
    expect(screen.getByText(/Escribe la IP del relé/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Dirección del relé'), { target: { value: 'http://192.168.1.50/abrir' } });
    fireEvent.change(screen.getByLabelText('Método'), { target: { value: 'post' } });
    fireEvent.change(screen.getByLabelText('Cuerpo (opcional)'), { target: { value: '{"relay":1}' } });
    fireEvent.change(screen.getByLabelText('Espera (s)'), { target: { value: '1.5' } });
    fireEvent.click(probar);
    expect(await screen.findByText('Relé HTTP 192.168.1.50: abrió.')).toBeInTheDocument();
    expect(a.probarActuador).toHaveBeenCalledWith({ tipo: 'rele_http', url: 'http://192.168.1.50/abrir', metodo: 'post', timeout_ms: 1500, cuerpo: '{"relay":1}' });
    expect(a.guardarCarril).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(guardado().actuador).toEqual({ tipo: 'rele_http', url: 'http://192.168.1.50/abrir', metodo: 'post', timeout_ms: 1500, cuerpo: '{"relay":1}' }));
  });

  it('ajustes avanzados vacíos = valor recomendado; los escritos viajan en sus unidades', async () => {
    a.carriles.mockResolvedValue([carril()]);
    render(<AnprConfigDialog onCerrar={vi.fn()} onCambio={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Tiempo máximo de lectura (s)'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Cuadros por segundo con movimiento'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Confianza mínima'), { target: { value: '0.95' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(guardado().umbrales).toEqual({ tiempo_max_lectura_ms: 6000, fps_activo: 3, confianza_min: 0.95 }));
  });

  it('Rust rechaza la configuración: se muestra el motivo; eliminar pide confirmación', async () => {
    a.carriles.mockResolvedValue([carril()]);
    a.guardarCarril.mockRejectedValue({ codigo: 'anpr_config', mensaje: 'Esa dirección no se acepta para el relé: no es de la red local.' });
    a.eliminarCarril.mockResolvedValue(true);
    const onCambio = vi.fn();
    render(<AnprConfigDialog onCerrar={vi.fn()} onCambio={onCambio} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/no es de la red local/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar carril' }));
    expect(screen.getByText('¿Eliminar «Entrada principal»?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }));
    await waitFor(() => expect(a.eliminarCarril).toHaveBeenCalledWith('c1'));
    expect(onCambio).toHaveBeenCalled();
  });

  it('activar sin cámara no se puede guardar', async () => {
    a.carriles.mockResolvedValue([carril({ camara_id: null, modo: 'apagado' })]);
    render(<AnprConfigDialog onCerrar={vi.fn()} onCambio={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText('Reconocer placas en este carril'));
    expect(screen.getByText('Elige la cámara del carril antes de activarlo.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tomar foto de la cámara' })).toBeDisabled();
  });
});
