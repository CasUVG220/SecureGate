/** Chip del logo, con las mismas clases que el header y el login de la web. */
const ICON_SHIELD = 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z';

export function LogoMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-14 w-14 rounded-2xl' : 'h-9 w-9 rounded-lg';
  const icon = size === 'lg' ? 28 : 18;
  return (
    <span className={`flex shrink-0 items-center justify-center bg-logo text-logo-ink ${box}`} aria-hidden="true">
      <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={size === 'lg' ? 2 : 2.5} strokeLinecap="round" strokeLinejoin="round">
        <path d={ICON_SHIELD} />
      </svg>
    </span>
  );
}
