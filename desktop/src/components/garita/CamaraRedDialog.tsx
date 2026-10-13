/**
 * Alta y edición de una cámara de red (IP o celular): descubrimiento ONVIF, dirección, credenciales y «Probar conexión».
 *
 * - El usuario y la contraseña se escriben aquí, viajan UNA vez a Rust y se guardan en el llavero del sistema. Al editar no se vuelven
 *   a mostrar: el campo queda vacío («Déjalo vacío para conservar la actual») y hay una casilla para quitarlas.
 * - «Guardar» exige haber probado la conexión con los datos actuales; «Guardar sin probar» existe para una cámara que está apagada ahora.
 * - Nunca se muestra ni se registra la dirección con credenciales: la dirección va sin usuario ni contraseña.
 */
import { useEffect, useState } from 'react';
import { Alert } from '../shared/Alert';
import { Button, Input, Modal, PasswordInput, Select } from '../ui';
import { api, mensajeDe, type CamaraRed, type ResultadoPrueba, type TipoCamara } from '../../lib/tauri';
import { EJEMPLO_URL, NOMBRE_TIPO } from '../../lib/camarasRed';
import { GuiaCelular } from './GuiaCelular';

interface Props {
  /** Cámara que se edita, o `null` para un alta. */
  camara: CamaraRed | null;
  onGuardada: () => void;
  onCerrar: () => void;
}

interface Hallazgo { ip: string; nombre: string | null; modelo: string | null; url_sugerida: string }

