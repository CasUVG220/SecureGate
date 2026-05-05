import { useState } from 'react';
import GaritaPage from './pages/GaritaPage';
import ResidentesPage from './pages/ResidentesPage';
import LoginPage from './pages/LoginPage';
import SalidaPage from './pages/SalidaPage';
import PagosPage from './pages/PagosPage';
import PreautPage from './pages/PreautPage';
import DashboardPage from './pages/DashboardPage';
import ResidentePage from './pages/ResidentePage';
import ReportesPage from './pages/ReportesPage';
import { decodeTokenPayload } from './services/api';

type AdminPage = 'dashboard' | 'residentes' | 'pagos' | 'preaut';
type AdminPage = 'dashboard' | 'residentes' | 'pagos' | 'preaut' | 'reportes';
type AgentePage = 'garita' | 'salida';
type Page = AdminPage | AgentePage;

const logoutBtn = (onClick: () => void) => (
  <button
    onClick={onClick}
    className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors px-3 py-1.5"
  >
    Cerrar sesión
  </button>
);

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('token'));
  const [userRol, setUserRol] = useState<string>(() => {
    const token = localStorage.getItem('token');
    if (!token) return '';
    const payload = decodeTokenPayload(token);
    return (payload?.rol as string) || '';
  });
  const [userNombre, setUserNombre] = useState<string>(() => {
    const token = localStorage.getItem('token');
    if (!token) return '';
    const payload = decodeTokenPayload(token);
    return (payload?.nombre as string) || '';
  });
  const [page, setPage] = useState<Page>(() =>
    userRol === 'admin' ? 'dashboard' : 'garita'
  );

  const handleLogin = (token: string, rol: string) => {
    localStorage.setItem('token', token);
    const payload = decodeTokenPayload(token);
    setUserNombre((payload?.nombre as string) || '');
    setUserRol(rol);
    setIsAuthenticated(true);
    setPage(rol === 'admin' ? 'dashboard' : 'garita');
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setIsAuthenticated(false);
    setUserRol('');
    setUserNombre('');
    setPage('garita');
  };

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  /* ── Residente: pantalla propia, sin nav de secciones ── */
  if (userRol === 'residente') {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-100">
        <header className="bg-gray-950 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
          <div>
            <span className="text-base font-bold tracking-tight">SecureGate</span>
            <span className="ml-2 text-xs text-gray-400">Mi Portal</span>
          </div>
          <div className="flex items-center gap-4">
            {userNombre && <span className="text-sm text-gray-300">{userNombre}</span>}
            {logoutBtn(handleLogout)}
          </div>
        </header>
        <ResidentePage />
      </div>
    );
  }

  const navBtn = (label: string, target: Page) => (
    <button
      key={target}
      onClick={() => setPage(target)}
      className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${page === target ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
        }`}
    >
      {label}
    </button>
  );

  /* ── Admin: solo páginas de administración ── */
  if (userRol === 'admin') {
    return (
      <div className="min-h-screen bg-gray-900">
        <nav className="bg-gray-950 border-b border-gray-800 px-6 py-2 flex gap-4 items-center">
          {navBtn('Dashboard', 'dashboard')}
          {navBtn('Residentes', 'residentes')}
          {navBtn('Pagos', 'pagos')}
          {navBtn('Preautorizaciones', 'preaut')}
          {navBtn('Reportes', 'reportes')}
          <div className="ml-auto">{logoutBtn(handleLogout)}</div>
        </nav>
        {page === 'dashboard' && <DashboardPage />}
        {page === 'residentes' && <ResidentesPage />}
        {page === 'pagos' && <PagosPage />}
        {page === 'preaut' && <PreautPage />}
        {page === 'reportes' && <ReportesPage />}
      </div>
    );
  }

  /* ── Agente: solo garita y salida ── */
  return (
    <div className="min-h-screen bg-gray-900">
      <nav className="bg-gray-950 border-b border-gray-800 px-6 py-2 flex gap-4 items-center">
        {navBtn('Terminal Garita', 'garita')}
        {navBtn('Registrar Salida', 'salida')}
        <div className="ml-auto">{logoutBtn(handleLogout)}</div>
      </nav>
      {page === 'garita' && <GaritaPage />}
      {page === 'salida' && <SalidaPage />}
    </div>
  );
}

export default App;