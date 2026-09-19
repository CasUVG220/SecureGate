/**
 * Marco de las pantallas sin sesión (activación, login): tarjeta centrada con
 * el mismo encabezado que el login de la web (frontend/src/pages/LoginPage),
 * más el toggle de tema y el estado de conexión en la esquina.
 */
import { ThemeToggle } from '../../context/ThemeContext';
import { LogoMark } from '../shared/Logo';
import { StatusText } from '../ui';

interface Props {
  titulo: string;
  /** Rótulo bajo el título: sucursal o nombre del producto. */
  rotulo: string;
  subtitulo?: string;
  enLinea?: boolean;
  children: React.ReactNode;
  /** Pie fuera de la tarjeta (huella, versión). */
  pie?: React.ReactNode;
}

export function AuthShell({ titulo, rotulo, subtitulo, enLinea, children, pie }: Props) {
  return (
    <div className="relative flex h-full items-center justify-center overflow-y-auto px-4 py-10">
      <div className="absolute right-4 top-4 flex items-center gap-3">
        {enLinea !== undefined && (
          <StatusText kind={enLinea ? 'on' : 'warn'}>{enLinea ? 'En línea' : 'Sin conexión'}</StatusText>
        )}
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md animate-sg-scale-in">
        <div className="sg-card p-6 sm:p-9">
          <div className="mb-8 text-center">
            <span className="mb-5 inline-flex"><LogoMark size="lg" /></span>
            <h1 className="text-3xl font-bold tracking-tight text-gray-50">{titulo}</h1>
            <p className="mt-2 text-sm font-semibold text-gray-300">{rotulo}</p>
            {subtitulo && <p className="mt-1 text-xs text-gray-400">{subtitulo}</p>}
          </div>
          {children}
        </div>
        {pie && <p className="mt-4 text-center text-xs text-gray-400">{pie}</p>}
      </div>
    </div>
  );
}
