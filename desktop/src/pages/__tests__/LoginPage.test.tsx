import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoginPage } from '../LoginPage';
import type { EstadoApp } from '../../lib/tauri';

vi.mock('../../lib/tauri', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/tauri')>()),
  api: { sesion: { login: vi.fn() } },
}));

const estado = (sesion: Partial<EstadoApp['sesion']>): EstadoApp => ({
  licencia: { sucursal_nombre: 'Garita norte' },
  sesion: { usuario: null, requiere_login: false, iniciada_en: null, ...sesion },
  sync: { en_linea: true },
  version: '0.1.0',
} as unknown as EstadoApp);

describe('LoginPage — sesión cortada', () => {
  it('si la empresa se suspendió con el turno abierto (423), dice por qué con las palabras del servidor', () => {
    render(<LoginPage onLogin={vi.fn()} estado={estado({
      requiere_login: true,
      motivo_bloqueo: 'Las operaciones de Condominio X están suspendidas: Falta de pago. Contacta al administrador de SecureGate.',
    })} />);
    expect(screen.getByText(/Condominio X están suspendidas: Falta de pago/)).toBeInTheDocument();
    expect(screen.getByText(/La garita puede seguir registrando entradas/)).toBeInTheDocument();
    expect(screen.queryByText(/Tu sesión anterior venció/)).not.toBeInTheDocument();
  });

  it('sin motivo de bloqueo, el aviso sigue siendo «tu sesión venció»', () => {
    render(<LoginPage onLogin={vi.fn()} estado={estado({ requiere_login: true })} />);
    expect(screen.getByText(/Tu sesión anterior venció/)).toBeInTheDocument();
  });

  it('con la sesión en regla no muestra ningún aviso', () => {
    render(<LoginPage onLogin={vi.fn()} estado={estado({})} />);
    expect(screen.queryByText(/venció|suspendidas/)).not.toBeInTheDocument();
  });
});
