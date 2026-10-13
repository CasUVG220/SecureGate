/**
 * T8: alta y edición de cámaras IP / celular. Rust se simula; «sin probar con hardware real».
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CamaraRedDialog } from '../CamaraRedDialog';
import { api, type CamaraRed } from '../../../lib/tauri';

vi.mock('../../../lib/tauri', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lib/tauri')>()),
  api: { camaras: { probar: vi.fn(), guardar: vi.fn(), descubrir: vi.fn() } },
}));
const probar = api.camaras.probar as unknown as ReturnType<typeof vi.fn>;
const guardar = api.camaras.guardar as unknown as ReturnType<typeof vi.fn>;
const descubrir = api.camaras.descubrir as unknown as ReturnType<typeof vi.fn>;

const existente: CamaraRed = {
  id: 'c1', tipo: 'ip', nombre: 'Carril', url: 'rtsp://192.168.1.50:554/live', device_id: null, tareas: ['placa'], con_credenciales: true, creada_en: '2026-10-11T10:00:00Z',
};

const abrir = (camara: CamaraRed | null = null) => {
  const onGuardada = vi.fn();
  const onCerrar = vi.fn();
  render(<CamaraRedDialog camara={camara} onGuardada={onGuardada} onCerrar={onCerrar} />);
  return { onGuardada, onCerrar };
};

const escribir = (etiqueta: RegExp | string, valor: string) => fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });

beforeEach(() => { probar.mockReset(); guardar.mockReset(); descubrir.mockReset(); });

describe('CamaraRedDialog', () => {
  it('«Guardar» exige haber probado la conexión con los datos actuales; cambiar algo invalida la prueba', async () => {
    probar.mockResolvedValue({ ok: true, mensaje: 'Conexión correcta: se recibe imagen de 640×360.', ms: 1400, ancho: 640, alto: 360 });
    abrir();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    escribir(/^Nombre/, 'Carril de entrada');
    escribir(/Dirección de la cámara/, 'rtsp://192.168.1.50:554/live');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Probar conexión' }));
    expect(await screen.findByTestId('resultado-prueba')).toHaveTextContent('Conexión correcta: se recibe imagen de 640×360.');
    expect(screen.getByText(/Tardó 1\.4 s/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Guardar sin probar' })).toBeNull();

    escribir(/Dirección de la cámara/, 'rtsp://192.168.1.51:554/live');         // otro dato: la prueba ya no vale
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    expect(screen.queryByTestId('resultado-prueba')).toBeNull();
    expect(screen.getByRole('button', { name: 'Guardar sin probar' })).toBeEnabled();
  });

  it('una prueba fallida muestra el motivo y no habilita «Guardar», pero se puede guardar sin probar (cámara apagada)', async () => {
    probar.mockResolvedValue({ ok: false, mensaje: 'El usuario o la contraseña de la cámara no son correctos.', ms: 800, ancho: null, alto: null });
    guardar.mockResolvedValue({ ...existente });
    const { onGuardada, onCerrar } = abrir();
    escribir(/^Nombre/, 'Carril');
    escribir(/Dirección de la cámara/, 'rtsp://192.168.1.50/live');
    fireEvent.click(screen.getByRole('button', { name: 'Probar conexión' }));
    expect(await screen.findByTestId('resultado-prueba')).toHaveTextContent('contraseña');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar sin probar' }));
    await waitFor(() => expect(guardar).toHaveBeenCalled());
    await waitFor(() => expect(onGuardada).toHaveBeenCalled());
    expect(onCerrar).toHaveBeenCalled();
  });

  it('usuario y contraseña viajan SOLO en la entrada hacia Rust y no se vuelven a mostrar; una dirección con credenciales la rechaza Rust', async () => {
    probar.mockResolvedValue({ ok: true, mensaje: 'Conexión correcta.', ms: 500, ancho: null, alto: null });
    guardar.mockResolvedValue({ ...existente });
    abrir();
    escribir(/^Nombre/, 'Carril');
    escribir(/Dirección de la cámara/, 'rtsp://192.168.1.50/live');
    escribir(/Usuario/, 'admin');
    escribir(/^Contraseña$/, 'SuperSecreta-9');
    fireEvent.click(screen.getByRole('button', { name: 'Probar conexión' }));
    await screen.findByTestId('resultado-prueba');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(guardar).toHaveBeenCalledTimes(1));
    expect(guardar.mock.calls[0][0]).toMatchObject({ tipo: 'ip', nombre: 'Carril', url: 'rtsp://192.168.1.50/live', usuario: 'admin', clave: 'SuperSecreta-9', quitar_credenciales: false });
    // La prueba también las llevó, y nada del texto de la pantalla las repite:
    expect(probar.mock.calls[0][0]).toMatchObject({ usuario: 'admin', clave: 'SuperSecreta-9' });
    expect(document.body.textContent).not.toContain('SuperSecreta-9');
  });

  it('al editar, el usuario y la contraseña NO aparecen; vacíos significan «conservar» y la casilla las quita', async () => {
    guardar.mockResolvedValue({ ...existente });
    abrir(existente);
    expect(screen.getByLabelText(/Usuario/)).toHaveValue('');
    expect(screen.getByLabelText(/^Contraseña$/)).toHaveValue('');
    expect(screen.getByText('Déjalo vacío para conservar el usuario y la contraseña actuales.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar sin probar' }));
    await waitFor(() => expect(guardar).toHaveBeenCalled());
    expect(guardar.mock.calls[0][0]).toMatchObject({ id: 'c1', usuario: null, clave: null, quitar_credenciales: false });

    guardar.mockClear();
    fireEvent.click(screen.getByLabelText(/ya no pide usuario ni contraseña/));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar sin probar' }));
    await waitFor(() => expect(guardar).toHaveBeenCalled());
    expect(guardar.mock.calls[0][0]).toMatchObject({ quitar_credenciales: true, usuario: null });
  });

  it('un rechazo de Rust (por ejemplo una dirección de internet) se muestra con sus palabras', async () => {
    guardar.mockRejectedValue({ codigo: 'camaras', mensaje: 'Esa dirección no se acepta (apunta a internet). Solo se permiten cámaras de tu red local: 10.x.x.x, 172.16 a 172.31.x.x o 192.168.x.x.' });
    abrir();
    escribir(/^Nombre/, 'Mala');
    escribir(/Dirección de la cámara/, 'rtsp://8.8.8.8/live');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar sin probar' }));
    expect(await screen.findByText(/Solo se permiten cámaras de tu red local/)).toBeInTheDocument();
  });

  it('buscar cámaras en la red: lista lo encontrado y «Usar» rellena la dirección y el nombre', async () => {
    descubrir.mockResolvedValue([{ ip: '192.168.1.64', nombre: 'Hikvision Carril', modelo: 'DS-2CD2043', url_sugerida: 'rtsp://192.168.1.64:554/' }]);
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Buscar cámaras en la red' }));
    const lista = await screen.findByRole('list', { name: 'Cámaras encontradas' });
    expect(within(lista).getByText(/Hikvision Carril/)).toBeInTheDocument();
    fireEvent.click(within(lista).getByRole('button', { name: 'Usar' }));
    expect(screen.getByLabelText(/Dirección de la cámara/)).toHaveValue('rtsp://192.168.1.64:554/');
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Hikvision Carril');
  });

  it('si no encuentra ninguna lo dice y sugiere escribir la dirección', async () => {
    descubrir.mockResolvedValue([]);
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Buscar cámaras en la red' }));
    expect(await screen.findByText(/No se encontró ninguna/)).toBeInTheDocument();
  });

  it('con «Celular como cámara» aparece la guía sin jerga y desaparece la búsqueda ONVIF', () => {
    abrir();
    expect(screen.getByRole('button', { name: 'Buscar cámaras en la red' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tipo de cámara'), { target: { value: 'celular' } });
    expect(screen.getByText('Cómo usar un celular como cámara')).toBeInTheDocument();
    expect(screen.getByText(/misma red Wi-Fi/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buscar cámaras en la red' })).toBeNull();
    expect(screen.getByLabelText(/Dirección de la cámara/)).toHaveAttribute('placeholder', 'http://192.168.1.60:8080/video');
  });
});
