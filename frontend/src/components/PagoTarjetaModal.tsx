import { useMemo, useState } from 'react';
import { pagarConTarjeta, PagoRechazadoError, type Pago } from '../services/api';
import { Button, Input, Modal, cx } from './ui';
import { useTranslation } from '../i18n/useTranslation';
import {
  cvvEsperado, detectarMarca, formatearNumero, formatearVencimiento, soloDigitos, validarTarjeta,
  type DatosTarjeta, type ErroresTarjeta,
} from '../utils/tarjeta';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Saldo pendiente, que precarga el monto a cobrar. */
  saldo: number;
  /**
   * ¿La pasarela es la de prueba? Solo entonces se muestran los avisos de «pago simulado».
   * El residente de un entorno real jamás debe ver textos de implementación.
   */
  simulada?: boolean;
  /** Se llama con el pago APROBADO, ya guardado, para refrescar saldo e historial. */
  onResultado: (pago: Pago) => void;
}

const EMPTY: DatosTarjeta = { numero: '', titular: '', vencimiento: '', cvv: '' };

const MARCA_LABEL: Record<string, string> = {
  visa: 'VISA', mastercard: 'Mastercard', amex: 'Amex', desconocida: '',
};

const ICON_LOCK = 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4';

/**
 * Formulario de pago con tarjeta.
 *
 * PASARELA SIMULADA — no hay integración con Visanet todavía. El número, el CVV
 * y el vencimiento se validan aquí (formato + Luhn) y nunca salen del
 * navegador: al backend sólo viajan el monto y los últimos 4 dígitos, que es lo
 * que queda registrado en el historial. Los avisos de «pago simulado» dependen de
 * la prop `simulada` (que viene del servidor); cuando entre la integración real
 * desaparecen solos. Una tarjeta rechazada NO es un pago: el servidor responde 402
 * y no lo guarda, así que aquí solo se muestra el motivo.
 */
