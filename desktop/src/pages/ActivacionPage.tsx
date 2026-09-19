/**
 * Activación de la licencia del dispositivo. Se muestra cuando no hay
 * licencia o cuando quedó bloqueada (revocada / gracia agotada).
 */
import { useState, type FormEvent } from 'react';
import { AuthShell } from '../components/auth/AuthShell';
import { Alert } from '../components/shared/Alert';
import { Button, Input } from '../components/ui';
import { api, mensajeDe, type EstadoApp } from '../lib/tauri';

const ICON_KEY = 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4';
const ICON_TAG = 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01';
const ICON_SERVER = 'M2 5h20v6H2zM2 13h20v6H2zM6 8h.01M6 16h.01';

export function ActivacionPage({ estado, onActivada }: { estado: EstadoApp; onActivada: () => void }) {
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [apiUrl, setApiUrl] = useState(estado.api_url);
  const [mostrarServidor, setMostrarServidor] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lic = estado.licencia;
  const bloqueada = lic.estado === 'bloqueada';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      if (apiUrl.trim() !== estado.api_url) await api.configurarApiUrl(apiUrl);
      await api.licencia.activar(codigo, nombre || undefined);
      onActivada();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setCargando(false);
    }
  };

  return (
    <AuthShell
      titulo="Activar este equipo"
      rotulo="SecureGate Garita"
      subtitulo="Pega el código que te entregó el administrador de la sucursal. Queda vinculado a esta computadora."
      enLinea={estado.sync.en_linea}
      pie={<>Huella de este equipo: <span className="font-mono">{lic.fingerprint.slice(0, 16)}…</span> · v{estado.version}</>}
    >
      {bloqueada && (
        <Alert tone="bad" className="mb-5">
          {lic.motivo === 'gracia_agotada'
            ? 'Este equipo lleva más de 72 h sin contacto con el servidor. Reactívalo con un código vigente.'
            : lic.motivo === 'licencia_revocada'
              ? 'La licencia de este equipo fue revocada. Pide un código nuevo al administrador.'
              : lic.motivo === 'reloj_alterado'
                ? 'El reloj de este equipo está muy atrasado respecto al último contacto con el servidor. Corrige la fecha y hora de Windows y reintenta.'
              : lic.motivo === 'empresa_suspendida'
                ? 'Las operaciones de esta empresa están suspendidas por SecureGate. La licencia de este equipo sigue vigente y se reactivará sola cuando se levante la suspensión; no necesitas un código nuevo.'
                : `La licencia no es válida (${lic.motivo}).`}
        </Alert>
      )}

      <form onSubmit={submit} className="space-y-4">
        <Input
          label="Código de activación"
          icon={ICON_KEY}
          className="min-h-control-lg font-mono text-base tracking-widest"
          autoFocus
          placeholder="SG-XXXX-XXXX-XXXX-XXXX"
          value={codigo}
          onChange={e => setCodigo(e.target.value.toUpperCase())}
          autoComplete="off"
          spellCheck={false}
          required
        />
        <Input
          label="Nombre de esta garita (opcional)"
          icon={ICON_TAG}
          placeholder="Garita norte, Entrada principal…"
          value={nombre}
          onChange={e => setNombre(e.target.value)}
          maxLength={100}
        />

        {mostrarServidor ? (
          <Input
            label="Servidor"
            icon={ICON_SERVER}
            value={apiUrl}
            onChange={e => setApiUrl(e.target.value)}
            hint="URL del backend de SecureGate, sin /api"
            spellCheck={false}
          />
        ) : (
          <p className="text-xs text-gray-400">
            Servidor: <span className="font-mono text-gray-300">{estado.api_url}</span>
            {' · '}
            <button type="button" className="font-semibold text-gray-200 underline-offset-4 hover:underline" onClick={() => setMostrarServidor(true)}>
              cambiar
            </button>
          </p>
        )}

        {error && <Alert tone="bad">{error}</Alert>}

        <Button type="submit" size="lg" fullWidth loading={cargando} disabled={codigo.trim().length < 8} className="mt-2">
          {cargando ? 'Activando…' : 'Activar licencia'}
        </Button>
      </form>
    </AuthShell>
  );
}
