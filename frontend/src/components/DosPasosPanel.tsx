/**
 * Verificación en dos pasos del administrador (SCRUM-123), dentro de «Mi cuenta».
 *
 * - Activarla: se muestra el QR (y la clave en texto) → se escribe el primer código de la app y la contraseña → quedan
 *   activos y se entregan los 10 códigos de recuperación, que se ven UNA sola vez.
 * - Desactivarla pide la contraseña y un código (de la app o de recuperación); generar códigos nuevos pide un código de la app.
 * - Un código errado nunca saca a la persona de la pantalla: el backend responde 400 (no 401) en estas rutas.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import {
  confirmarDosPasos, desactivarDosPasos, getDosPasosEstado, iniciarDosPasos, regenerarCodigosRecuperacion,
  type DosPasosEstado,
} from '../services/api';
import { Button, Input, Modal, PasswordInput, StatusText, useToast } from './ui';
import { rellenar } from './charts/format';
import { useTranslation } from '../i18n/useTranslation';
import { plural } from '../i18n/plural';
import { formatearFecha } from '../utils/fecha';
import { mensajeDosPasos, textoCodigosRecuperacion } from '../utils/dosPasos';

type Dialogo = null | 'activar' | 'desactivar' | 'regenerar';

/** Por debajo de esto se avisa que conviene generar códigos nuevos. */
const POCOS_CODIGOS = 3;

interface Configuracion { secreto: string; qr: string }

const Alerta = ({ children }: { children: React.ReactNode }) => (
  <p role="alert" className="rounded-lg border border-danger-500/40 bg-danger-500/10 px-3 py-2 text-sm text-danger-400">{children}</p>
);

