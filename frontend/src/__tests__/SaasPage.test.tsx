import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SaasPage from '../pages/owner/SaasPage';
import { ToastProvider } from '../components/ui';
import {
  anularFacturaSaas, cambiarSuscripcion, generarFacturasSaas, getFacturasSaas, getPlanesSaas, getUsoOwner, pagarFacturaSaas, revisarVencidasSaas,
} from '../services/api';

vi.mock('../services/api', () => ({
  getUsoOwner: vi.fn(), getFacturasSaas: vi.fn(), getPlanesSaas: vi.fn(), cambiarSuscripcion: vi.fn(), pagarFacturaSaas: vi.fn(), anularFacturaSaas: vi.fn(),
  generarFacturasSaas: vi.fn(), revisarVencidasSaas: vi.fn(),
}));
const m = <T,>(f: T) => f as unknown as ReturnType<typeof vi.fn>;

const empresa = (over: Record<string, unknown> = {}) => ({
  empresa_id: 'e1', nombre: 'Residencial Los Pinos', activo: true, suspendida: false, estado: 'activa', plan: 'basico', plan_nombre: 'Básico', visitas: 620, incluidas: 500,
  excedente: 120, excedente_centavos: 6000, facturas_pendientes: 1, facturas_vencidas: 1, pendiente_centavos: 31000, ...over,
});
const factura = (over: Record<string, unknown> = {}) => ({
  id: 'f1', numero: 7, numero_texto: 'SG-000007', empresa_id: 'e1', empresa_nombre: 'Residencial Los Pinos', periodo: '2026-09', plan_nombre: 'Básico', dias_del_mes: 30, dias_facturados: 30,
  cuota_centavos: 25000, visitas: 620, visitas_incluidas: 500, excedente_visitas: 120, excedente_centavos: 6000, total_centavos: 31000, estado: 'vencida',
  emitida_en: '2026-10-01T07:20:00Z', vence_en: '2026-10-11', pagada_en: null, metodo_pago: null, referencia_pago: null, detalle: { lineas: [] }, ...over,
});
const planes = [
  { codigo: 'basico', nombre: 'Básico', descripcion: null, precio_mensual_centavos: 25000, visitas_incluidas: 500, precio_visita_extra_centavos: 50, max_sucursales: 1, max_garitas: 1, dias_prueba: 14, moneda: 'GTQ', supuesto: true },
  { codigo: 'estandar', nombre: 'Estándar', descripcion: null, precio_mensual_centavos: 60000, visitas_incluidas: 2000, precio_visita_extra_centavos: 35, max_sucursales: 3, max_garitas: 3, dias_prueba: 14, moneda: 'GTQ', supuesto: true },
];
const renderPage = () => render(<ToastProvider><SaasPage /></ToastProvider>);

