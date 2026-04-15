import { useState } from 'react';
import GaritaPage from './pages/GaritaPage';
import ResidentesPage from './pages/ResidentesPage';
import LoginPage from './pages/LoginPage';
import SalidaPage from './pages/SalidaPage';
import { decodeTokenPayload } from './services/api';

type Page = 'garita' | 'residentes';
type Page = 'garita' | 'salida' | 'residentes';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('token'));
@@ -38,31 +39,24 @@

  const isAdmin = userRol === 'admin';

  const navBtn = (label: string, target: Page) => (
    <button
      key={target}
      onClick={() => setPage(target)}
      className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
        page === target ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );

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
        {navBtn('Terminal Garita', 'garita')}
        {navBtn('Registrar Salida', 'salida')}
        {isAdmin && navBtn('Residentes', 'residentes')}
        <div className="ml-auto">
          <button
            onClick={handleLogout}
@@ -73,9 +67,11 @@
        </div>
      </nav>

      {page === 'garita' ? <GaritaPage /> : <ResidentesPage />}
      {page === 'garita' && <GaritaPage />}
      {page === 'salida' && <SalidaPage />}
      {page === 'residentes' && <ResidentesPage />}
    </div>
  );
}

export default App;