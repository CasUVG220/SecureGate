/**
 * Panel del ANPR en la columna de cámaras (Sprint 10): estado de cada carril y su vista en vivo con la superposición de lo
 * que el sistema está viendo (área del carril y una caja por vehículo, con su estado o su placa).
 *
 * La imagen es la del puente local de cámaras (MJPEG, sin credenciales); las cajas llegan por `sg://anpr` en píxeles del
 * cuadro que analizó el sidecar y se dibujan en porcentaje, así coinciden a cualquier tamaño.
 */
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, StatusText, type StatusKind } from '../ui';
import { Alert } from '../shared/Alert';
import { urlVista } from '../../lib/camarasRed';
import { cajaRelativa, colorPista, MODO_TEXTO, puntosSvg, rotuloPista, SENTIDO_TEXTO, textoEstadoCarril, type TonoAnpr } from '../../lib/anpr';
import { api, type CarrilConEstado, type EstadoAnpr } from '../../lib/tauri';
import type { PistasCarril } from '../../hooks/useAnpr';

const KIND: Record<TonoAnpr, StatusKind> = { ok: 'on', warn: 'warn', bad: 'bad', info: 'off' };
const ICON_CARRIL = 'M4 19h16M4 15h16M8 11V5h8v6';

interface Props {
  estado: EstadoAnpr | null;
  pistas: Record<string, PistasCarril>;
  error: string | null;
  onConfigurar: () => void;
}

export function AnprPanel({ estado, pistas, error, onConfigurar }: Props) {
  const [puente, setPuente] = useState<{ puerto: number; token: string } | null>(null);
  const carriles = estado?.carriles ?? [];
  const pausado = !!estado?.pausado;

  const hayActivos = carriles.some(c => c.modo !== 'apagado');

  useEffect(() => {
    if (!hayActivos) return;
    let vivo = true;
    api.camaras.puente().then(p => { if (vivo) setPuente(p); }).catch(() => {});
    return () => { vivo = false; };
  }, [hayActivos]);

  return (
    <Card
      title="Reconocimiento de placas"
      description="El residente autorizado entra solo; lo demás te lo pide para verificar. La captura por clic sigue disponible."
      actions={<Button size="sm" variant="secondary" onClick={onConfigurar}>Configurar carriles</Button>}
    >
      {error && <Alert tone="warn" className="mb-3">{error}</Alert>}
      {pausado && (
        <Alert tone="warn" className="mb-3">ANPR en pausa: ningún carril abre solo. Registra con el formulario de siempre.</Alert>
      )}
      {carriles.length === 0 ? (
        <EmptyState
          compact
          icon={ICON_CARRIL}
          title="Sin carriles configurados"
          description="Asigna una cámara IP fija a cada carril para que el sistema lea las placas solo."
        />
      ) : (
        <ul className="space-y-4">
          {carriles.map(c => (
            <li key={c.id}>
              <CarrilVivo carril={c} pausado={pausado} pistas={pistas[c.id]} puente={puente} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CarrilVivo({ carril, pausado, pistas, puente }: {
  carril: CarrilConEstado; pausado: boolean; pistas?: PistasCarril; puente: { puerto: number; token: string } | null;
}) {
  const st = textoEstadoCarril(carril.estado, carril.modo, pausado);
  const enVivo = !pausado && carril.modo !== 'apagado' && carril.estado?.estado === 'activo' && !!carril.camara_id && !!puente;
  const tamano = pistas?.tamano ?? null;
  const vistas = pistas?.pistas ?? [];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-100">
          {carril.nombre} <span className="font-normal text-gray-400">· {SENTIDO_TEXTO[carril.sentido]} · {MODO_TEXTO[carril.modo]}</span>
        </p>
        <StatusText kind={KIND[st.tono]}>{st.texto}</StatusText>
      </div>
      {enVivo && (
        <div
          className="relative w-full overflow-hidden rounded-lg border border-gray-700 bg-dark-900"
          style={{ aspectRatio: tamano ? `${tamano[0]} / ${tamano[1]}` : '16 / 9' }}
        >
          <img
            src={urlVista(puente!, carril.camara_id!)}
            alt={`Vista en vivo de ${carril.nombre}`}
            className="absolute inset-0 h-full w-full object-fill"
          />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
            <polygon points={puntosSvg(carril.roi)} fill="none" stroke="rgb(var(--c-brand-400))" strokeWidth="0.6" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke" />
          </svg>
          {tamano && vistas.map(p => {
            const r = cajaRelativa(p, tamano);
            const color = colorPista(p.estado);
            return (
              <div
                key={p.id}
                data-testid="pista-anpr"
                className="pointer-events-none absolute rounded-sm border-2"
                style={{ left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%`, borderColor: color }}
              >
                <span className="absolute -top-5 left-0 whitespace-nowrap rounded px-1 text-2xs font-bold text-white" style={{ background: color }}>
                  {rotuloPista(p)}
                </span>
              </div>
            );
          })}
          {/* Para lectores de pantalla: qué hay en el carril, sin depender de la imagen. */}
          <p className="sr-only" aria-live="off">
            {vistas.length === 0 ? 'Sin vehículos en el carril.' : `${vistas.length} vehículo(s): ${vistas.map(rotuloPista).join(', ')}.`}
          </p>
        </div>
      )}
    </div>
  );
}
