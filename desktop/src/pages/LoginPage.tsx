/**
 * Login del agente (la persona). Usa POST /api/auth/login del backend a
 * través de Rust; el JWT nunca llega a esta capa.
 */
import { useState, type FormEvent } from 'react';
import { AuthShell } from '../components/auth/AuthShell';
import { Alert } from '../components/shared/Alert';
import { Button, Input } from '../components/ui';
import { api, mensajeDe, type EstadoApp } from '../lib/tauri';

const ICON_MAIL = 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6';
const ICON_LOCK = 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4';

export function LoginPage({ estado, onLogin }: { estado: EstadoApp; onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      await api.sesion.login(email, password);
      onLogin();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setCargando(false);
    }
  };

  return (
    <AuthShell
      titulo="Iniciar turno"
      rotulo={estado.licencia.sucursal_nombre ?? 'Garita'}
      subtitulo="Ingresa con tu cuenta de agente"
      enLinea={estado.sync.en_linea}
      pie={<>Equipo activado · v{estado.version}</>}
    >
      {estado.sesion.requiere_login && (
        <Alert tone="warn" className="mb-5">Tu sesión anterior venció. Vuelve a iniciar sesión para seguir sincronizando.</Alert>
      )}
      {!estado.sync.en_linea && (
        <Alert tone="info" className="mb-5">Iniciar sesión requiere conexión con el servidor. La licencia del equipo sigue activa.</Alert>
      )}

      <form onSubmit={submit} className="space-y-4">
        <Input
          type="email"
          label="Correo"
          icon={ICON_MAIL}
          autoFocus
          autoComplete="username"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="agente@condominio.com"
        />
        <Input
          type="password"
          label="Contraseña"
          icon={ICON_LOCK}
          autoComplete="current-password"
          required
          minLength={6}
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
        />

        {error && <Alert tone="bad">{error}</Alert>}

        <Button type="submit" size="lg" fullWidth loading={cargando} className="mt-2">
          {cargando ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </AuthShell>
  );
}
