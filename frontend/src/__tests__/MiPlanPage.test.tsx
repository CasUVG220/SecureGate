import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import MiPlanPage from '../pages/admin_empresa/MiPlanPage';
import { ToastProvider } from '../components/ui';
import { crearLicencia, exportarDatosEmpresa, getPanelEmpresa } from '../services/api';

vi.mock('../services/api', () => ({
  getPanelEmpresa: vi.fn(),
  exportarDatosEmpresa: vi.fn(),
  crearLicencia: vi.fn(),
  decodeTokenPayload: () => ({ rol: 'admin_empresa', empresa_id: 'emp-1' }),
}));
vi.mock('../utils/saas', async orig => ({ ...(await orig<typeof import('../utils/saas')>()), guardarArchivo: vi.fn() }));

const mockPanel = getPanelEmpresa as unknown as ReturnType<typeof vi.fn>;
const mockExportar = exportarDatosEmpresa as unknown as ReturnType<typeof vi.fn>;
const mockLicencia = crearLicencia as unknown as ReturnType<typeof vi.fn>;

const plan = { codigo: 'basico', nombre: 'Básico', descripcion: null, precio_mensual_centavos: 25000, visitas_incluidas: 500, precio_visita_extra_centavos: 50,
  max_sucursales: 3, max_garitas: null, dias_prueba: 14, moneda: 'GTQ', supuesto: true };
const factura = (over: Record<string, unknown> = {}) => ({
  id: 'f1', numero: 1, numero_texto: 'SG-000001', empresa_id: 'emp-1', empresa_nombre: 'Mi Empresa', periodo: '2026-08', plan_nombre: 'Básico', dias_del_mes: 31, dias_facturados: 31,
  cuota_centavos: 25000, visitas: 480, visitas_incluidas: 500, excedente_visitas: 0, excedente_centavos: 0, total_centavos: 25000, estado: 'pagada', emitida_en: '2026-09-01T07:20:00Z',
  vence_en: '2026-09-11', pagada_en: '2026-09-05T15:00:00Z', metodo_pago: 'transferencia', referencia_pago: 'BAC-1', detalle: { lineas: [] }, ...over,
});
const panel = (over: Record<string, unknown> = {}) => ({
  empresa: { id: 'emp-1', nombre: 'Mi Empresa' },
  suscripcion: { id: 's1', empresa_id: 'emp-1', estado: 'activa', inicio_en: '2026-01-01T00:00:00Z', prueba_hasta: null, plan },
  uso: { periodo: '2026-10', visitas: 120, incluidas: 500, excedente: 0, excedente_centavos: 0, plan: 'basico', dia_del_mes: 10, dias_del_mes: 31 },
  proyeccion: { visitas_proyectadas: 372, excedente_proyectado: 0, excedente_proyectado_centavos: 0 },
  limites: { sucursales: { usadas: 2, maximo: 3 }, garitas: { usadas: 1, maximo: null } },
  facturas: [factura()], pendiente_centavos: 0, facturas_vencidas: 0,
  progreso: { pasos: ['empresa', 'sucursal', 'plan', 'admin', 'garita'].map(id => ({ id, hecho: true })), completo: true, primera_sucursal_id: 'suc-1' },
  ...over,
});