export default function DosPasosPanel({ correo }: { correo: string }) {
  const { t } = useTranslation();
  const showToast = useToast();

  const [estado, setEstado] = useState<DosPasosEstado | null>(null);
  const [errorCarga, setErrorCarga] = useState(false);
  const [dialogo, setDialogo] = useState<Dialogo>(null);

  // Activar
  const [config, setConfig] = useState<Configuracion | null>(null);
  const [errorInicio, setErrorInicio] = useState('');
  // Compartido por los tres diálogos con un código
  const [codigo, setCodigo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  /** Códigos de recuperación recién entregados: se muestran una sola vez. */
  const [codigosNuevos, setCodigosNuevos] = useState<string[] | null>(null);

  const cargar = useCallback(async () => {
    try {
      setEstado(await getDosPasosEstado());
      setErrorCarga(false);
    } catch {
      setErrorCarga(true);
    }
  }, []);

  useEffect(() => {
    // Carga inicial: el estado llega del servidor y no se puede derivar de otro dato.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  const abrir = (cual: Exclude<Dialogo, null>) => {
    setCodigo(''); setPassword(''); setError(''); setEnviando(false);
    setDialogo(cual);
  };
  const cerrar = () => { if (!enviando) setDialogo(null); };

  const abrirActivar = async () => {
    abrir('activar');
    setConfig(null);
    setErrorInicio('');
    try {
      const { secreto, otpauth_url } = await iniciarDosPasos();
      const qr = await QRCode.toDataURL(otpauth_url, { width: 224, margin: 2 });
      setConfig({ secreto, qr });
    } catch (err) {
      setErrorInicio(mensajeDosPasos(err, t));
    }
  };

  /** Envío común: valida lo mínimo, llama, y traduce el error. */
  const enviar = (e: FormEvent, necesitaPassword: boolean, operacion: () => Promise<void>) => {
    e.preventDefault();
    if (necesitaPassword && !password) { setError(t('twofa.err.passwordRequired')); return; }
    if (!codigo.trim()) { setError(t('twofa.err.codeRequired')); return; }
    setError('');
    setEnviando(true);
    operacion()
      .catch(err => { setError(mensajeDosPasos(err, t)); setCodigo(''); })
      .finally(() => setEnviando(false));
  };

  const activar = (e: FormEvent) => enviar(e, true, async () => {
    const codigos = await confirmarDosPasos(codigo.trim(), password);
    setDialogo(null);
    setCodigosNuevos(codigos);
    showToast(t('twofa.activated'));
    await cargar();
  });

  const desactivar = (e: FormEvent) => enviar(e, true, async () => {
    await desactivarDosPasos(password, codigo.trim());
    setDialogo(null);
    showToast(t('twofa.deactivated'));
    await cargar();
  });

  const regenerar = (e: FormEvent) => enviar(e, false, async () => {
    const codigos = await regenerarCodigosRecuperacion(codigo.trim());
    setDialogo(null);
    setCodigosNuevos(codigos);
    showToast(t('twofa.regenerated'));
    await cargar();
  });

  const activada = estado?.activado === true;
  const pocos = activada && (estado?.codigos_restantes ?? 0) <= POCOS_CODIGOS;

  const campoCodigo = (permiteRecuperacion: boolean) => (
    <Input
      label={permiteRecuperacion ? `${t('twofa.code')} / ${t('twofa.recoveryCode')}` : t('twofa.code')}
      hint={permiteRecuperacion ? undefined : t('twofa.codeHint')}
      value={codigo}
      onChange={e => setCodigo(e.target.value)}
      autoComplete="one-time-code"
      inputMode={permiteRecuperacion ? 'text' : 'numeric'}
      maxLength={permiteRecuperacion ? 16 : 7}
      placeholder={permiteRecuperacion ? '123456 / XXXXX-XXXXX' : '123456'}
      spellCheck={false}
      autoFocus
      className="font-mono tracking-widest"
    />
  );

  return (
    <section className="sg-card space-y-4 p-5 sm:p-6" aria-labelledby="dos-pasos-titulo">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="dos-pasos-titulo" className="text-lg font-bold text-white">{t('twofa.title')}</h2>
          <p className="mt-1 max-w-prose text-sm text-gray-400">{t('twofa.intro')}</p>
        </div>
        {estado && (
          <StatusText kind={activada ? 'on' : 'off'}>{activada ? t('twofa.status.on') : t('twofa.status.off')}</StatusText>
        )}
      </div>

      {errorCarga && <Alerta>{t('account.loadError')}</Alerta>}

      {activada && estado && (
        <div className="space-y-1 text-sm text-gray-300">
          {estado.activado_en && <p>{rellenar(t('twofa.since'), { fecha: formatearFecha(estado.activado_en) })}</p>}
          <p className={pocos ? 'font-semibold text-warning-400' : undefined}>
            {plural(t, 'twofa.recoveryLeft', estado.codigos_restantes)}
          </p>
          {pocos && <p className="text-xs text-warning-400">{t('twofa.recoveryLow')}</p>}
        </div>
      )}

      {estado && (
        <div className="flex flex-wrap gap-2">
          {activada ? (
            <>
              <Button variant="secondary" onClick={() => abrir('regenerar')}>{t('twofa.regenerate')}</Button>
              <Button variant="secondary" onClick={() => abrir('desactivar')}>{t('twofa.deactivate')}</Button>
            </>
          ) : (
            <Button onClick={() => void abrirActivar()}>{t('twofa.activate')}</Button>
          )}
        </div>
      )}

      {/* ── Activar: QR + primer código ── */}
      <Modal
        open={dialogo === 'activar'}
        onClose={cerrar}
        dismissible={!enviando}
        title={t('twofa.setup.title')}
        footer={
          <>
            <Button variant="ghost" onClick={cerrar} disabled={enviando}>{t('common.cancel')}</Button>
            <Button type="submit" form="form-2fa-activar" loading={enviando} disabled={!config}>{t('twofa.setup.confirm')}</Button>
          </>
        }
      >
        <form id="form-2fa-activar" onSubmit={activar} className="space-y-4" noValidate>
          {errorInicio && <Alerta>{errorInicio}</Alerta>}
          <p className="text-sm text-gray-300">{t('twofa.setup.step1')}</p>
          <div className="flex flex-col items-center gap-3">
            {config ? (
              // El QR va sobre fondo blanco aunque el tema sea oscuro: los lectores necesitan ese contraste.
              <img src={config.qr} alt={t('twofa.setup.qrAlt')} width={224} height={224} className="rounded-lg border border-gray-600 bg-white" />
            ) : !errorInicio && (
              <p className="py-8 text-sm text-gray-400">{t('twofa.setup.loading')}</p>
            )}
            {config && (
              <div className="w-full text-center">
                <p className="text-xs text-gray-400">{t('twofa.setup.manual')}</p>
                <code data-testid="clave-manual" className="mt-1 inline-block select-all break-all rounded-md bg-gray-700 px-2 py-1 font-mono text-sm tracking-wider text-gray-100">
                  {config.secreto.match(/.{1,4}/g)?.join(' ')}
                </code>
              </div>
            )}
          </div>
          <p className="text-sm text-gray-300">{t('twofa.setup.step2')}</p>
          {error && <Alerta>{error}</Alerta>}
          {campoCodigo(false)}
          <PasswordInput
            label={t('common.password')}
            hint={t('twofa.setup.passwordHint')}
            value={password}
            onChange={e => setPassword(e.target.value)}
            requisitos={false}
            autoComplete="current-password"
          />
        </form>
      </Modal>

      {/* ── Desactivar: contraseña + código ── */}
      <Modal
        open={dialogo === 'desactivar'}
        onClose={cerrar}
        dismissible={!enviando}
        size="sm"
        title={t('twofa.disable.title')}
        footer={
          <>
            <Button variant="ghost" onClick={cerrar} disabled={enviando}>{t('common.cancel')}</Button>
            <Button type="submit" form="form-2fa-desactivar" variant="danger" loading={enviando}>{t('twofa.deactivate')}</Button>
          </>
        }
      >
        <form id="form-2fa-desactivar" onSubmit={desactivar} className="space-y-4" noValidate>
          <p className="text-sm text-gray-300">{t('twofa.disable.body')}</p>
          {error && <Alerta>{error}</Alerta>}
          <PasswordInput
            label={t('common.password')}
            value={password}
            onChange={e => setPassword(e.target.value)}
            requisitos={false}
            autoComplete="current-password"
          />
          {campoCodigo(true)}
        </form>
      </Modal>

      {/* ── Códigos nuevos: un código de la app ── */}
      <Modal
        open={dialogo === 'regenerar'}
        onClose={cerrar}
        dismissible={!enviando}
        size="sm"
        title={t('twofa.regenerate.title')}
        footer={
          <>
            <Button variant="ghost" onClick={cerrar} disabled={enviando}>{t('common.cancel')}</Button>
            <Button type="submit" form="form-2fa-regenerar" loading={enviando}>{t('twofa.regenerate.confirm')}</Button>
          </>
        }
      >
        <form id="form-2fa-regenerar" onSubmit={regenerar} className="space-y-4" noValidate>
          <p className="text-sm text-gray-300">{t('twofa.regenerate.body')}</p>
          {error && <Alerta>{error}</Alerta>}
          {campoCodigo(false)}
        </form>
      </Modal>

      {codigosNuevos && (
        <CodigosRecuperacion codigos={codigosNuevos} correo={correo} onListo={() => setCodigosNuevos(null)} />
      )}
    </section>
  );
}

/**
 * Los códigos de recuperación, una sola vez. No se puede cerrar sin confirmar que se guardaron: es la única copia en claro
 * que existirá (el servidor guarda solo su huella).
 */
function CodigosRecuperacion({ codigos, correo, onListo }: { codigos: string[]; correo: string; onListo: () => void }) {
  const { t } = useTranslation();
  const [guardados, setGuardados] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const texto = textoCodigosRecuperacion(codigos, correo, t);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(codigos.join('\n'));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* sin permiso de portapapeles: se pueden descargar o copiar a mano */ }
  };

  const descargar = () => {
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'codigos-recuperacion-securegate.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      open
      onClose={onListo}
      dismissible={guardados}
      title={t('twofa.recovery.title')}
      footer={<Button onClick={onListo} disabled={!guardados}>{t('twofa.recovery.done')}</Button>}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-300">{t('twofa.recovery.body')}</p>
        <ul data-testid="codigos-recuperacion" className="grid grid-cols-2 gap-2 rounded-lg border border-gray-600 bg-gray-800 p-3">
          {codigos.map(c => (
            <li key={c} className="select-all text-center font-mono text-sm tracking-wider text-gray-100">{c}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => void copiar()}>{copiado ? t('twofa.copied') : t('twofa.recovery.copy')}</Button>
          <Button size="sm" variant="secondary" onClick={descargar}>{t('twofa.recovery.download')}</Button>
        </div>
        <label className="flex items-start gap-2 text-sm text-gray-200">
          <input
            type="checkbox"
            checked={guardados}
            onChange={e => setGuardados(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
          />
          <span>{t('twofa.recovery.saved')}</span>
        </label>
      </div>
    </Modal>
  );
}
