import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnprEventos } from '../AnprEventos';
import { AnprAlertas } from '../AnprAlertas';
import { api } from '../../../lib/tauri';
import { evento } from './fixtures';

vi.mock('../../../lib/tauri', async () => {
  const real = await vi.importActual<typeof import('../../../lib/tauri')>('../../../lib/tauri');
  return { ...real, api: { anpr: { evidencia: vi.fn() } } };
});

const evidencia = api.anpr.evidencia as unknown as ReturnType<typeof vi.fn>;
const nombre = (id: string) => (id === 'c1' ? 'Entrada principal' : id);

beforeEach(() => {
  evidencia.mockReset();
  evidencia.mockResolvedValue('/9j/4AAQSkZJRg==');
});

function montar(eventos = [evento()], extra: Partial<Parameters<typeof AnprEventos>[0]> = {}) {
  const onResolver = vi.fn().mockResolvedValue(undefined);
  const onRegistroManual = vi.fn();
  render(<AnprEventos eventos={eventos} pendientes={0} nombreCarril={nombre} onResolver={onResolver} onRegistroManual={onRegistroManual} {...extra} />);
  return { onResolver, onRegistroManual };
}

describe('AnprEventos', () => {
  it('la lista es una región viva (se anuncia cada evento nuevo) y vacía lo explica', () => {
    montar([]);
    expect(screen.getByLabelText('Eventos del reconocimiento de placas')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Sin eventos todavía')).toBeInTheDocument();
  });

  it('un acceso automático muestra placa, residente, carril, confianza, resultado de la talanquera y no pide nada', () => {
    montar([evento({ apertura: 'simulada' })]);
    expect(screen.getByText('P-123ABC')).toBeInTheDocument();
    expect(screen.getByText(/Casa 12 · Ana Prueba/)).toBeInTheDocument();
    expect(screen.getByText(/Entrada principal · Pista 1 · Entrada · confianza 95 %/)).toBeInTheDocument();
    expect(screen.getByText('Entró automático')).toBeInTheDocument();
    expect(screen.getByText('Talanquera abierta (simulada)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Corregir/ })).not.toBeInTheDocument();
    // La miniatura de la placa va en la fila; la foto del vehículo se pide solo al abrir la evidencia.
    expect(evidencia).toHaveBeenCalledWith('ev-1', 'placa');
    expect(evidencia).not.toHaveBeenCalledWith('ev-1', 'vehiculo');
    fireEvent.click(screen.getByRole('button', { name: 'Ver evidencia' }));
    expect(evidencia).toHaveBeenCalledWith('ev-1', 'vehiculo');
  });

  it('varios vehículos: cada evento con su miniatura, su placa, su pista, su confianza y su estado', async () => {
    montar([
      evento({ id: 'ev-3', track_id: 'c1-mvr6-6', placa: 'M208RST', placa_probable: 'M208RST', confianza: 0.97 }),
      evento({ id: 'ev-2', track_id: 'c1-mvr3-1', placa: 'P432HJK', placa_probable: 'P432HJK', confianza: 0.93 }),
      evento({ id: 'ev-1', track_id: 'c1-mvr3-3', placa: null, placa_probable: null, resultado: 'ilegible', estado: 'verificacion_pendiente', motivo: 'ilegible', confianza: 0, evidencia_placa: false, vehiculo_id: null }),
    ]);
    const filas = screen.getAllByRole('listitem');
    expect(filas).toHaveLength(3);
    expect(within(filas[0]).getByText('M-208RST')).toBeInTheDocument();
    expect(within(filas[0]).getByText(/Pista 6 · Entrada · confianza 97 %/)).toBeInTheDocument();
    expect(await within(filas[0]).findByAltText('Foto de la placa')).toHaveAttribute('src', 'data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    expect(within(filas[1]).getByText(/Pista 1 · Entrada · confianza 93 %/)).toBeInTheDocument();
    expect(await within(filas[1]).findByAltText('Foto de la placa')).toBeInTheDocument();
    // El ilegible espera al agente: sin foto de la placa lo dice, y muestra la del vehículo.
    expect(within(filas[2]).getByText(/Pista 3/)).toBeInTheDocument();
    expect(within(filas[2]).getByText('Sin foto')).toBeInTheDocument();
    expect(evidencia).toHaveBeenCalledWith('ev-1', 'vehiculo');
  });

  it('verificación pendiente: muestra el motivo y la foto, y «Autorizar» resuelve con la placa leída', async () => {
    const { onResolver } = montar([evento({ estado: 'verificacion_pendiente', motivo: 'confirmar_residente' })]);
    expect(screen.getByText('Vehículo autorizado: confirma para que entre.')).toBeInTheDocument();
    expect(await screen.findByAltText('Foto de la placa')).toHaveAttribute('src', 'data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    fireEvent.click(screen.getByRole('button', { name: 'Autorizar P-123ABC' }));
    await waitFor(() => expect(onResolver).toHaveBeenCalledWith('ev-1', 'autorizar', 'P123ABC'));
  });

  it('«Corregir»: valida el formato, manda la placa normalizada y muestra por qué Rust la rechaza', async () => {
    const { onResolver } = montar([evento({ estado: 'verificacion_pendiente', motivo: 'lectura_corregida', placa: 'P128ABC', vehiculo_id: null })]);
    expect(screen.queryByRole('button', { name: /^Autorizar/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Corregir la placa/ }));
    const campo = screen.getByLabelText('Placa correcta');
    fireEvent.change(campo, { target: { value: 'p12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Autorizar con esta placa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/formato de una placa de Guatemala/);
    expect(onResolver).not.toHaveBeenCalled();

    onResolver.mockRejectedValueOnce({ codigo: 'anpr_no_autorizado', mensaje: 'Esa placa no es de un vehículo autorizado y vigente. Registra la entrada a mano.' });
    fireEvent.change(campo, { target: { value: 'p 123-abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Autorizar con esta placa' }));
    await waitFor(() => expect(onResolver).toHaveBeenCalledWith('ev-1', 'autorizar', 'P123ABC'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Registra la entrada a mano/);
  });

  it('ilegible: «Registro manual» cierra el evento y pasa la placa probable al formulario; «Descartar» cierra sin registro', async () => {
    const { onResolver, onRegistroManual } = montar([
      evento({ id: 'a', estado: 'ilegible', motivo: 'ilegible', placa: null, placa_probable: 'P555TRK', vehiculo_id: null }),
      evento({ id: 'b', estado: 'ilegible', motivo: 'ilegible', placa: null, placa_probable: null, vehiculo_id: null }),
    ]);
    expect(screen.getByText('¿P-555TRK?')).toBeInTheDocument();
    const [filaA, filaB] = screen.getAllByRole('listitem');
    fireEvent.click(within(filaA).getByRole('button', { name: 'Registro manual' }));
    await waitFor(() => expect(onRegistroManual).toHaveBeenCalledWith('P555TRK'));
    expect(onResolver).toHaveBeenCalledWith('a', 'registro_manual', 'P555TRK');
    fireEvent.click(within(filaB).getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(onResolver).toHaveBeenCalledWith('b', 'descartar', undefined));
  });

  it('la lista negra no ofrece autorizar ni corregir (eso va en la alerta, con «Enterado»)', () => {
    montar([evento({ estado: 'alerta_lista_negra', motivo: 'Robo reportado' })]);
    expect(screen.getByText('Lista negra')).toBeInTheDocument();
    expect(screen.getByText('En lista negra: Robo reportado. No se abre.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Autorizar|Corregir/ })).not.toBeInTheDocument();
  });

  it('una talanquera que falló se ve en el evento', () => {
    montar([evento({ apertura: 'fallo: el relé no respondió' })]);
    expect(screen.getByText('La talanquera no respondió: el relé no respondió')).toBeInTheDocument();
  });
});

describe('AnprAlertas', () => {
  it('lista negra: alerta asertiva con la placa, el carril y que NO se abrió; «Enterado» la resuelve', async () => {
    const onEnterado = vi.fn().mockResolvedValue(undefined);
    render(<AnprAlertas alertas={[evento({ id: 'ln', estado: 'alerta_lista_negra', motivo: 'Robo reportado' })]} fallas={[]} nombreCarril={nombre} onEnterado={onEnterado} onVerFalla={vi.fn()} />);
    const alerta = screen.getByRole('alert');
    expect(alerta.parentElement).toHaveAttribute('aria-live', 'assertive');
    expect(alerta).toHaveTextContent('Lista negra · P-123ABC');
    expect(alerta).toHaveTextContent('Entrada principal: la talanquera NO se abrió. Robo reportado.');
    fireEvent.click(screen.getByRole('button', { name: /Enterado/ }));
    await waitFor(() => expect(onEnterado).toHaveBeenCalledWith('ln'));
  });

  it('si «Enterado» falla se dice y la alerta sigue', async () => {
    const onEnterado = vi.fn().mockRejectedValue({ codigo: 'sesion', mensaje: 'Inicia sesión.' });
    render(<AnprAlertas alertas={[evento({ id: 'ln', estado: 'alerta_lista_negra' })]} fallas={[]} nombreCarril={nombre} onEnterado={onEnterado} onVerFalla={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Enterado/ }));
    expect(await screen.findByText('Inicia sesión.')).toBeInTheDocument();
    expect(screen.getByText(/Lista negra · P-123ABC/)).toBeInTheDocument();
  });

  it('falla de la talanquera: banda persistente que dice que el acceso quedó registrado; «Entendido» la quita', () => {
    const onVerFalla = vi.fn();
    render(<AnprAlertas alertas={[]} fallas={[{ evento_id: 'e1', carril: 'c1', error: 'el relé no respondió' }]} nombreCarril={nombre} onEnterado={vi.fn()} onVerFalla={onVerFalla} />);
    expect(screen.getByRole('alert')).toHaveTextContent('La talanquera de «Entrada principal» no respondió (el relé no respondió). El acceso quedó registrado: ábrela a mano.');
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(onVerFalla).toHaveBeenCalledWith('e1');
  });
});
