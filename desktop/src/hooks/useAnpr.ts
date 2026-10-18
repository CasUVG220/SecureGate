/**
 * Estado del ANPR continuo para la pantalla de la garita (Sprint 10): carriles y su estado, eventos en tiempo real, pistas
 * para la superposición, alertas de lista negra (con sonido) y fallas de la barrera.
 *
 * Al montarse con sesión arranca los carriles habilitados (`anpr_iniciar`); al cerrar turno Rust los detiene solo. Nada de
 * esto bloquea el modo por clic: si el ANPR no arranca, la pantalla lo dice y la garita sigue igual.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api, mensajeDe, onAnpr,
  type EstadoAnpr, type EventoAnpr, type MensajeAnpr, type PistaAnpr, type ResolucionAnpr,
} from '../lib/tauri';
import { pendiente, sonarAlerta } from '../lib/anpr';

export interface PistasCarril {
  pistas: PistaAnpr[];
  tamano: [number, number] | null;
}

export interface FallaActuador {
  evento_id: string;
  carril: string;
  error: string;
}

/** Cuántos eventos se conservan en pantalla. */
const MAX_EVENTOS = 50;

function insertar(lista: EventoAnpr[], e: EventoAnpr): EventoAnpr[] {
  const resto = lista.filter(x => x.id !== e.id);
  return [e, ...resto].slice(0, MAX_EVENTOS);
}

export function useAnpr(habilitado: boolean) {
  const [estado, setEstado] = useState<EstadoAnpr | null>(null);
  const [eventos, setEventos] = useState<EventoAnpr[]>([]);
  const [pistas, setPistas] = useState<Record<string, PistasCarril>>({});
  const [error, setError] = useState<string | null>(null);
  const [fallasVistas, setFallasVistas] = useState<Set<string>>(() => new Set());
  const [pausando, setPausando] = useState(false);
  const montado = useRef(true);

  const refrescar = useCallback(async () => {
    try {
      const [e, ev] = await Promise.all([api.anpr.estado(), api.anpr.eventos(MAX_EVENTOS)]);
      if (!montado.current) return;
      setEstado(e);
      setEventos(ev);
    } catch {
      /* sin ANPR (app vieja o base cerrada): no hay nada que mostrar */
    }
  }, []);

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  // Arranque con sesión.
  useEffect(() => {
    if (!habilitado) return;
    let vivo = true;
    void (async () => {
      try {
        const e = await api.anpr.iniciar();
        if (vivo) { setEstado(e); setError(null); }
      } catch (e) {
        if (vivo) setError(mensajeDe(e));
      }
      if (vivo) await refrescar();
    })();
    return () => { vivo = false; };
  }, [habilitado, refrescar]);

  const recibir = useCallback((m: MensajeAnpr) => {
    switch (m.tipo) {
      case 'fotograma':
        setPistas(p => ({ ...p, [m.carril]: { pistas: m.pistas ?? [], tamano: m.tamano ?? p[m.carril]?.tamano ?? null } }));
        break;
      case 'evento':
        setEventos(l => insertar(l, m.evento));
        if (m.alerta) sonarAlerta();
        break;
      case 'estado':
        setEstado(s => (s ? { ...s, carriles: s.carriles.map(c => (c.id === m.carril ? { ...c, estado: m.estado } : c)) } : s));
        if (m.estado.estado === 'detenido') setPistas(p => { const n = { ...p }; delete n[m.carril]; return n; });
        break;
      case 'apertura': {
        const apertura = m.ok ? (m.simulada ? 'simulada' : 'abierta') : `fallo: ${m.error ?? 'sin respuesta'}`;
        setEventos(l => l.map(e => (e.id === m.evento_id ? { ...e, apertura } : e)));
        break;
      }
    }
  }, []);

  useEffect(() => {
    let quitar: (() => void) | undefined;
    let vivo = true;
    void onAnpr(recibir).then(u => { if (vivo) quitar = u; else u(); }).catch(() => {});
    return () => { vivo = false; quitar?.(); };
  }, [recibir]);

  /** Alertas de lista negra que nadie ha marcado «Enterado». */
  const alertas = useMemo(() => eventos.filter(e => e.estado === 'alerta_lista_negra'), [eventos]);

  /** La barrera no respondió: queda a la vista hasta que el agente la marque como vista. */
  const fallas = useMemo<FallaActuador[]>(() => eventos
    .filter(e => e.apertura?.startsWith('fallo') && !fallasVistas.has(e.id))
    .map(e => ({ evento_id: e.id, carril: e.carril_id, error: e.apertura!.replace(/^fallo:\s*/, '') })), [eventos, fallasVistas]);

  /** Eventos que esperan al agente (verificaciones, ilegibles, alertas). */
  const pendientes = useMemo(() => eventos.filter(pendiente).length, [eventos]);

  const verFalla = useCallback((eventoId: string) => setFallasVistas(s => new Set(s).add(eventoId)), []);

  const resolver = useCallback(async (eventoId: string, resolucion: ResolucionAnpr, placa?: string | null) => {
    const e = await api.anpr.resolver(eventoId, resolucion, placa);
    setEventos(l => insertar(l, e));
    return e;
  }, []);

  const pausar = useCallback(async (pausado: boolean) => {
    setPausando(true);
    try {
      setEstado(await api.anpr.pausar(pausado));
      setError(null);
      if (pausado) setPistas({});
    } catch (e) {
      setError(mensajeDe(e));
      await refrescar();
    } finally {
      setPausando(false);
    }
  }, [refrescar]);

  const nombreCarril = useCallback(
    (id: string) => estado?.carriles.find(c => c.id === id)?.nombre ?? id,
    [estado],
  );

  return {
    estado, eventos, pistas, error: error ?? estado?.error ?? null, alertas, fallas, pendientes,
    verFalla, resolver, pausar, pausando, refrescar, nombreCarril,
  };
}

export type Anpr = ReturnType<typeof useAnpr>;
