/**
 * Segundo paso del inicio de sesión (SCRUM-123): la contraseña ya fue correcta y la cuenta tiene la verificación en dos
 * pasos, así que se pide el código de seis dígitos de la app de autenticación —o uno de los códigos de recuperación— para
 * canjear el desafío por la sesión.
 */
import { useState, type FormEvent } from 'react';
import {
  DosPasosError, EmpresaBloqueadaError, verificarDosPasos,
  type BloqueoEmpresa, type LoginResult,
} from '../services/api';
import { Button, Input } from './ui';
import { useTranslation } from '../i18n/useTranslation';
import { mensajeDosPasos } from '../utils/dosPasos';

interface Props {
  desafio: string;
  /** La sesión ya existe: el padre la completa igual que un inicio de sesión normal. */
  onVerificado: (resultado: LoginResult) => void | Promise<void>;
  /** El desafío venció (5 minutos) o ya no sirve: hay que volver a escribir correo y contraseña. */
  onVencido: (mensaje: string) => void;
  /** La empresa se suspendió mientras tanto. */
  onBloqueo: (bloqueo: BloqueoEmpresa) => void;
  onVolver: () => void;
}

const ICON_KEY = 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4';

export default function VerificacionDosPasos({ desafio, onVerificado, onVencido, onBloqueo, onVolver }: Props) {
  const { t } = useTranslation();
  const [codigo, setCodigo] = useState('');
  const [conRecuperacion, setConRecuperacion] = useState(false);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cambiarModo = () => { setConRecuperacion(v => !v); setCodigo(''); setError(''); };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!codigo.trim()) { setError(t('twofa.err.codeRequired')); return; }
    setError('');
    setEnviando(true);
    try {
      const resultado = await verificarDosPasos(desafio, codigo.trim());
      await onVerificado(resultado);
    } catch (err) {
      if (err instanceof EmpresaBloqueadaError) {
        onBloqueo(err.bloqueo);
      } else if (err instanceof DosPasosError && err.codigo === 'DESAFIO_INVALIDO') {
        onVencido(mensajeDosPasos(err, t));
      } else {
        setError(mensajeDosPasos(err, t));
        setCodigo('');
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      <div>
        <h2 className="text-lg font-semibold text-gray-50">{t('twofa.login.title')}</h2>
        <p className="mt-1 text-sm text-gray-400">{conRecuperacion ? t('twofa.login.recoveryBody') : t('twofa.login.body')}</p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">
          {error}
        </p>
      )}

      <Input
        key={conRecuperacion ? 'recuperacion' : 'app'}
        label={conRecuperacion ? t('twofa.recoveryCode') : t('twofa.code')}
        icon={ICON_KEY}
        value={codigo}
        onChange={e => setCodigo(e.target.value)}
        autoFocus
        autoComplete="one-time-code"
        inputMode={conRecuperacion ? 'text' : 'numeric'}
        maxLength={conRecuperacion ? 16 : 7}
        placeholder={conRecuperacion ? 'XXXXX-XXXXX' : '123456'}
        spellCheck={false}
        className="font-mono tracking-widest"
      />

      <Button type="submit" size="lg" fullWidth loading={enviando}>
        {enviando ? t('twofa.login.submitting') : t('twofa.login.submit')}
      </Button>

      <div className="flex flex-col items-center gap-2 pt-1 text-xs">
        <button
          type="button"
          onClick={cambiarModo}
          className="font-semibold text-gray-200 underline-offset-4 transition-colors hover:text-gray-50 hover:underline"
        >
          {conRecuperacion ? t('twofa.login.useApp') : t('twofa.login.useRecovery')}
        </button>
        <button
          type="button"
          onClick={onVolver}
          className="text-gray-400 underline-offset-4 transition-colors hover:text-gray-200 hover:underline"
        >
          {t('twofa.login.back')}
        </button>
      </div>
    </form>
  );
}