describe('MiPlanPage (administrador de empresa)', () => {
  beforeEach(() => { mockPanel.mockReset(); mockExportar.mockReset(); mockLicencia.mockReset(); localStorage.setItem('token', 'x'); });

  it('muestra plan, precio, consumo contra lo incluido, límites y facturas con montos en quetzales', async () => {
    mockPanel.mockResolvedValue(panel());
    render(<ToastProvider><MiPlanPage /></ToastProvider>);
    expect(await screen.findByRole('heading', { name: 'Mi plan' })).toBeInTheDocument();
    expect(mockPanel).toHaveBeenCalledWith('emp-1');
    expect(screen.getByText('Básico')).toBeInTheDocument();
    expect(screen.getAllByText('Q250.00').length).toBeGreaterThanOrEqual(2);       // cuota del plan y total de la factura (centavos → quetzales)
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText(/de 500 incluidas/)).toBeInTheDocument();
    const barra = screen.getByRole('progressbar');
    expect(barra).toHaveAttribute('aria-valuenow', '24');
    expect(screen.getByText(/2 \/ 3/)).toBeInTheDocument();                         // sucursales
    expect(screen.getByText(/1 · sin límite/)).toBeInTheDocument();                 // garitas sin tope
    expect(screen.getByText('SG-000001')).toBeInTheDocument();
    expect(screen.getByText('Pagada')).toBeInTheDocument();
    expect(screen.getByText(/Precio de referencia/)).toBeInTheDocument();          // plan supuesto: se avisa
  });

  it('proyecta el excedente: avisa cuánto sería y que es una estimación', async () => {
    mockPanel.mockResolvedValue(panel({
      uso: { periodo: '2026-10', visitas: 300, incluidas: 500, excedente: 0, excedente_centavos: 0, plan: 'basico', dia_del_mes: 10, dias_del_mes: 31 },
      proyeccion: { visitas_proyectadas: 930, excedente_proyectado: 430, excedente_proyectado_centavos: 21500 },
    }));
    render(<ToastProvider><MiPlanPage /></ToastProvider>);
    const p = await screen.findByTestId('proyeccion');
    expect(p).toHaveTextContent('unas 930 visitas');
    expect(p).toHaveTextContent('Excedente estimado: 430 visitas, Q215.00');
    expect(p).toHaveTextContent('no una factura');
  });

  it('con excedente real lo dice con su costo y la barra queda llena', async () => {
    mockPanel.mockResolvedValue(panel({ uso: { periodo: '2026-10', visitas: 620, incluidas: 500, excedente: 120, excedente_centavos: 6000, plan: 'basico', dia_del_mes: 25, dias_del_mes: 31 } }));
    render(<ToastProvider><MiPlanPage /></ToastProvider>);
    expect(await screen.findByText(/120 visitas de más · Q60\.00/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('concuerda el singular: «1 visita de más»', async () => {
    mockPanel.mockResolvedValue(panel({ uso: { periodo: '2026-10', visitas: 501, incluidas: 500, excedente: 1, excedente_centavos: 50, plan: 'basico', dia_del_mes: 25, dias_del_mes: 31 } }));
    render(<ToastProvider><MiPlanPage /></ToastProvider>);
    expect(await screen.findByText(/1 visita de más · Q0\.50/)).toBeInTheDocument();
  });

  it('con facturas vencidas avisa la deuda y que el servicio sigue funcionando', async () => {
    mockPanel.mockResolvedValue(panel({
      facturas: [factura({ id: 'f2', numero: 2, numero_texto: 'SG-000002', estado: 'vencida', total_centavos: 31000 })], pendiente_centavos: 31000, facturas_vencidas: 1,
    }));
    render(<ToastProvider><MiPlanPage /></ToastProvider>);
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Tienes 1 factura vencida por Q310.00');
    expect(alerta).toHaveTextContent('Tu servicio sigue funcionando');
    expect(screen.getByText('Vencida')).toBeInTheDocument();
  });

  it('en prueba dice hasta cuándo', async () => {
    mockPanel.mockResolvedValue(panel({ suscripcion: { id: 's1', empresa_id: 'emp-1', estado: 'prueba', inicio_en: '2026-10-01T00:00:00Z', prueba_hasta: '2026-10-15T18:00:00Z', plan } }));
    render(<ToastProvider><MiPlanPage /></ToastProvider>);
    expect(await screen.findByText('En prueba')).toBeInTheDocument();
    expect(screen.getByText(/Tu prueba termina el/)).toBeInTheDocument();
  });

  it('sin plan asignado muestra el estado vacío (sin cobros ni límites)', async () => {
    mockPanel.mockResolvedValue(panel({ suscripcion: null, proyeccion: null }));
    render(<ToastProvider><MiPlanPage /></ToastProvider>);
    expect(await screen.findByText('Tu empresa todavía no tiene un plan')).toBeInTheDocument();
    expect(screen.queryByTestId('proyeccion')).not.toBeInTheDocument();
  });

  it('sin facturas muestra el estado vacío de la tabla', async () => {
    mockPanel.mockResolvedValue(panel({ facturas: [] }));
    render(<ToastProvider><MiPlanPage /></ToastProvider>);
    expect(await screen.findByText('Todavía no tienes facturas')).toBeInTheDocument();
  });

  it('primeros pasos: lo hecho y lo pendiente; crea el código de la primera garita y lo muestra en grande', async () => {
    mockPanel.mockResolvedValue(panel({
      progreso: { pasos: [{ id: 'empresa', hecho: true }, { id: 'sucursal', hecho: true }, { id: 'plan', hecho: true }, { id: 'admin', hecho: true }, { id: 'garita', hecho: false }], completo: false, primera_sucursal_id: 'suc-1' },
    }));
    mockLicencia.mockResolvedValue({ codigo_activacion: 'SG-AAAA-BBBB-CCCC-DDDD' });
    render(<ToastProvider><MiPlanPage /></ToastProvider>);
    const lista = await screen.findByRole('list', { name: 'Primeros pasos' });
    expect(within(lista).getAllByRole('listitem')).toHaveLength(5);
    expect(within(lista).getAllByText('Listo')).toHaveLength(4);
    expect(within(lista).getAllByText('Pendiente')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Crear código de garita' }));
    await waitFor(() => expect(mockLicencia).toHaveBeenCalledWith({ sucursal_id: 'suc-1', etiqueta: 'Garita principal' }));
    expect(await screen.findByTestId('codigo-garita')).toHaveTextContent('SG-AAAA-BBBB-CCCC-DDDD');
  });

  it('con todos los pasos hechos no muestra la lista de primeros pasos', async () => {
    mockPanel.mockResolvedValue(panel());
    render(<ToastProvider><MiPlanPage /></ToastProvider>);
    await screen.findByRole('heading', { name: 'Mi plan' });
    expect(screen.queryByRole('list', { name: 'Primeros pasos' })).not.toBeInTheDocument();
  });

  it('descarga los datos: pide el .zip y lo guarda con el nombre que mandó el servidor', async () => {
    mockPanel.mockResolvedValue(panel());
    const blob = new Blob(['zip']);
    mockExportar.mockResolvedValue({ blob, nombre: 'securegate-datos-mi-empresa-2026-10-11.zip' });
    const { guardarArchivo } = await import('../utils/saas');
    render(<ToastProvider><MiPlanPage /></ToastProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Descargar mis datos (.zip)' }));
    await waitFor(() => expect(mockExportar).toHaveBeenCalledWith('emp-1'));
    await waitFor(() => expect(guardarArchivo).toHaveBeenCalledWith(blob, 'securegate-datos-mi-empresa-2026-10-11.zip'));
    expect(screen.getByText(/Contiene datos personales/)).toBeInTheDocument();
  });

  it('si el servidor limita la exportación, muestra su mensaje y no guarda nada', async () => {
    mockPanel.mockResolvedValue(panel());
    mockExportar.mockRejectedValue(new Error('Demasiadas exportaciones; espera una hora'));
    const { guardarArchivo } = await import('../utils/saas');
    (guardarArchivo as unknown as ReturnType<typeof vi.fn>).mockClear();
    render(<ToastProvider><MiPlanPage /></ToastProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Descargar mis datos (.zip)' }));
    expect(await screen.findByText('Demasiadas exportaciones; espera una hora')).toBeInTheDocument();
    expect(guardarArchivo).not.toHaveBeenCalled();
  });

  it('si el panel no carga, ofrece reintentar', async () => {
    mockPanel.mockRejectedValueOnce(new Error('sin conexión')).mockResolvedValue(panel());
    render(<ToastProvider><MiPlanPage /></ToastProvider>);
    expect(await screen.findByText('No se pudo cargar la información de tu plan.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Mi plan' })).toBeInTheDocument();
  });
});
