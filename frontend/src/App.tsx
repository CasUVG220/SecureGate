import { useState } from 'react';
import GaritaPage from './pages/GaritaPage';
import ResidentesPage from './pages/ResidentesPage';
import LoginPage from './pages/LoginPage';
import { decodeTokenPayload } from './services/api';

type Page = 'garita' | 'residentes';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('token'));
  const [userRol, setUserRol] = useState<string>(() => {
    const token = localStorage.getItem('token');
    if (!token) return '';
    const payload = decodeTokenPayload(token);
    return (payload?.rol as string) || '';
  });
  const [page, setPage] = useState<Page>(() =>
    userRol === 'admin' ? 'residentes' : 'garita'
  );

  const handleLogin = (token: string, rol: string) => {
    localStorage.setItem('token', token);
    setUserRol(rol);
    setIsAuthenticated(true);
    setPage(rol === 'admin' ? 'residentes' : 'garita');
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setIsAuthenticated(false);
    setUserRol('');
    setPage('garita');
  };

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const isAdmin = userRol === 'admin';

  return (
    <div className="min-h-screen bg-gray-900">
      <nav className="bg-gray-950 border-b border-gray-800 px-6 py-2 flex gap-4 items-center">
        <button
          onClick={() => setPage('garita')}
          className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
            page === 'garita'
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Terminal Garita
        </button>
        {isAdmin && (
          <button
            onClick={() => setPage('residentes')}
            className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
              page === 'residentes'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Residentes
          </button>
        )}
        <div className="ml-auto">
          <button
            onClick={handleLogout}
            className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors px-3 py-1.5"
          >
            Cerrar sesión
          </button>
        </div>
      </nav>

      {page === 'garita' ? <GaritaPage /> : <ResidentesPage />}
    </div>
  );
}

export default App;