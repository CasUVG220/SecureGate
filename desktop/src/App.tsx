/**
 * Enrutado por estado, sin router: la pantalla la decide el estado que
 * reporta Rust (licencia → sesión → garita).
 */
import { useEstadoApp } from './hooks/useEstadoApp';
import { ActivacionPage } from './pages/ActivacionPage';
import { GaritaPage } from './pages/GaritaPage';
import { LoginPage } from './pages/LoginPage';
import { api } from './lib/tauri';
import { ErrorState, Spinner } from './components/ui';

export default function App() {
  const { estado, error, refrescar } = useEstadoApp();

  if (!estado) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        {error ? (
          <ErrorState
            variant="error"
            title="No se pudo leer el estado de la app"
            description="El proceso de la garita no respondió. Cierra y vuelve a abrir la aplicación."
            detail={error}
          />
        ) : (
          <Spinner size={28} />
        )}
      </div>
    );
  }

  const lic = estado.licencia.estado;
  if (lic === 'sin_licencia' || lic === 'bloqueada') {
    return <ActivacionPage estado={estado} onActivada={() => void refrescar()} />;
  }
  if (!estado.sesion.usuario) {
    return <LoginPage estado={estado} onLogin={() => void refrescar()} />;
  }
  return (
    <GaritaPage
      estado={estado}
      refrescar={refrescar}
      onLogout={() => { void api.sesion.logout().finally(() => void refrescar()); }}
    />
  );
}
