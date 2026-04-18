import { useState } from 'react';
import GaritaPage from './pages/GaritaPage';
import ResidentesPage from './pages/ResidentesPage';
import LoginPage from './pages/LoginPage';
import SalidaPage from './pages/SalidaPage';
import PagosPage from './pages/PagosPage';
import PreautPage from './pages/PreautPage';
import { decodeTokenPayload } from './services/api';

type Page = 'garita' | 'salida' | 'residentes' | 'pagos';
type Page = 'garita' | 'salida' | 'residentes' | 'pagos' | 'preaut';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('token'));
@@ -59,6 +60,7 @@
        {navBtn('Registrar Salida', 'salida')}
        {isAdmin && navBtn('Residentes', 'residentes')}
        {isAdmin && navBtn('Pagos', 'pagos')}
        {isAdmin && navBtn('Preautorizaciones', 'preaut')}
        <div className="ml-auto">
          <button
            onClick={handleLogout}
@@ -73,8 +75,9 @@
      {page === 'salida'     && <SalidaPage />}
      {page === 'residentes' && <ResidentesPage />}
      {page === 'pagos'      && <PagosPage />}
      {page === 'preaut'     && <PreautPage />}
    </div>
  );
}

export default App;