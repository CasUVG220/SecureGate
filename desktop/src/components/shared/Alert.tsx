/**
 * Aviso en línea (error de login, estado de OCR, lista negra…). No forma
 * parte del kit sincronizado desde la web —allí cada pantalla lo inlinea—
 * pero usa exactamente sus clases (ver el error de frontend LoginPage.tsx)
 * para que se lea como la misma familia.
 */
import { cx } from '../ui';

export type AlertTone = 'info' | 'ok' | 'warn' | 'bad';

const TONE: Record<AlertTone, string> = {
  info: 'border-gray-600 bg-gray-500/8 text-gray-200',
  ok:   'border-success-500/30 bg-success-500/10 text-success-400',
  warn: 'border-warning-500/30 bg-warning-500/10 text-warning-400',
  bad:  'border-danger-500/30 bg-danger-500/10 text-danger-400',
};

const ICON: Record<AlertTone, string> = {
  info: 'M12 16v-4M12 8h.01',
  ok:   'M9 12l2 2 4-4',
  warn: 'M12 8v4M12 16h.01',
  bad:  'M12 8v4M12 16h.01',
};

export function Alert({ tone, children, className }: { tone: AlertTone; children: React.ReactNode; className?: string }) {
  return (
    <p
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cx('flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm font-medium', TONE[tone], className)}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-0.5 shrink-0" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><path d={ICON[tone]} />
      </svg>
      <span className="min-w-0">{children}</span>
    </p>
  );
}