describe('SaasPage (owner)', () => {
  beforeEach(() => {
    for (const f of [getUsoOwner, getFacturasSaas, getPlanesSaas, cambiarSuscripcion, pagarFacturaSaas, anularFacturaSaas, generarFacturasSaas, revisarVencidasSaas]) m(f).mockReset();
    m(getUsoOwner).mockResolvedValue({ periodo: '2026-10', empresas: [empresa(), empresa({ empresa_id: 'e2', nombre: 'Torre Sur', suspendida: true, estado: null, plan: null, plan_nombre: null, visitas: 5, incluidas: null, excedente: 0, excedente_centavos: 0, facturas_pendientes: 0, facturas_vencidas: 0, pendiente_centavos: 0 })] });
    m(getFacturasSaas).mockImplementation(async (f: { estado?: string }) => (f.estado === 'vencida' ? [factura()] : []));
    m(getPlanesSaas).mockResolvedValue(planes);
  });

  it('lista las empresas con plan, estado, consumo contra lo incluido y lo que deben; marca la suspendida', async () => {
    renderPage();
    const fila = (await screen.findAllByText('Residencial Los Pinos'))[0].closest('tr')!;
    expect(within(fila).getByText('Básico')).toBeInTheDocument();
    expect(within(fila).getByText('Activa')).toBeInTheDocument();
    expect(within(fila).getByText('620')).toBeInTheDocument();
    expect(within(fila).getByText('Q60.00')).toBeInTheDocument();                  // excedente
    expect(within(fila).getByText('Q310.00')).toBeInTheDocument();                 // por cobrar
    const otra = screen.getByText('Torre Sur').closest('tr')!;
    expect(within(otra).getByText('Sin plan')).toBeInTheDocument();
    expect(within(otra).getByText('Suspendida')).toBeInTheDocument();
  });

  it('lista las facturas por cobrar (vencidas primero) con el total adeudado', async () => {
    renderPage();
    expect(await screen.findByText('SG-000007')).toBeInTheDocument();
    expect(screen.getByText('Total por cobrar: Q310.00')).toBeInTheDocument();
    expect(m(getFacturasSaas)).toHaveBeenCalledWith({ estado: 'pendiente' });
    expect(m(getFacturasSaas)).toHaveBeenCalledWith({ estado: 'vencida' });
  });

  it('cambia el plan de una empresa con su motivo', async () => {
    m(cambiarSuscripcion).mockResolvedValue({});
    renderPage();
    await screen.findByText('SG-000007');
    fireEvent.click(within(screen.getAllByText('Residencial Los Pinos')[0].closest('tr')!).getByRole('button', { name: 'Cambiar plan' }));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.change(within(dialogo).getByLabelText('Plan'), { target: { value: 'estandar' } });
    fireEvent.change(within(dialogo).getByLabelText('Estado'), { target: { value: 'activa' } });
    fireEvent.change(within(dialogo).getByLabelText('Motivo'), { target: { value: 'Subió de plan' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(m(cambiarSuscripcion)).toHaveBeenCalledWith('e1', { plan_codigo: 'estandar', estado: 'activa', motivo: 'Subió de plan' }));
    expect(await screen.findByText('Plan actualizado')).toBeInTheDocument();
  });

  async function abrirPago() {
    renderPage();
    await screen.findByText('SG-000007');
    fireEvent.click(within(screen.getByText('SG-000007').closest('tr')!).getByRole('button', { name: 'Marcar pagada' }));
    return screen.findByRole('dialog');
  }

  it('marca una factura pagada con su método y referencia', async () => {
    m(pagarFacturaSaas).mockResolvedValue({});
    const d = await abrirPago();
    expect(within(d).getByText(/Residencial Los Pinos · Q310\.00/)).toBeInTheDocument();
    fireEvent.change(within(d).getByLabelText(/Referencia o número de boleta/), { target: { value: 'BAC-998877' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Marcar pagada' }));
    await waitFor(() => expect(m(pagarFacturaSaas)).toHaveBeenCalledWith('f1', { metodo: 'transferencia', referencia: 'BAC-998877', nota: undefined }));
    expect(await screen.findByText('Pago registrado')).toBeInTheDocument();
  });

  it('una transferencia sin referencia no se envía', async () => {
    const d = await abrirPago();
    expect(within(d).getByLabelText(/Referencia o número de boleta/)).toBeRequired();   // el navegador ya la pide…
    fireEvent.submit(d.querySelector('form')!);                                          // …y si se salta, la pantalla también
    expect(await within(d).findByText('Indica el número de referencia o de boleta.')).toBeInTheDocument();
    expect(m(pagarFacturaSaas)).not.toHaveBeenCalled();
  });

  it('en efectivo no pide referencia', async () => {
    m(pagarFacturaSaas).mockResolvedValue({});
    const d = await abrirPago();
    fireEvent.change(within(d).getByLabelText('Forma de pago'), { target: { value: 'efectivo' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Marcar pagada' }));
    await waitFor(() => expect(m(pagarFacturaSaas)).toHaveBeenCalledWith('f1', { metodo: 'efectivo', referencia: undefined, nota: undefined }));
  });

  it('si el servidor rechaza el pago (p. ej. Visanet sin integrar) muestra su mensaje y deja el diálogo abierto', async () => {
    m(pagarFacturaSaas).mockRejectedValue(new Error('La integración con Visanet está pendiente'));
    const d = await abrirPago();
    fireEvent.change(within(d).getByLabelText('Forma de pago'), { target: { value: 'otro' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Marcar pagada' }));
    expect(await within(d).findByText('La integración con Visanet está pendiente')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('anular exige un motivo de al menos 3 caracteres', async () => {
    m(anularFacturaSaas).mockResolvedValue({});
    renderPage();
    await screen.findByText('SG-000007');
    fireEvent.click(screen.getByRole('button', { name: /Acciones: SG-000007/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Anular' }));
    const d = await screen.findByRole('dialog');
    fireEvent.change(within(d).getByLabelText(/Motivo/), { target: { value: 'ab' } });
    fireEvent.submit(d.querySelector('form')!);
    expect(await within(d).findByText('Escribe el motivo (al menos 3 caracteres).')).toBeInTheDocument();
    expect(m(anularFacturaSaas)).not.toHaveBeenCalled();
    fireEvent.change(within(d).getByLabelText(/Motivo/), { target: { value: 'Error de generación' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Anular' }));
    await waitFor(() => expect(m(anularFacturaSaas)).toHaveBeenCalledWith('f1', 'Error de generación'));
  });

  it('generar facturas pide confirmación con el diálogo de la app (no window.confirm) y dice cuántas salieron', async () => {
    const confirmNativo = vi.spyOn(window, 'confirm');
    m(generarFacturasSaas).mockResolvedValue({ periodo: '2026-09', generadas: 3, existentes: 1, sin_cobro: 0, errores: 0, total_centavos: 90000 });
    renderPage();
    await screen.findByText('SG-000007');
    fireEvent.click(screen.getByRole('button', { name: 'Generar facturas del mes anterior' }));
    expect(m(generarFacturasSaas)).not.toHaveBeenCalled();                          // primero hay que confirmar
    const confirmacion = await screen.findByRole('dialog');
    expect(within(confirmacion).getByText('¿Generar las facturas del mes anterior?')).toBeInTheDocument();
    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Generar facturas del mes anterior' }));
    await waitFor(() => expect(m(generarFacturasSaas)).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Facturas generadas de 2026-09: 3 (ya existían: 1)')).toBeInTheDocument();
    expect(confirmNativo).not.toHaveBeenCalled();
  });

  it('cancelar la confirmación no genera nada', async () => {
    renderPage();
    await screen.findByText('SG-000007');
    fireEvent.click(screen.getByRole('button', { name: 'Generar facturas del mes anterior' }));
    const confirmacion = await screen.findByRole('dialog');
    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(m(generarFacturasSaas)).not.toHaveBeenCalled();
  });

  it('revisar vencimientos informa cuántas facturas pasaron a vencidas', async () => {
    m(revisarVencidasSaas).mockResolvedValue({ vencidas: 2 });
    renderPage();
    await screen.findByText('SG-000007');
    fireEvent.click(screen.getByRole('button', { name: 'Revisar vencimientos' }));
    expect(await screen.findByText('Facturas marcadas como vencidas: 2')).toBeInTheDocument();
  });

  it('si no carga, muestra el aviso de error', async () => {
    m(getUsoOwner).mockRejectedValue(new Error('sin conexión'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la información de cobros.');
  });
});
