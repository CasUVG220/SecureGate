import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CamarasConfigDialog } from '../CamarasConfigDialog';

vi.mock('../../../lib/tauri', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lib/tauri')>()),
  api: { ocr: {} },
}));

/**
 * OCR 100 % local (Sprint 10): ya no hay respaldo remoto del DPI, así que la configuración de cámaras no ofrece mandar la
 * foto del DPI a ningún servicio (antes había un interruptor «Usar el servicio remoto…»).
 */
describe('CamarasConfigDialog — el DPI se lee solo en este equipo', () => {
  it('no hay ninguna opción para mandar el DPI fuera del equipo', async () => {
    render(
      <CamarasConfigDialog camaras={[]} asignacion={{}} layout={1}
        onLayout={vi.fn()} onAsignar={vi.fn()} onCerrar={vi.fn()} onRefrescar={vi.fn()} />,
    );
    expect(await screen.findByText('Cámaras de esta garita')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /servicio remoto/i })).toBeNull();
    expect(screen.queryByText(/servicio remoto|en la nube|requiere internet/i)).toBeNull();
  });
});
