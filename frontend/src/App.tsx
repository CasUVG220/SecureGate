import { useState, useEffect } from 'react';
import GaritaPage             from './pages/GaritaPage';
import ResidentesPage         from './pages/ResidentesPage';
import LoginPage              from './pages/LoginPage';
import SalidaPage             from './pages/SalidaPage';
import PagosPage              from './pages/PagosPage';
import PreautPage             from './pages/PreautPage';
import DashboardPage          from './pages/DashboardPage';
import ResidentePage          from './pages/ResidentePage';
import ReportesPage           from './pages/ReportesPage';
import ConfigCargosPage       from './pages/ConfigCargosPage';
import VerificacionPage       from './pages/VerificacionPage';
import AgentesPage            from './pages/AgentesPage';
import NotFoundPage           from './pages/NotFoundPage';
import OwnerDashboard         from './pages/owner/OwnerDashboard';
import EmpresaDetail          from './pages/owner/EmpresaDetail';
import OwnerEmpresas          from './pages/owner/OwnerEmpresas';
import AuditLogsPage          from './pages/owner/AuditLogsPage';
import AdminEmpresaDashboard  from './pages/admin_empresa/AdminEmpresaDashboard';
import GestionSucursales      from './pages/admin_empresa/GestionSucursales';
import BlacklistPage           from './pages/BlacklistPage';
import AnunciosPage            from './pages/AnunciosPage';
import TicketsPage             from './pages/TicketsPage';
import ReservasAdminPage      from './pages/ReservasAdminPage';
import ReservasPage           from './pages/ReservasPage';
import AnnouncementsBell       from './components/AnnouncementsBell';
import { ToastProvider }      from './components/Toast';
import { decodeTokenPayload, getTickets } from './services/api';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { LanguageProvider }   from './context/LanguageContext';
import { useTranslation }     from './i18n/useTranslation';
import { useLanguage }        from './context/LanguageContext';

type Page =
  | 'dashboard' | 'residentes' | 'pagos' | 'preaut' | 'reportes' | 'config' | 'verificacion' | 'agentes' | 'blacklist' | 'anuncios' | 'tickets' | 'reservas'
  | 'garita' | 'salida'
  | 'portal' | 'mis-reservas'
  | 'owner-dashboard' | 'owner-empresas' | 'owner-empresa-detail' | 'owner-audit'
  | 'ae-dashboard' | 'ae-sucursales';

