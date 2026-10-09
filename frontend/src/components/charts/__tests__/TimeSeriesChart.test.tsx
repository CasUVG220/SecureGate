import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import TimeSeriesChart from '../TimeSeriesChart';

beforeAll(() => {
  // jsdom no mide: el gráfico lee su ancho de un ResizeObserver.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const etiquetas = { actual: 'Actual', anterior: 'Anterior', maximo: 'Máx.', vacio: 'Sin datos' };
const props = { lang: 'es' as const, formatoValor: (n: number) => String(n), etiquetas, ariaLabel: 'Visitas por día' };

describe('TimeSeriesChart con un solo día', () => {
  it('se dibuja como una columna (una línea de un punto no se veía) y marca el periodo anterior', () => {
    const { container } = render(<TimeSeriesChart {...props} datos={[{ fecha: '2026-10-10', valor: 7 }]} anterior={[4]} />);
    expect(container.querySelector('path.fill-viz-series')).not.toBeNull();       // la columna
    expect(container.querySelector('path[class*="fill-viz-series/10"]')).toBeNull(); // sin el área degenerada
    expect(container.querySelector('line.stroke-gray-500')).not.toBeNull();       // la raya de referencia
  });

  it('con varios días sigue siendo un área con su línea', () => {
    const datos = [1, 2, 3].map((v, i) => ({ fecha: `2026-10-0${i + 1}`, valor: v }));
    const { container } = render(<TimeSeriesChart {...props} datos={datos} />);
    expect(container.querySelector('path[class*="fill-viz-series/10"]')).not.toBeNull();
    expect(container.querySelector('path.stroke-viz-series')).not.toBeNull();
  });

  it('sin movimiento dice que no hay datos', () => {
    const { getByText } = render(<TimeSeriesChart {...props} datos={[{ fecha: '2026-10-10', valor: 0 }]} />);
    expect(getByText('Sin datos')).toBeInTheDocument();
  });
});
