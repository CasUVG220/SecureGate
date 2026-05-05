import { useState } from 'react';
import GaritaPage      from './pages/GaritaPage';
import ResidentesPage  from './pages/ResidentesPage';
import LoginPage       from './pages/LoginPage';
import SalidaPage      from './pages/SalidaPage';
import PagosPage       from './pages/PagosPage';
import PreautPage      from './pages/PreautPage';
import DashboardPage   from './pages/DashboardPage';
import ResidentePage   from './pages/ResidentePage';
import ReportesPage    from './pages/ReportesPage';
import ConfigCargosPage   from './pages/ConfigCargosPage';
import VerificacionPage   from './pages/VerificacionPage';
import NotFoundPage       from './pages/NotFoundPage';
import { ToastProvider } from './components/Toast';
import { decodeTokenPayload } from './services/api';

type Page =
  | 'dashboard' | 'residentes' | 'pagos' | 'preaut' | 'reportes' | 'config' | 'verificacion'
  | 'garita' | 'salida'
  | 'portal';

interface NavItem { key: Page; label: string; d: string; }

function SideIcon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className="flex-shrink-0">
      <path d={d} />
    </svg>
  );
}

const ADMIN_NAV: NavItem[] = [
  { key: 'dashboard',  label: 'Dashboard',        d: 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z' },
  { key: 'residentes', label: 'Residentes',        d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  { key: 'pagos',      label: 'Pagos',             d: 'M1 4h22v16H1zM1 10h22' },
  { key: 'preaut',     label: 'Preautorizaciones', d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
  { key: 'reportes',   label: 'Reportes',          d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8' },
  { key: 'config',        label: 'Configuración',      d: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' },
  { key: 'verificacion', label: 'Verificación Pagos', d: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
];

const AGENTE_NAV: NavItem[] = [
  { key: 'garita', label: 'Terminal Garita',  d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10' },
  { key: 'salida', label: 'Registrar Salida', d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9' },
];

const RESIDENTE_NAV: NavItem[] = [
  { key: 'portal', label: 'Mi Portal', d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10' },
];

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('token'));
  const [userRol, setUserRol] = useState<string>(() => {
    const token = localStorage.getItem('token');
    if (!token) return '';
    return (decodeTokenPayload(token)?.rol as string) || '';
  });
  const [userNombre, setUserNombre] = useState<string>(() => {
    const token = localStorage.getItem('token');
    if (!token) return '';
    return (decodeTokenPayload(token)?.nombre as string) || '';
  });
  const [page, setPage] = useState<Page>(() => {
    const token = localStorage.getItem('token');
    if (!token) return 'garita';
    const rol = (decodeTokenPayload(token)?.rol as string) || '';
    return rol === 'admin' ? 'dashboard' : rol === 'residente' ? 'portal' : 'garita';
  });

  const handleLogin = (token: string, rol: string) => {
    localStorage.setItem('token', token);
    const payload = decodeTokenPayload(token);
    setUserNombre((payload?.nombre as string) || '');
    setUserRol(rol);
    setIsAuthenticated(true);
    setPage(rol === 'admin' ? 'dashboard' : rol === 'residente' ? 'portal' : 'garita');
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setIsAuthenticated(false);
    setUserRol('');
    setUserNombre('');
    setPage('garita');
  };

  const navigate = (p: string) => setPage(p as Page);

  const defaultPage: Page =
    userRol === 'admin' ? 'dashboard' : userRol === 'residente' ? 'portal' : 'garita';

  const renderPage = () => {
    switch (page) {
      case 'dashboard':  return <DashboardPage />;
      case 'residentes': return <ResidentesPage />;
      case 'pagos':      return <PagosPage />;
      case 'preaut':     return <PreautPage />;
      case 'reportes':   return <ReportesPage />;
      case 'config':        return <ConfigCargosPage />;
      case 'verificacion': return <VerificacionPage />;
      case 'garita':     return <GaritaPage />;
      case 'salida':     return <SalidaPage />;
      case 'portal':     return <ResidentePage />;
      default:           return <NotFoundPage onNavigate={navigate} defaultPage={defaultPage} />;
    }
  };

  if (!isAuthenticated) {
    return (
      <ToastProvider>
        <LoginPage onLogin={handleLogin} />
      </ToastProvider>
    );
  }

  const navItems =
    userRol === 'admin'     ? ADMIN_NAV :
    userRol === 'residente' ? RESIDENTE_NAV :
    AGENTE_NAV;

  return (
    <ToastProvider>
      <div className="flex flex-col h-screen overflow-hidden bg-gray-900">

        {/* ── Top header ── */}
        <header className="h-14 bg-gray-950 border-b border-gray-800 flex items-center justify-between px-5 flex-shrink-0">
          <span className="text-white font-bold tracking-tight">SecureGate</span>
          <div className="flex items-center gap-4">
            {userNombre && (
              <span className="text-sm text-gray-400 hidden sm:block truncate max-w-[160px]">
                {userNombre}
              </span>
            )}
            <button
              onClick={handleLogout}
              className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
            >
              Cerrar sesión
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">

          {/* ── Sidebar ── */}
          <aside className="w-14 md:w-60 flex-shrink-0 bg-gray-950 border-r border-gray-800 flex flex-col py-3 gap-0.5 overflow-y-auto">
            {navItems.map(item => (
              <button
                key={item.key}
                onClick={() => setPage(item.key)}
                title={item.label}
                className={`flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  page === item.key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
              >
                <SideIcon d={item.d} />
                <span className="hidden md:block truncate">{item.label}</span>
              </button>
            ))}
          </aside>

          {/* ── Page content ── */}
          <main className="flex-1 overflow-y-auto bg-gray-900">
            {renderPage()}
          </main>

        </div>
      </div>
    </ToastProvider>
  );
}

export default App;