interface NavItem { key: Page; labelKey: string; d: string; }

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
  { key: 'dashboard',    labelKey: 'nav.dashboard',    d: 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z' },
  { key: 'residentes',   labelKey: 'nav.residents',    d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  { key: 'agentes',      labelKey: 'nav.staff',        d: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
  { key: 'pagos',        labelKey: 'nav.payments',     d: 'M1 4h22v16H1zM1 10h22' },
  { key: 'preaut',       labelKey: 'nav.preauth',      d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
  { key: 'reportes',     labelKey: 'nav.reports',      d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8' },
  { key: 'config',       labelKey: 'nav.config',       d: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' },
  { key: 'verificacion', labelKey: 'nav.verification', d: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  { key: 'blacklist',    labelKey: 'nav.blacklist',    d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4' },
  { key: 'anuncios',     labelKey: 'nav.announcements', d: 'M3 11l18-5v12L3 14v-3zM11.6 16.8a3 3 0 11-5.8-1.6' },
  { key: 'tickets',      labelKey: 'nav.tickets',       d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  { key: 'reservas',     labelKey: 'nav.reservations',  d: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
];

const AGENTE_NAV: NavItem[] = [
  { key: 'garita', labelKey: 'nav.gate', d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10' },
  { key: 'salida', labelKey: 'nav.exit', d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9' },
];

const RESIDENTE_NAV: NavItem[] = [
  { key: 'portal',       labelKey: 'nav.portal',       d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10' },
  { key: 'mis-reservas', labelKey: 'nav.reservations', d: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
];

const OWNER_NAV: NavItem[] = [
  { key: 'owner-dashboard', labelKey: 'nav.ownerDashboard', d: 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z' },
  { key: 'owner-empresas',  labelKey: 'nav.companies',      d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10' },
  { key: 'owner-audit',     labelKey: 'nav.auditLogs',      d: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5h6M9 12h6M9 16h4' },
];

const ADMIN_EMPRESA_NAV: NavItem[] = [
  { key: 'ae-dashboard',  labelKey: 'nav.aeDashboard', d: 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z' },
  { key: 'ae-sucursales', labelKey: 'nav.aeBranches',  d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10' },
];

function resolveDefaultPage(rol: string): Page {
  if (rol === 'admin' || rol === 'admin_sucursal') return 'dashboard';
  if (rol === 'admin_empresa') return 'ae-dashboard';
  if (rol === 'residente') return 'portal';
  if (rol === 'owner') return 'owner-dashboard';
  return 'garita';
}

function AppShell() {
  const { theme, setTheme, toggle: toggleTheme } = useTheme();
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();

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
    return resolveDefaultPage(rol);
  });
  const [selectedEmpresaId, setSelectedEmpresaId] = useState<string | null>(null);
  const [ticketsUnread, setTicketsUnread] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Badge de tickets no leídos para el staff (se refresca al navegar)
  useEffect(() => {
    if (userRol !== 'admin' && userRol !== 'admin_sucursal') return;
    let cancel = false;
    getTickets()
      .then(rows => { if (!cancel) setTicketsUnread(rows.reduce((s, t) => s + Number(t.no_leidos || 0), 0)); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [userRol, page]);

  const handleLogin = (token: string, rol: string, usuario: Record<string, unknown>) => {
    localStorage.setItem('token', token);
    const payload = decodeTokenPayload(token);
    setUserNombre((payload?.nombre as string) || '');
    setUserRol(rol);
    setIsAuthenticated(true);
    setPage(resolveDefaultPage(rol));
    
    // Set preferences from backend
    if (usuario.tema === 'dark' || usuario.tema === 'light') setTheme(usuario.tema);
    if (usuario.idioma === 'es' || usuario.idioma === 'en') setLanguage(usuario.idioma);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setIsAuthenticated(false);
    setUserRol('');
    setUserNombre('');
    setSelectedEmpresaId(null);
    setPage('garita');
  };

  const navigate = (p: string) => {
    setPage(p as Page);
    setMobileNavOpen(false);
  };
  const defaultPage: Page = resolveDefaultPage(userRol);

  const goToEmpresaDetail = (id: string) => {
    setSelectedEmpresaId(id);
    setPage('owner-empresa-detail');
  };

  const renderPage = () => {
    switch (page) {
      case 'dashboard':    return <DashboardPage />;
      case 'residentes':   return <ResidentesPage />;
      case 'agentes':      return <AgentesPage />;
      case 'pagos':        return <PagosPage />;
      case 'preaut':       return <PreautPage />;
      case 'reportes':     return <ReportesPage />;
      case 'config':       return <ConfigCargosPage />;
      case 'verificacion': return <VerificacionPage />;
      case 'blacklist':    return <BlacklistPage />;
      case 'anuncios':     return <AnunciosPage />;
      case 'tickets':      return <TicketsPage />;
      case 'reservas':     return <ReservasAdminPage />;
      case 'mis-reservas': return <ReservasPage />;
      case 'garita':       return <GaritaPage />;
      case 'salida':       return <SalidaPage />;
      case 'portal':       return <ResidentePage />;
      case 'ae-dashboard':   return <AdminEmpresaDashboard />;
      case 'ae-sucursales':  return <GestionSucursales />;
      case 'owner-dashboard':
        return <OwnerDashboard onSelectEmpresa={goToEmpresaDetail} />;
      case 'owner-empresas':
        return <OwnerEmpresas />;
      case 'owner-audit':
        return <AuditLogsPage />;
      case 'owner-empresa-detail':
        return selectedEmpresaId
          ? <EmpresaDetail empresaId={selectedEmpresaId} onBack={() => setPage('owner-dashboard')} />
          : <OwnerDashboard onSelectEmpresa={goToEmpresaDetail} />;
      default:
        return <NotFoundPage onNavigate={navigate} defaultPage={defaultPage} />;
    }
  };

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const navItems =
    userRol === 'admin' || userRol === 'admin_sucursal'
      ? ADMIN_NAV
      : userRol === 'admin_empresa'
      ? ADMIN_EMPRESA_NAV
      : userRol === 'residente'
      ? RESIDENTE_NAV
      : userRol === 'owner'
      ? OWNER_NAV
      : AGENTE_NAV;

  const activeKey: Page =
    page === 'owner-empresa-detail' ? 'owner-dashboard' : page;

  return (
    <div className="flex min-h-screen flex-col overflow-hidden bg-dark-900">
      {/* ── Top header ── */}
      <header className="relative z-30 flex h-[4.25rem] flex-shrink-0 items-center justify-between border-b border-white/5 bg-dark-800/90 px-4 backdrop-blur-xl sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {navItems.length > 0 && (
            <button
              type="button"
              onClick={() => setMobileNavOpen(v => !v)}
              aria-label="Abrir navegación"
              aria-expanded={mobileNavOpen}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-gray-300 transition hover:bg-white/10 md:hidden"
            >
              <span className="sr-only">Menú</span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={mobileNavOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 6h16M4 12h16M4 18h16'} /></svg>
            </button>
          )}
          <span className="flex min-w-0 items-center gap-2 text-lg font-bold tracking-tight text-white sm:text-xl">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-purple-600 shadow-glow">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </span>
            <span className="truncate">SecureGate</span>
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Announcements bell — residente portal */}
          {userRol === 'residente' && <AnnouncementsBell />}
          {/* Language toggle */}
          <button
            onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
            aria-label="Toggle language"
            className="text-xs font-bold text-gray-400 hover:text-white transition-all duration-300 border border-white/10 rounded-md px-2.5 py-1 hover:border-white/30 bg-white/5"
          >
            {language === 'es' ? 'EN' : 'ES'}
          </button>
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="text-gray-400 hover:text-brand-400 transition-colors p-1.5 rounded-lg hover:bg-white/5"
          >
            {theme === 'dark' ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
          </button>
          {userNombre && (
            <span className="text-sm font-medium text-gray-300 hidden sm:block truncate max-w-[160px]">
              {userNombre}
            </span>
          )}
          <button
            onClick={handleLogout}
            className="rounded-xl px-2.5 py-2 text-xs font-bold text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300 sm:ml-2 sm:px-3 sm:py-1.5 sm:text-sm"
          >
            {t('common.logout')}
          </button>
        </div>
      </header>

      <div className="relative flex flex-1 overflow-hidden">
        {/* Abstract glowing background effect for the whole app */}
        <div className="absolute top-[-20%] left-[50%] w-[60%] h-[60%] bg-brand-600/5 rounded-full blur-[150px] pointer-events-none z-0"></div>

        {/* ── Sidebar ── */}
        {mobileNavOpen && (
          <button
            type="button"
            aria-label="Cerrar navegación"
            onClick={() => setMobileNavOpen(false)}
            className="sg-drawer-backdrop fixed inset-0 z-20 md:hidden"
          />
        )}
        <aside className={`${mobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} absolute inset-y-0 left-0 z-30 flex w-[min(82vw,18rem)] flex-shrink-0 flex-col gap-1 overflow-y-auto border-r border-white/5 bg-dark-800 py-5 shadow-2xl transition-transform duration-200 md:relative md:w-64 md:translate-x-0 md:bg-dark-800/50 md:py-4 md:shadow-none`}>
          {navItems.map(item => (
            <button
              key={item.key}
              onClick={() => { setPage(item.key); setMobileNavOpen(false); }}
              title={t(item.labelKey)}
              className={`flex items-center gap-3 mx-3 px-3.5 py-3 rounded-xl text-sm font-medium transition-all duration-300 group relative overflow-hidden ${
                activeKey === item.key
                  ? 'text-white shadow-glow'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-white/5'
              }`}
            >
              {activeKey === item.key && (
                <div className="absolute inset-0 bg-gradient-to-r from-brand-600/90 to-brand-500/80 -z-10"></div>
              )}
              <SideIcon d={item.d} />
              <span className="truncate">{t(item.labelKey)}</span>
              {item.key === 'tickets' && ticketsUnread > 0 && (
                <span className="ml-auto min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-[10px] font-bold leading-none">
                  {ticketsUnread > 9 ? '9+' : ticketsUnread}
                </span>
              )}
            </button>
          ))}
        </aside>

        {/* ── Page content ── */}
        <main className="relative z-10 flex-1 overflow-y-auto pb-20 md:pb-0">
          {renderPage()}
        </main>

        {userRol === 'residente' && (
          <nav className="absolute inset-x-0 bottom-0 z-20 grid grid-cols-2 border-t border-white/10 bg-dark-800/95 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-xl md:hidden" aria-label="Navegación principal">
            {navItems.map(item => (
              <button
                key={`mobile-${item.key}`}
                type="button"
                onClick={() => { setPage(item.key); setMobileNavOpen(false); }}
                className={`flex min-h-12 items-center justify-center gap-2 rounded-xl text-xs font-bold transition ${activeKey === item.key ? 'bg-emerald-500/15 text-emerald-300' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
              >
                <SideIcon d={item.d} />
                <span>{t(item.labelKey)}</span>
              </button>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <ToastProvider>
          <AppShellWithLang />
        </ToastProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

function AppShellWithLang() {
  return <AppShell />;
}

export default App;
