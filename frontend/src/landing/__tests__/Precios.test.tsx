import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Landing from '../Landing';

const seccion = () => document.getElementById('precios')!;
const tabla = () => within(seccion()).getByRole('table');
const fila = (titulo: string) => within(tabla()).getByRole('rowheader', { name: titulo }).closest('tr')!;
const celdas = (titulo: string) => [...fila(titulo).querySelectorAll('td')].map(td => td.textContent?.replace(/\s/g, ' '));

describe('Precios', () => {
  it('es una tabla comparativa con los tres paquetes como encabezados de columna', () => {
    render(<Landing />);
    const cols = within(tabla()).getAllByRole('columnheader').map(th => th.querySelector('span')?.textContent);
    expect(cols).toEqual(['Compra', 'Alquiler', 'Licencia']);
  });

  it('muestra primer pago y mensualidad del tramo elegido, en quetzales', () => {
    render(<Landing />);
    fireEvent.click(within(seccion()).getByRole('radio', { name: '200' }));
    expect(celdas('Primer pago')).toEqual(['Q 86,475.00', 'Q 14,000.00', 'Q 3,920.00']);
    expect(celdas('Mensualidad')).toEqual(['Q 3,472.00', 'Q 5,824.00', 'Q 2,464.00']);
    expect(within(seccion()).getByText('Cálculo con 2 casetas')).toBeInTheDocument();
  });

  it('más de 1,000 hogares: cotización a medida, sin ningún monto, y el botón lo dice', () => {
    render(<Landing />);
    fireEvent.click(within(seccion()).getByRole('radio', { name: 'Más de 1,000' }));
    expect(celdas('Primer pago')).toEqual(Array(3).fill('Cotización a medida'));
    expect(celdas('Mensualidad')).toEqual(Array(3).fill('Cotización a medida'));
    expect(within(tabla()).queryByText(/Q\s?\d/)).toBeNull();
    expect(within(seccion()).getByRole('link', { name: /Pedir cotización a medida/ })).toHaveAttribute('href', '#contacto');
  });

  it('cambiar de paquete (teléfono) no pierde el tramo elegido', () => {
    render(<Landing />);
    fireEvent.click(within(seccion()).getByRole('radio', { name: '500' }));
    const alquiler = within(seccion()).getByRole('button', { name: 'Alquiler' });
    fireEvent.click(alquiler);
    expect(alquiler).toHaveAttribute('aria-pressed', 'true');
    expect(seccion().querySelector('[data-paquete]')).toHaveAttribute('data-paquete', 'alquiler');
    expect(within(seccion()).getByRole('radio', { name: '500' })).toBeChecked();
    fireEvent.click(within(seccion()).getByRole('button', { name: 'Licencia' }));
    expect(within(seccion()).getByRole('radio', { name: '500' })).toBeChecked();
    expect(celdas('Mensualidad')).toEqual(['Q 5,992.00', 'Q 9,520.00', 'Q 4,480.00']);
  });

  it('dice que el IVA está incluido, las casetas del cálculo y que el equipo es referencial', () => {
    render(<Landing />);
    expect(within(seccion()).getByText('Montos en quetzales, con IVA (12 %) incluido.')).toBeInTheDocument();
    expect(within(seccion()).getByText(/Cálculo con 1, 1, 2, 3 y 5 casetas para 50, 100, 200, 500 y 1,000 hogares/)).toBeInTheDocument();
    expect(within(seccion()).getByText(/referenciales y se confirman en la cotización/)).toBeInTheDocument();
  });

  it('ningún paquete aparece como «el más pedido» y la licencia enlaza la ficha técnica (PDF)', () => {
    render(<Landing />);
    expect(within(seccion()).queryByText(/más pedido/i)).toBeNull();
    expect(within(seccion()).getByRole('link', { name: /ficha técnica mínima \(PDF\)/ })).toHaveAttribute('href', '/landing/ficha-tecnica.pdf');
  });
});
