import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CamarasConfigDialog } from '../CamarasConfigDialog';
import { api } from '../../../lib/tauri';

vi.mock('../../../lib/tauri', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lib/tauri')>()),
  api: { ocr: { dpiConfig: vi.fn(), dpiConfigurar: vi.fn() } },
}));

const dpiConfig = api.ocr.dpiConfig as unknown as ReturnType<typeof vi.fn>;
const dpiConfigurar = api.ocr.dpiConfigurar as unknown as ReturnType<typeof vi.fn>;

const abrir = () => render(
  <CamarasConfigDialog camaras={[]} asignacion={{}} layout={1}
    onLayout={vi.fn()} onAsignar={vi.fn()} onCerrar={vi.fn()} onRefrescar={vi.fn()} />,
);

beforeEach(() => { dpiConfig.mockReset(); dpiConfigurar.mockReset(); });

describe('CamarasConfigDialog — respaldo remoto del DPI (T5)', () => {
  it('muestra la opción encendida por defecto y explica que el DPI se lee primero en el equipo', async () => {
    dpiConfig.mockResolvedValue({ remoto_respaldo: true });
    abrir();
    const caja = await screen.findByRole('checkbox', { name: /Usar el servicio remoto si este equipo no logra leer el DPI/ });
    expect(caja).toBeChecked();
    expect(screen.getByText(/siempre se lee primero en este equipo, sin internet/)).toBeInTheDocument();
  });

  it('desmarcarla guarda el cambio en el equipo', async () => {
    dpiConfig.mockResolvedValue({ remoto_respaldo: true });
    dpiConfigurar.mockResolvedValue({ remoto_respaldo: false });
    abrir();
    fireEvent.click(await screen.findByRole('checkbox', { name: /Usar el servicio remoto/ }));
    await waitFor(() => expect(dpiConfigurar).toHaveBeenCalledWith(false));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Usar el servicio remoto/ })).not.toBeChecked());
  });

  it('si no se pudo guardar lo dice con palabras claras', async () => {
    dpiConfig.mockResolvedValue({ remoto_respaldo: true });
    dpiConfigurar.mockRejectedValue(new Error('x'));
    abrir();
    fireEvent.click(await screen.findByRole('checkbox', { name: /Usar el servicio remoto/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar este cambio');
  });

  it('sin el comando (versión anterior), la opción no aparece y el diálogo sigue funcionando', async () => {
    dpiConfig.mockRejectedValue(new Error('no existe'));
    abrir();
    expect(await screen.findByText('Cámaras de esta garita')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Usar el servicio remoto/ })).toBeNull();
  });
});
