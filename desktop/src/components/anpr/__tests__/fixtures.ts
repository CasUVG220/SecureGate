import type { CarrilConEstado, EstadoAnpr, EventoAnpr } from '../../../lib/tauri';

/** Evento de prueba (datos sintéticos). */
export function evento(parcial: Partial<EventoAnpr> = {}): EventoAnpr {
  return {
    id: 'ev-1', carril_id: 'c1', track_id: 'c1-1', sentido: 'entrada', placa: 'P123ABC', placa_probable: 'P123ABC',
    resultado: 'confirmada', estado: 'automatico', motivo: null, confianza: 0.95, lecturas: [], requiere_verificacion: false,
    vehiculo_id: 'veh-1', residente_id: 'res-1', residente_casa: 'Casa 12', residente_nombre: 'Ana Prueba', id_cliente: 'idc-1',
    apertura: null, ms_desde_legible: 380, creado_en: '2026-10-22T15:00:00Z', resuelto_por: null, resuelto_en: null,
    resolucion: null, evidencia_placa: true, evidencia_vehiculo: true,
    ...parcial,
  };
}

export function carril(parcial: Partial<CarrilConEstado> = {}): CarrilConEstado {
  return {
    id: 'c1', nombre: 'Entrada principal', camara_id: 'cam1', sentido: 'entrada', modo: 'automatico', roi: [],
    umbrales: {}, actuador: { tipo: 'simulado' }, estado: { estado: 'activo', fps: 5 },
    ...parcial,
  };
}

export function estadoAnpr(parcial: Partial<EstadoAnpr> = {}): EstadoAnpr {
  return { pausado: false, proceso_activo: true, error: null, carriles: [carril()], pendientes: 0, ...parcial };
}