export function CamaraRedDialog({ camara, onGuardada, onCerrar }: Props) {
  const [tipo, setTipo] = useState<Exclude<TipoCamara, 'usb'>>(camara && camara.tipo !== 'usb' ? camara.tipo : 'ip');
  const [nombre, setNombre] = useState(camara?.nombre ?? '');
  const [url, setUrl] = useState(camara?.url ?? '');
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [quitar, setQuitar] = useState(false);
  const [probando, setProbando] = useState(false);
  /** Resultado de la última prueba, válido solo para los datos con los que se hizo. */
  const [prueba, setPrueba] = useState<{ firma: string; r: ResultadoPrueba } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [hallazgos, setHallazgos] = useState<Hallazgo[] | null>(null);

  const editando = !!camara;
  // Cualquier cambio invalida la prueba anterior.
  const firma = JSON.stringify([tipo, url.trim(), usuario, clave, quitar]);
  const probada = prueba?.firma === firma && prueba.r.ok;
  const valido = nombre.trim().length > 0 && url.trim().length > 0;

  useEffect(() => { setError(null); }, [tipo, nombre, url, usuario, clave]);

  const entrada = () => ({
    id: camara?.id ?? null, tipo, nombre: nombre.trim(), url: url.trim(),
    usuario: usuario.trim() || null, clave: usuario.trim() ? clave : null, quitar_credenciales: quitar,
  });

  const buscar = async () => {
    setBuscando(true); setError(null);
    try {
      setHallazgos(await api.camaras.descubrir());
    } catch (e) {
      setHallazgos([]);
      setError(mensajeDe(e));
    } finally {
      setBuscando(false);
    }
  };

  const usar = (h: Hallazgo) => {
    setTipo('ip');
    setUrl(h.url_sugerida);
    if (!nombre.trim()) setNombre(h.nombre ?? h.modelo ?? `Cámara ${h.ip}`);
  };

  const probar = async () => {
    setProbando(true); setError(null);
    try {
      setPrueba({ firma, r: await api.camaras.probar(entrada()) });
    } catch (e) {
      setPrueba({ firma, r: { ok: false, mensaje: mensajeDe(e), ms: 0, ancho: null, alto: null } });
    } finally {
      setProbando(false);
    }
  };

  const guardar = async () => {
    setGuardando(true); setError(null);
    try {
      await api.camaras.guardar(entrada());
      onGuardada();
      onCerrar();
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open
      onClose={onCerrar}
      dismissible={!guardando && !probando}
      size="lg"
      title={editando ? 'Editar cámara' : 'Agregar cámara IP o celular'}
      description="Solo se aceptan cámaras de tu red local. La contraseña se guarda de forma segura en este equipo."
      footer={
        <>
          <Button variant="ghost" onClick={onCerrar} disabled={guardando}>Cancelar</Button>
          <Button variant="secondary" onClick={() => void probar()} loading={probando} disabled={!valido || guardando}>Probar conexión</Button>
          {!probada && (
            <Button variant="secondary" onClick={() => void guardar()} loading={guardando} disabled={!valido || probando}>Guardar sin probar</Button>
          )}
          <Button onClick={() => void guardar()} loading={guardando} disabled={!valido || !probada || probando}>Guardar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select label="Tipo de cámara" value={tipo} onChange={e => { setTipo(e.target.value as 'ip' | 'celular'); setPrueba(null); }}>
          <option value="ip">{NOMBRE_TIPO.ip} (de seguridad, con dirección rtsp://)</option>
          <option value="celular">{NOMBRE_TIPO.celular} (con una app que transmite por la red)</option>
        </Select>

        {tipo === 'ip' && !editando && (
          <div className="rounded-lg border border-gray-600 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-300">¿No sabes la dirección? Busca las cámaras de tu red.</p>
              <Button variant="secondary" size="sm" onClick={() => void buscar()} loading={buscando}>Buscar cámaras en la red</Button>
            </div>
            {hallazgos && hallazgos.length === 0 && !buscando && (
              <p role="status" className="mt-2 text-xs text-gray-400">
                No se encontró ninguna. No todas las cámaras se anuncian: escribe su dirección a mano (la trae el manual).
              </p>
            )}
            {hallazgos && hallazgos.length > 0 && (
              <ul aria-label="Cámaras encontradas" className="mt-2 divide-y divide-gray-700 rounded-lg border border-gray-600">
                {hallazgos.map(h => (
                  <li key={h.ip} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-gray-200">
                      <strong>{h.nombre ?? h.modelo ?? 'Cámara sin nombre'}</strong> · {h.ip}{h.modelo && h.nombre ? ` · ${h.modelo}` : ''}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => usar(h)}>Usar</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tipo === 'celular' && <GuiaCelular />}

        <Input label="Nombre" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Carril de entrada" maxLength={60} required />
        <Input
          label="Dirección de la cámara"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder={EJEMPLO_URL[tipo]}
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
          hint={tipo === 'ip'
            ? 'Empieza con rtsp:// y la trae el manual de la cámara. Sin usuario ni contraseña: van en los campos de abajo.'
            : 'La que muestra la app del celular al iniciar la transmisión, por ejemplo http://192.168.1.60:8080/video.'}
          required
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Usuario (si la cámara lo pide)"
            value={usuario}
            onChange={e => { setUsuario(e.target.value); setQuitar(false); }}
            autoComplete="off"
            hint={editando && camara?.con_credenciales ? 'Déjalo vacío para conservar el usuario y la contraseña actuales.' : undefined}
          />
          <PasswordInput
            label="Contraseña"
            value={clave}
            onChange={e => setClave(e.target.value)}
            requisitos={false}
            autoComplete="off"
            mostrarLabel="Mostrar contraseña"
            ocultarLabel="Ocultar contraseña"
          />
        </div>
        {editando && camara?.con_credenciales && (
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-gray-200">
            <input
              type="checkbox" className="h-4 w-4 rounded border-gray-500 accent-brand-500" checked={quitar}
              onChange={e => { setQuitar(e.target.checked); if (e.target.checked) { setUsuario(''); setClave(''); } }}
            />
            Esta cámara ya no pide usuario ni contraseña (quitar las guardadas)
          </label>
        )}

        {prueba && prueba.firma === firma && (
          <Alert tone={prueba.r.ok ? 'ok' : 'bad'}>
            <span data-testid="resultado-prueba">{prueba.r.mensaje}</span>
            {prueba.r.ok && <span className="block text-xs">Tardó {(prueba.r.ms / 1000).toFixed(1)} s en mostrar la primera imagen.</span>}
          </Alert>
        )}
        {error && <Alert tone="bad">{error}</Alert>}
      </div>
    </Modal>
  );
}
