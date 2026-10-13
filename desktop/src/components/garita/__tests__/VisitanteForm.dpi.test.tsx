import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VisitanteForm, type VisitanteFormHandle } from '../VisitanteForm';
import { api, type ResultadoDpi } from '../../../lib/tauri';

vi.mock('../../../lib/tauri', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lib/tauri')>()),
  api: {
    garita: {
      buscarResidentes: vi.fn().mockResolvedValue([{ id: 'r1', numero_casa: 'A-12', nombre: 'Ana López', estado_pago: 'al_dia', telefono: null }]),
      evaluarVisitante: vi.fn().mockResolvedValue({ bloqueado: false, preautorizado: false }),
      registrarAcceso: vi.fn().mockResolvedValue({ acceso: { nombre_visitante: 'X', residente_casa: 'A-12' }, apertura: { abierta: false } }),
    },
  },
}));

const registrar = api.garita.registrarAcceso as unknown as ReturnType<typeof vi.fn>;

const lectura = (over: Partial<ResultadoDpi> = {}): ResultadoDpi => ({
  origen: 'local', cui: '1234567890101', nombres: 'ANA MARIA', apellidos: 'LOPEZ GARCIA', nombre_completo: 'ANA MARIA LOPEZ GARCIA',
  confianza: { cui: 0.97, nombres: 0.95, apellidos: 0.96 }, cui_valido: true, revision_obligatoria: false,
  motivos: [], correcciones: 0, ms_total: 500, aviso: null, ...over,
});

const montar = (r: ResultadoDpi) => {
  const ref = createRef<VisitanteFormHandle>();
  render(<VisitanteForm ref={ref} habilitado onRegistrado={vi.fn()} />);
  act(() => ref.current!.setDesdeOcrDpi(r));
};

const elegirCasa = async () => {
  fireEvent.change(screen.getByPlaceholderText('Buscar por casa o nombre…'), { target: { value: 'A-12' } });
  fireEvent.click(await screen.findByRole('button', { name: /A-12/ }));
};

beforeEach(() => registrar.mockClear());

describe('VisitanteForm — DPI leído por OCR (T5)', () => {
  it('lectura local limpia: rellena los campos, avisa el origen y se puede registrar sin casilla de confirmación', async () => {
    montar(lectura());
    expect(screen.getByLabelText('Número de DPI')).toHaveValue('1234567890101');
    expect(screen.getByLabelText(/Nombre del visitante/)).toHaveValue('ANA MARIA LOPEZ GARCIA');
    expect(screen.getByTestId('lectura-dpi')).toHaveTextContent('leído en este equipo');
    expect(screen.queryByLabelText(/Revisé el DPI/)).toBeNull();
    // Ya no figura como manual
    expect(screen.getByRole('checkbox', { name: /DPI capturado manualmente/ })).not.toBeChecked();

    await elegirCasa();
    fireEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
    await waitFor(() => expect(registrar).toHaveBeenCalledWith(expect.objectContaining({
      numero_dpi: '1234567890101', capturado_manualmente: false, origen_dpi: 'local',
    })));
  });

  it('lectura con correcciones: muestra por qué y NO deja registrar hasta confirmar contra el documento', async () => {
    montar(lectura({ revision_obligatoria: true, motivos: ['cui_corregido'], correcciones: 1 }));
    expect(screen.getByText(/caracteres dudosos en el número/)).toBeInTheDocument();
    await elegirCasa();

    fireEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
    expect(await screen.findByText('Confirma que revisaste el DPI y el nombre contra el documento.')).toBeInTheDocument();
    expect(registrar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/Revisé el DPI y el nombre contra el documento/));
    fireEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
    await waitFor(() => expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ origen_dpi: 'local' })));
  });

  it('lectura remota (respaldo): queda marcada como remota y siempre pide confirmación', async () => {
    montar(lectura({ origen: 'remoto', revision_obligatoria: true, motivos: ['lectura_remota_sin_confianza'], nombres: '', apellidos: '', nombre_completo: 'ANA LOPEZ' }));
    expect(screen.getByTestId('lectura-dpi')).toHaveTextContent('servicio remoto');
    await elegirCasa();
    fireEvent.click(screen.getByLabelText(/Revisé el DPI y el nombre contra el documento/));
    fireEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
    await waitFor(() => expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ origen_dpi: 'remoto', capturado_manualmente: false })));
  });

  it('si el agente corrige el número a mano, el origen pasa a manual (la lectura ya no vale)', async () => {
    montar(lectura());
    fireEvent.change(screen.getByLabelText('Número de DPI'), { target: { value: '1234567890102' } });
    expect(screen.queryByTestId('lectura-dpi')).toBeNull();
    expect(screen.getByRole('checkbox', { name: /DPI capturado manualmente/ })).toBeChecked();
    await elegirCasa();
    fireEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
    await waitFor(() => expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ origen_dpi: 'manual', capturado_manualmente: true })));
  });
});

describe('VisitanteForm — captura manual intacta (T5)', () => {
  it('sin OCR: se teclea el DPI, queda manual y se registra sin ninguna confirmación extra', async () => {
    render(<VisitanteForm habilitado onRegistrado={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Número de DPI'), { target: { value: '2999111220101' } });
    fireEvent.change(screen.getByLabelText(/Nombre del visitante/), { target: { value: 'Marta Pérez' } });
    await elegirCasa();
    fireEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
    await waitFor(() => expect(registrar).toHaveBeenCalledWith(expect.objectContaining({
      numero_dpi: '2999111220101', nombre_visitante: 'Marta Pérez', capturado_manualmente: true, origen_dpi: 'manual',
    })));
  });
});
