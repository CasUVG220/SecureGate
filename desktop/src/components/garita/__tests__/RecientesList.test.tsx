import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecientesList, motivoSinSalida } from '../RecientesList';
import type { AccesoPendiente } from '../../../lib/tauri';

const acceso = (over: Partial<AccesoPendiente> = {}): AccesoPendiente => ({
  id_cliente: 'c1', registrado_en: '2026-10-10T15:00:00Z', estado: 'sincronizado', intentos: 0, ultimo_error: null,
  sincronizado_en: '2026-10-10T15:00:05Z', nombre_visitante: 'Ana Visitante', numero_dpi: '2999000010101',
  placa: 'P123ABC', residente_casa: 'A-12', capturado_manualmente: false, registro_id: 'reg-1', ...over,
});

const LISTA = [
  acceso(),
  acceso({ id_cliente: 'c2', nombre_visitante: 'Beto Pendiente', numero_dpi: '2999000020202', placa: null, residente_casa: 'B-3', estado: 'pendiente', registro_id: null, intentos: 2 }),
  acceso({ id_cliente: 'c3', nombre_visitante: 'Carla Vetada', numero_dpi: '2999000030303', placa: 'C999ZZZ', residente_casa: 'C-1', estado: 'rechazado', registro_id: null, ultimo_error: 'Visitante en blacklist' }),
];

describe('motivoSinSalida', () => {
  it('solo los ya enviados con conexión pueden cerrarse; el resto trae su motivo', () => {
    expect(motivoSinSalida(LISTA[0], true)).toBeNull();
    expect(motivoSinSalida(LISTA[0], false)).toMatch(/Sin conexión/);
    expect(motivoSinSalida(LISTA[1], true)).toMatch(/Aún no se envía/);
    expect(motivoSinSalida(acceso({ registro_id: null }), true)).toMatch(/Aún no se envía/);
  });
});

describe('RecientesList — buscar y dar salida', () => {
  it('«Dar salida» en los ya enviados abre la salida de ESA persona', () => {
    const onSalida = vi.fn();
    render(<RecientesList accesos={LISTA} enLinea onSalida={onSalida} />);
    const boton = screen.getByRole('button', { name: 'Dar salida a Ana Visitante' });
    expect(boton).toBeEnabled();
    fireEvent.click(boton);
    expect(onSalida).toHaveBeenCalledWith(LISTA[0]);
  });

  it('los pendientes tienen el botón apagado con el motivo a la vista; los rechazados no lo ofrecen', () => {
    render(<RecientesList accesos={LISTA} enLinea onSalida={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Dar salida a Beto Pendiente' })).toBeDisabled();
    expect(screen.getByText(/Aún no se envía al servidor/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dar salida a Carla/ })).toBeNull();
    expect(screen.getByText('Visitante en blacklist')).toBeInTheDocument();
  });

  it('sin conexión el botón se apaga y lo dice', () => {
    render(<RecientesList accesos={[LISTA[0]]} enLinea={false} onSalida={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Dar salida a Ana Visitante' })).toBeDisabled();
    expect(screen.getByText('Sin conexión: la salida se registra en el servidor.')).toBeInTheDocument();
  });

  it('busca por nombre, DPI, casa y placa en cualquier formato', () => {
    render(<RecientesList accesos={LISTA} enLinea onSalida={vi.fn()} />);
    const buscar = screen.getByLabelText('Buscar entre los registrados en este equipo');
    const visibles = () => screen.queryAllByRole('listitem').map(li => li.textContent ?? '');

    fireEvent.change(buscar, { target: { value: 'beto' } });
    expect(visibles()).toHaveLength(1);
    fireEvent.change(buscar, { target: { value: '2999000030303' } });
    expect(visibles()[0]).toContain('Carla Vetada');
    fireEvent.change(buscar, { target: { value: 'a-12' } });
    expect(visibles()[0]).toContain('Ana Visitante');
    for (const placa of ['p123abc', 'P-123ABC', ' p 123 ']) {
      fireEvent.change(buscar, { target: { value: placa } });
      expect(visibles()[0], placa).toContain('Ana Visitante');
    }
    fireEvent.change(buscar, { target: { value: 'nadie-asi' } });
    expect(screen.getByText('Sin coincidencias')).toBeInTheDocument();
  });

  it('sin búsqueda muestra los 30 más recientes; al buscar recorre todo el turno', () => {
    const muchos = Array.from({ length: 45 }, (_, i) =>
      acceso({ id_cliente: `m${i}`, nombre_visitante: `Persona ${String(i).padStart(2, '0')}`, registro_id: `r${i}` }));
    render(<RecientesList accesos={muchos} enLinea onSalida={vi.fn()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(30);
    fireEvent.change(screen.getByLabelText('Buscar entre los registrados en este equipo'), { target: { value: 'Persona 44' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('sin la acción de salida (modo solo lectura) no pinta botones', () => {
    render(<RecientesList accesos={LISTA} />);
    expect(screen.queryByRole('button', { name: /Dar salida/ })).toBeNull();
  });

  it('ANPR: vehículo de residente sin DPI, con su origen, y sin «Dar salida» (la salida es del carril de salida)', () => {
    render(<RecientesList
      accesos={[
        acceso({ id_cliente: 'a1', nombre_visitante: 'Ana Residente', numero_dpi: '', origen: 'anpr' }),
        acceso({ id_cliente: 'a2', nombre_visitante: 'Luis Residente', numero_dpi: '', origen: 'anpr', capturado_manualmente: true, placa: 'M771KLM' }),
      ]}
      enLinea
      onSalida={vi.fn()}
    />);
    expect(screen.getByText(/A-12 · Vehículo de residente · P-123ABC/)).toBeInTheDocument();
    expect(screen.getByText('ANPR, confirmado por el agente')).toBeInTheDocument();
    expect(screen.queryByText(/DPI/)).toBeNull();
    expect(screen.queryByText(/manual/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Dar salida/ })).toBeNull();
  });
});
