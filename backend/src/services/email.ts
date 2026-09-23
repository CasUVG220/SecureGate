/**
 * Envío de correo.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ PENDIENTE PARA PRODUCCIÓN: no hay proveedor de email integrado.       │
 * │ Hoy el único transporte es `log`, que imprime el mensaje (y el enlace │
 * │ de invitación) en la consola del backend. Antes de producción hay que │
 * │ conectar uno real: SMTP (nodemailer), SendGrid, Amazon SES, Resend…   │
 * │ Sólo hay que implementar `enviar` en un transporte nuevo y elegirlo   │
 * │ con EMAIL_TRANSPORT; nada más del código cambia.                      │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Variables:
 *   EMAIL_TRANSPORT  log (default) | … (futuro: smtp, sendgrid, ses)
 *   EMAIL_FROM       remitente, p. ej. "SecureGate <no-reply@securegate.gt>"
 *   APP_URL          URL pública del frontend, base de los enlaces de los
 *                    correos (default: primer ALLOWED_ORIGINS, o
 *                    http://localhost:5173 en desarrollo).
 */

export interface Mensaje {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Transporte {
  nombre: string;
  enviar(m: Mensaje): Promise<void>;
}

const transporteLog: Transporte = {
  nombre: 'log',
  async enviar(m) {
    // En desarrollo se imprime el texto completo: es la única forma de llegar al
    // enlace de la invitación. En producción el enlace es una credencial de un
    // solo uso y NO debe quedar en los logs (los lee cualquiera con acceso a
    // Cloud Logging): sólo se registra el destinatario y el asunto.
    if (process.env.NODE_ENV === 'production') {
      console.warn(`[email:log] (sin proveedor de correo) Para: ${m.to} — Asunto: ${m.subject}. Contenido omitido en producción.`);
      return;
    }
    console.info(`[email:log] Para: ${m.to}\n[email:log] Asunto: ${m.subject}\n${m.text.split('\n').map(l => `[email:log] ${l}`).join('\n')}`);
  },
};

function resolverTransporte(): Transporte {
  const nombre = (process.env.EMAIL_TRANSPORT || 'log').toLowerCase();
  if (nombre === 'log') return transporteLog;
  // Un transporte no implementado no debe romper el arranque ni una
  // invitación: se avisa fuerte y se cae al log.
  console.warn(`[email] EMAIL_TRANSPORT=${nombre} no está implementado; usando 'log'.`);
  return transporteLog;
}

let transporte: Transporte | null = null;

export const emailConfigurado = (): boolean => resolverTransporte().nombre !== 'log';

export const enviarEmail = async (m: Mensaje): Promise<void> => {
  transporte ??= resolverTransporte();
  await transporte.enviar({ ...m, to: m.to.trim() });
};

/** Base pública de la app para armar enlaces en los correos. */
export const appUrl = (): string => {
  const explicita = process.env.APP_URL?.trim();
  if (explicita) return explicita.replace(/\/+$/, '');
  const origen = process.env.ALLOWED_ORIGINS?.split(',')[0]?.trim();
  if (origen) return origen.replace(/\/+$/, '');
  return 'http://localhost:5173';
};

/** Sólo para tests: fuerza un transporte concreto. */
export const _usarTransporte = (t: Transporte | null): void => { transporte = t; };
