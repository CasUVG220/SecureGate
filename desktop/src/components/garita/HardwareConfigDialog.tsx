/**
 * Configuración de hardware de la talanquera: qué driver, sus parámetros y
 * un pulso de prueba sin necesidad de un acceso real.
 *
 * Se guarda en la BD local cifrada del equipo (tabla `config_hardware`).
 * Con "Sin hardware" todo lo demás sigue igual: la apertura física es
 * opcional.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Alert } from '../shared/Alert';
import { Button, Input, Modal, Select, StatusText } from '../ui';
import { textoApertura } from '../../lib/talanquera';
import {
  api, mensajeDe,
  type ConfigGpio, type ConfigHardware, type ConfigSerial, type ConfigTcp, type EstadoHardware,
  type PuertoSerial, type ResultadoApertura,
} from '../../lib/tauri';

type Tipo = ConfigHardware['tipo'];

const SERIAL_DEFECTO: ConfigSerial = {
  puerto: null, baudios: 9600, protocolo: 'lcus', canal: 1, pulso_ms: 500, comando_on_hex: null, comando_off_hex: null,
};
const TCP_DEFECTO: ConfigTcp = {
  host: '', puerto: 6722, modo: 'tcp', comando: 'AT+O1\\r\\n', comando_off: null,
  pulso_ms: 500, timeout_ms: 2000, metodo: 'get', ruta: '/', ruta_off: null,
};
const GPIO_DEFECTO: ConfigGpio = { pin: 17, pulso_ms: 500, activo_alto: true };

const NOMBRE_TIPO: Record<Tipo, string> = {
  ninguno: 'Sin hardware (abrir manual)',
  serial_usb: 'Relé USB (puerto serial)',
  ethernet: 'Relé Ethernet (TCP / HTTP)',
  gpio: 'GPIO directo (Raspberry Pi) — no soportado aún',
};

const etiquetaPuerto = (p: PuertoSerial) => {
  const partes = [p.producto, p.fabricante].filter(Boolean).join(' · ');
  const chip = p.vid === 0x1a86 ? 'CH340' : p.vid === 0x0403 ? 'FTDI' : p.vid === 0x10c4 ? 'CP210x' : p.vid === 0x067b ? 'PL2303' : null;
  return `${p.nombre}${partes ? ` — ${partes}` : ''}${chip ? ` (${chip})` : ''}`;
};

interface Props {
  actual: EstadoHardware;
  onCerrar: () => void;
  onGuardada: (estado: EstadoHardware) => void;
}

export function HardwareConfigDialog({ actual, onCerrar, onGuardada }: Props) {
  const inicial = actual.config;
  const [tipo, setTipo] = useState<Tipo>(inicial.tipo);
  const [serial, setSerial] = useState<ConfigSerial>(inicial.tipo === 'serial_usb' ? { ...SERIAL_DEFECTO, ...inicial } : SERIAL_DEFECTO);
  const [tcp, setTcp] = useState<ConfigTcp>(inicial.tipo === 'ethernet' ? { ...TCP_DEFECTO, ...inicial } : TCP_DEFECTO);
  const [gpio, setGpio] = useState<ConfigGpio>(inicial.tipo === 'gpio' ? { ...GPIO_DEFECTO, ...inicial } : GPIO_DEFECTO);

  const [puertos, setPuertos] = useState<PuertoSerial[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [prueba, setPrueba] = useState<ResultadoApertura | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buscarPuertos = async () => {
    setBuscando(true);
    try { setPuertos(await api.hardware.puertos()); } catch { /* sin lista se escribe a mano */ } finally { setBuscando(false); }
  };
  useEffect(() => { if (tipo === 'serial_usb') void buscarPuertos(); }, [tipo]);

  const config = useMemo<ConfigHardware>(() => {
    switch (tipo) {
      case 'ninguno': return { tipo };
      case 'serial_usb': return { tipo, ...serial };
      case 'ethernet': return { tipo, ...tcp };
      case 'gpio': return { tipo, ...gpio };
    }
  }, [tipo, serial, tcp, gpio]);

  const probar = async () => {
    setProbando(true);
    setPrueba(null);
    setError(null);
    try {
      setPrueba(await api.hardware.probar(config));
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setProbando(false);
    }
  };

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      onGuardada(await api.hardware.configurar(config));
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  };

  const num = (v: string, min: number, max: number, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
  };

  return (
    <Modal
      open
      onClose={onCerrar}
      title="Configuración de hardware"
      description="Cómo abre la talanquera este equipo. Se guarda aquí, cifrado, y no depende del agente de turno."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          <Button variant="secondary" onClick={() => void probar()} loading={probando} disabled={tipo === 'ninguno' || guardando}>
            Probar apertura
          </Button>
          <Button type="submit" form="form-hardware" loading={guardando} disabled={probando}>Guardar</Button>
        </>
      }
    >
      <form id="form-hardware" onSubmit={guardar} className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <Select label="Tipo de driver" value={tipo} onChange={e => { setTipo(e.target.value as Tipo); setPrueba(null); setError(null); }} wrapperClassName="flex-1">
            {(Object.keys(NOMBRE_TIPO) as Tipo[]).map(t => <option key={t} value={t}>{NOMBRE_TIPO[t]}</option>)}
          </Select>
          <div className="pt-5">
            <StatusText kind={actual.estado === 'conectado' ? 'on' : actual.estado === 'sin_driver' ? 'off' : 'warn'}>
              Activo: {actual.nombre}
            </StatusText>
          </div>
        </div>

        {tipo === 'ninguno' && (
          <Alert tone="info">
            El registro de accesos funciona igual; la talanquera se abre con el control remoto o a mano. Puedes
            configurar un relé más adelante sin reinstalar nada.
          </Alert>
        )}

        {tipo === 'serial_usb' && (
          <div className="space-y-4">
            <div>
              <Select
                label="Puerto serial"
                value={serial.puerto ?? ''}
                onChange={e => setSerial({ ...serial, puerto: e.target.value || null })}
                hint={puertos.length === 0 ? 'No se detectaron puertos. Conecta el relé y pulsa «Buscar puertos», o escribe el nombre abajo.' : 'Auto: elige el CH340/FTDI que encuentre. Fija uno si hay varios.'}
              >
                <option value="">Auto-detectar</option>
                {puertos.map(p => <option key={p.nombre} value={p.nombre}>{etiquetaPuerto(p)}</option>)}
                {serial.puerto && !puertos.some(p => p.nombre === serial.puerto) && <option value={serial.puerto}>{serial.puerto} (no detectado ahora)</option>}
              </Select>
              <div className="mt-2 flex gap-2">
                <Input
                  aria-label="Puerto manual"
                  placeholder="o escríbelo: COM3, /dev/ttyUSB0"
                  value={serial.puerto ?? ''}
                  onChange={e => setSerial({ ...serial, puerto: e.target.value.trim() || null })}
                  wrapperClassName="flex-1"
                />
                <Button variant="secondary" size="md" loading={buscando} onClick={() => void buscarPuertos()}>Buscar puertos</Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Select label="Protocolo" value={serial.protocolo} onChange={e => setSerial({ ...serial, protocolo: e.target.value as ConfigSerial['protocolo'] })}
                hint={serial.protocolo === 'lcus' ? 'LCUS-1/2/4/8 y clones CH340: A0 canal estado checksum.' : serial.protocolo === 'ascii' ? 'Texto ON1 / OFF1 con CRLF (firmware tipo Arduino).' : 'Bytes en hex que tú indicas.'}>
                <option value="lcus">LCUS / CH340 (binario)</option>
                <option value="ascii">ASCII (ON1 / OFF1)</option>
                <option value="personalizado">Personalizado (hex)</option>
              </Select>
              <Input label="Canal" type="number" min={1} max={8} value={serial.canal} onChange={e => setSerial({ ...serial, canal: num(e.target.value, 1, 8, 1) })} />
              <Input label="Baudios" type="number" min={300} max={921600} value={serial.baudios} onChange={e => setSerial({ ...serial, baudios: num(e.target.value, 300, 921600, 9600) })} hint="9600 en casi todos." />
            </div>

            {serial.protocolo === 'personalizado' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Comando ON (hex)" placeholder="A0 01 01 A2" value={serial.comando_on_hex ?? ''} onChange={e => setSerial({ ...serial, comando_on_hex: e.target.value })} className="font-mono" required />
                <Input label="Comando OFF (hex)" placeholder="A0 01 00 A1" value={serial.comando_off_hex ?? ''} onChange={e => setSerial({ ...serial, comando_off_hex: e.target.value })} className="font-mono" hint="Vacío si el relé pulsa solo." />
              </div>
            )}

            <Input label="Duración del pulso (ms)" type="number" min={50} max={10000} step={50} value={serial.pulso_ms}
              onChange={e => setSerial({ ...serial, pulso_ms: num(e.target.value, 50, 10000, 500) })}
              hint="Cuánto queda cerrado el contacto. 500 ms funciona con la mayoría; sube si el motor no reacciona, baja si lo interpreta como «mantener abierto»." />
          </div>
        )}

        {tipo === 'ethernet' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_120px_140px]">
              <Input label="IP o host del relé" placeholder="192.168.1.50" required value={tcp.host} onChange={e => setTcp({ ...tcp, host: e.target.value })} />
              <Input label="Puerto" type="number" min={1} max={65535} required value={tcp.puerto} onChange={e => setTcp({ ...tcp, puerto: num(e.target.value, 1, 65535, 80) })} />
              <Select label="Modo" value={tcp.modo} onChange={e => setTcp({ ...tcp, modo: e.target.value as ConfigTcp['modo'], puerto: e.target.value === 'http' && tcp.puerto === 6722 ? 80 : tcp.puerto })}>
                <option value="tcp">Socket TCP</option>
                <option value="http">HTTP</option>
              </Select>
            </div>

            {tcp.modo === 'tcp' ? (
              <>
                <Input label="Comando de apertura" required value={tcp.comando} onChange={e => setTcp({ ...tcp, comando: e.target.value })} className="font-mono"
                  hint="Texto que se escribe en el socket. Escapes: \\r \\n \\t \\xHH. Ejemplos: AT+O1\\r\\n · on1 · \\x01" />
                <Input label="Comando de cierre (opcional)" value={tcp.comando_off ?? ''} onChange={e => setTcp({ ...tcp, comando_off: e.target.value || null })} className="font-mono"
                  hint="Sólo si el relé no pulsa solo y hay que soltarlo; se manda tras el pulso." />
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[120px_1fr]">
                  <Select label="Método" value={tcp.metodo} onChange={e => setTcp({ ...tcp, metodo: e.target.value as ConfigTcp['metodo'] })}>
                    <option value="get">GET</option>
                    <option value="post">POST</option>
                  </Select>
                  <Input label="Ruta de apertura" required value={tcp.ruta} onChange={e => setTcp({ ...tcp, ruta: e.target.value })} className="font-mono" placeholder="/relay?ch=1&on=1" />
                </div>
                {tcp.metodo === 'post' && (
                  <Input label="Cuerpo del POST" value={tcp.comando} onChange={e => setTcp({ ...tcp, comando: e.target.value })} className="font-mono" placeholder="ch=1&state=on" />
                )}
                <Input label="Ruta de cierre (opcional)" value={tcp.ruta_off ?? ''} onChange={e => setTcp({ ...tcp, ruta_off: e.target.value || null })} className="font-mono" placeholder="/relay?ch=1&off=1" hint="Sólo si el relé no pulsa solo." />
              </>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Timeout (ms)" type="number" min={100} max={10000} step={100} value={tcp.timeout_ms} onChange={e => setTcp({ ...tcp, timeout_ms: num(e.target.value, 100, 10000, 2000) })} hint="Se reintenta una vez; el peor caso es el doble." />
              <Input label="Pulso entre apertura y cierre (ms)" type="number" min={50} max={10000} step={50} value={tcp.pulso_ms} onChange={e => setTcp({ ...tcp, pulso_ms: num(e.target.value, 50, 10000, 500) })} hint="Sólo aplica si configuraste cierre." />
            </div>
          </div>
        )}

        {tipo === 'gpio' && (
          <div className="space-y-4">
            <Alert tone="warn">
              GPIO no está implementado en esta versión (la plataforma objetivo es Windows). La configuración se
              guarda para cuando exista soporte en Raspberry Pi; mientras tanto, un relé USB CH340 funciona igual
              en una Pi.
            </Alert>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input label="Pin (BCM)" type="number" min={0} max={40} value={gpio.pin} onChange={e => setGpio({ ...gpio, pin: num(e.target.value, 0, 40, 17) })} />
              <Input label="Pulso (ms)" type="number" min={50} max={10000} value={gpio.pulso_ms} onChange={e => setGpio({ ...gpio, pulso_ms: num(e.target.value, 50, 10000, 500) })} />
              <Select label="Nivel activo" value={gpio.activo_alto ? 'alto' : 'bajo'} onChange={e => setGpio({ ...gpio, activo_alto: e.target.value === 'alto' })}>
                <option value="alto">Alto (3.3 V)</option>
                <option value="bajo">Bajo</option>
              </Select>
            </div>
          </div>
        )}

        {error && <Alert tone="bad">{error}</Alert>}
        {prueba && (
          <Alert tone={prueba.abierta ? 'ok' : 'warn'}>
            {prueba.abierta ? `Pulso enviado (${prueba.driver}). Si la talanquera no se movió, revisa el cableado o el pulso.` : textoApertura(prueba) ?? 'Sin hardware.'}
          </Alert>
        )}
      </form>
    </Modal>
  );
}
