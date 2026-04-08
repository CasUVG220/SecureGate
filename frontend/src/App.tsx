import { useState } from 'react';
import GaritaPage from './pages/GaritaPage';
import ResidentesPage from './pages/ResidentesPage';
import { decodeTokenPayload } from './services/api';

type Page = 'garita' | 'residentes';

function App() {
  return <GaritaPage />;
  const [page, setPage] = useState<Page>('garita');

  const token = localStorage.getItem('token');
  const payload = token ? decodeTokenPayload(token) : null;
  const isAdmin = payload?.rol === 'admin';

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Top nav */}
      <nav className="bg-gray-950 border-b border-gray-800 px-6 py-2 flex gap-4">
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
      </nav>

      {page === 'garita' ? <GaritaPage /> : <ResidentesPage />}
    </div>
  );
}

export default App;