export default function PagoTarjetaModal({ open, onClose, saldo, simulada = false, onResultado }: Props) {
  const { t } = useTranslation();
  const [datos, setDatos]     = useState<DatosTarjeta>(EMPTY);
  const [monto, setMonto]     = useState(saldo > 0 ? saldo.toFixed(2) : '');
  const [errores, setErrores] = useState<ErroresTarjeta>({});
  const [enviado, setEnviado] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [rechazo, setRechazo] = useState<string | null>(null);

  const marca = useMemo(() => detectarMarca(datos.numero), [datos.numero]);

  // Regla del servidor (T1): un pago resta su monto del saldo; uno mayor al saldo se rechaza (422). Se bloquea
  // aquí para no enviar un cobro que el servidor va a rechazar; un monto menor es un pago parcial válido.
  const importeActual = parseFloat(monto);
  const supera = Number.isFinite(importeActual) && importeActual > 0 && importeActual > saldo + 0.004;
  const sinSaldo = saldo <= 0 && Number.isFinite(importeActual) && importeActual > 0;
  const parcial = !supera && !sinSaldo && Number.isFinite(importeActual) && importeActual > 0 && importeActual < saldo - 0.004;

  const cerrar = () => {
    setDatos(EMPTY);
    setErrores({});
    setEnviado(false);
    setRechazo(null);
    onClose();
  };

  const setCampo = (campo: keyof DatosTarjeta, valor: string) => {
    setDatos(prev => ({ ...prev, [campo]: valor }));
    // Tras el primer intento los errores se recalculan en vivo, para que el
    // usuario vea desaparecer el aviso mientras corrige.
    if (enviado) setErrores(validarTarjeta({ ...datos, [campo]: valor }, parseFloat(monto)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviado(true);
    setRechazo(null);

    const importe = parseFloat(monto);
    if (supera || sinSaldo) return;
    const encontrados = validarTarjeta(datos, importe);
    setErrores(encontrados);
    if (Object.keys(encontrados).length > 0) return;

    setProcesando(true);
    try {
      const pago = await pagarConTarjeta({
        monto: importe,
        ultimos4: soloDigitos(datos.numero).slice(-4),
        titular: datos.titular.trim(),
      });
      onResultado(pago);
      cerrar();
    } catch (err: unknown) {
      setRechazo(err instanceof PagoRechazadoError ? t('card.declined') : err instanceof Error ? err.message : t('common.error'));
    } finally {
      setProcesando(false);
    }
  };

  const err = (campo: keyof ErroresTarjeta) => (errores[campo] ? t(errores[campo]!) : null);

  return (
    <Modal
      open={open}
      onClose={cerrar}
      title={t('card.title')}
      description={simulada ? t('card.subtitle') : t('card.subtitleLive')}
      dismissible={!procesando}
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {simulada && (
          <p className="flex items-start gap-2 rounded-lg border border-warning-500/30 bg-warning-500/10 px-3 py-2.5 text-xs text-warning-400">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-0.5 shrink-0" aria-hidden="true">
              <path d="M12 9v4M12 17h.01M12 3a9 9 0 100 18 9 9 0 000-18z" />
            </svg>
            {t('card.mockNotice')}
          </p>
        )}

        {rechazo && (
          <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2.5 text-sm font-medium text-danger-400">
            {rechazo}
          </p>
        )}

        <Input
          name="numero"
          label={t('card.number')}
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="4111 1111 1111 1111"
          value={datos.numero}
          error={err('numero')}
          onChange={e => setCampo('numero', formatearNumero(e.target.value))}
          suffix={MARCA_LABEL[marca] ? <span className="text-2xs font-bold uppercase tracking-wider">{MARCA_LABEL[marca]}</span> : undefined}
          className="font-mono tracking-wider"
        />

        <Input
          name="titular"
          label={t('card.holder')}
          autoComplete="cc-name"
          placeholder={t('card.holderPlaceholder')}
          value={datos.titular}
          error={err('titular')}
          onChange={e => setCampo('titular', e.target.value.toUpperCase())}
          className="uppercase"
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            name="vencimiento"
            label={t('card.expiry')}
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM/AA"
            value={datos.vencimiento}
            error={err('vencimiento')}
            onChange={e => setCampo('vencimiento', formatearVencimiento(e.target.value))}
            className="font-mono"
          />
          <Input
            name="cvv"
            label={t('card.cvv')}
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder={'•'.repeat(cvvEsperado(datos.numero))}
            maxLength={cvvEsperado(datos.numero)}
            value={datos.cvv}
            error={err('cvv')}
            onChange={e => setCampo('cvv', soloDigitos(e.target.value).slice(0, cvvEsperado(datos.numero)))}
            className="font-mono"
          />
        </div>

        <Input
          name="monto"
          label={t('card.amount')}
          type="number"
          min="0.01"
          step="0.01"
          value={monto}
          error={err('monto')}
          onChange={e => { setMonto(e.target.value); if (enviado) setErrores(validarTarjeta(datos, parseFloat(e.target.value))); }}
          suffix="Q"
        />

        {parcial && <p className="text-xs text-gray-400">{t('card.partialHint')}</p>}

        {(supera || sinSaldo) && (
          <div role="status" className="space-y-2 rounded-lg border border-warning-500/30 bg-warning-500/10 px-3 py-2.5 text-xs text-warning-400">
            <p className="font-medium">
              {sinSaldo
                ? t('card.noBalance')
                : t('card.amountExceeds')
                    .replace('{monto}', importeActual.toFixed(2))
                    .replace('{saldo}', saldo.toFixed(2))}
            </p>
            {!sinSaldo && (
              <button
                type="button"
                onClick={() => { setMonto(saldo.toFixed(2)); if (enviado) setErrores(validarTarjeta(datos, saldo)); }}
                className="font-semibold underline underline-offset-4 hover:text-warning-300"
              >
                {t('card.useBalance').replace('{saldo}', saldo.toFixed(2))}
              </button>
            )}
          </div>
        )}

        <div className={cx('flex flex-wrap justify-end gap-3 pt-2')}>
          <Button variant="ghost" onClick={cerrar} disabled={procesando}>{t('common.cancel')}</Button>
          <Button
            type="submit"
            loading={procesando}
            disabled={supera || sinSaldo}
            icon={
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={ICON_LOCK} />
              </svg>
            }
          >
            {procesando ? t('card.paying') : t('card.pay')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
