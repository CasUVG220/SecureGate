/**
 * «Guardar» fijo al pie de los formularios largos (SCRUM-112 / H07) y aviso de cambios sin guardar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ConfiguracionQrPage from '../pages/ConfiguracionQrPage';
import ConfiguracionReservasPage from '../pages/ConfiguracionReservasPage';
import { getConfigQr, updateConfigQr, getConfigReservas, updateConfigReservas } from '../services/api';

vi.mock('../services/api', () => ({
  getConfigQr: vi.fn(), updateConfigQr: vi.fn(), getConfigReservas: vi.fn(), updateConfigReservas: vi.fn(),
}));
const qrGet = getConfigQr as unknown as ReturnType<typeof vi.fn>;
const qrPut = updateConfigQr as unknown as ReturnType<typeof vi.fn>;
const resGet = getConfigReservas as unknown as ReturnType<typeof vi.fn>;
const resPut = updateConfigReservas as unknown as ReturnType<typeof vi.fn>;

const CFG_QR = {
  dpi_obligatorio_individual: true, requiere_placa: false, autorizacion_automatica: false,
  max_intentos_fallidos: 5, bloqueo_minutos: 15, es_default: false,
};
const CFG_RES = {
  permite_cancelacion: true, horas_limite_cancelacion_completa: 48, horas_limite_cancelacion_parcial: 24,
  porcentaje_reembolso_parcial: '50', max_reservas_activas_por_residente: null, requiere_aprobacion_admin: false,
  buffer_minutos_entre_reservas: 0, buffer_motivo: null, es_default: false,
};

beforeEach(() => { [qrGet, qrPut, resGet, resPut].forEach(m => m.mockReset()); });

describe('Configuración QR: barra de acciones fija', () => {
  it('«Guardar» vive en una barra pegada al pie (sticky) y avisa cuando hay cambios sin guardar', async () => {
    qrGet.mockResolvedValue(CFG_QR);
    qrPut.mockResolvedValue({ ...CFG_QR, max_intentos_fallidos: 8 });
    render(<ConfiguracionQrPage />);

    const guardar = await screen.findByRole('button', { name: 'Guardar' });
    const barra = guardar.parentElement!;
    expect(barra.className).toMatch(/\bsticky\b/);
    expect(barra.className).toMatch(/bottom-/);
    expect(screen.queryByText('Hay cambios sin guardar')).toBeNull();      // recién cargado: limpio

    fireEvent.change(screen.getByDisplayValue('5'), { target: { value: '8' } });
    expect(await screen.findByText('Hay cambios sin guardar')).toBeInTheDocument();

    fireEvent.click(guardar);
    await waitFor(() => expect(qrPut).toHaveBeenCalledWith(expect.objectContaining({ max_intentos_fallidos: 8 })));
    await waitFor(() => expect(screen.queryByText('Hay cambios sin guardar')).toBeNull());   // ya guardado
  });

  it('volver al valor original quita el aviso (no marca cambios fantasma)', async () => {
    qrGet.mockResolvedValue(CFG_QR);
    render(<ConfiguracionQrPage />);
    await screen.findByRole('button', { name: 'Guardar' });
    const campo = screen.getByDisplayValue('5');
    fireEvent.change(campo, { target: { value: '9' } });
    expect(await screen.findByText('Hay cambios sin guardar')).toBeInTheDocument();
    fireEvent.change(campo, { target: { value: '5' } });
    await waitFor(() => expect(screen.queryByText('Hay cambios sin guardar')).toBeNull());
  });
});

describe('Configuración de reservas: barra de acciones fija', () => {
  it('también usa la barra fija y detecta los cambios', async () => {
    resGet.mockResolvedValue(CFG_RES);
    resPut.mockResolvedValue(CFG_RES);
    render(<ConfiguracionReservasPage />);

    const guardar = await screen.findByRole('button', { name: 'Guardar' });
    expect(guardar.parentElement!.className).toMatch(/\bsticky\b/);
    expect(screen.queryByText('Hay cambios sin guardar')).toBeNull();

    fireEvent.change(screen.getByDisplayValue('48'), { target: { value: '72' } });
    expect(await screen.findByText('Hay cambios sin guardar')).toBeInTheDocument();
  });
});
