import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from '../pages/LoginPage';
import { login } from '../services/api';

vi.mock('../services/api', () => ({
  login: vi.fn(),
}));

const mockLogin = login as unknown as ReturnType<typeof vi.fn>;

describe('LoginPage', () => {
  beforeEach(() => {
    mockLogin.mockReset();
    localStorage.clear();
  });

  it('renderiza el formulario con inputs de email y password', () => {
    const { container } = render(<LoginPage onLogin={vi.fn()} />);

    expect(screen.getByPlaceholderText('usuario@ejemplo.com')).toBeInTheDocument();
    expect(container.querySelector('input[type="password"]')).toBeInTheDocument();
  });

  it('login exitoso: onLogin es llamada con el token recibido', async () => {
    mockLogin.mockResolvedValue({
      token: 'tok-abc123',
      usuario: { id: 'u1', nombre: 'Test', email: 'test@test.com', rol: 'admin' },
    });
    const onLogin = vi.fn();
    const { container } = render(<LoginPage onLogin={onLogin} />);

    fireEvent.change(screen.getByPlaceholderText('usuario@ejemplo.com'), { target: { value: 'test@test.com' } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('tok-abc123', 'admin', expect.objectContaining({ id: 'u1' }));
    });
    expect(mockLogin).toHaveBeenCalledWith('test@test.com', 'secret123');
  });

  it('login fallido: muestra el mensaje de error "Credenciales inválidas"', async () => {
    mockLogin.mockRejectedValue(new Error('Credenciales inválidas'));
    const onLogin = vi.fn();
    const { container } = render(<LoginPage onLogin={onLogin} />);

    fireEvent.change(screen.getByPlaceholderText('usuario@ejemplo.com'), { target: { value: 'test@test.com' } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByText('Credenciales inválidas')).toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();
  });
});
