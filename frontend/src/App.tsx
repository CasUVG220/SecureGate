import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import ResidentesPage         from './pages/ResidentesPage';
import LoginPage              from './pages/LoginPage';
import PagosPage              from './pages/PagosPage';
import PreautPage             from './pages/PreautPage';
import DashboardPage          from './pages/DashboardPage';
import ResidentePage          from './pages/ResidentePage';
import ConfigCargosPage       from './pages/ConfigCargosPage';
import ConfiguracionQrPage    from './pages/ConfiguracionQrPage';
import VerificacionPage       from './pages/VerificacionPage';
import AgentesPage            from './pages/AgentesPage';
import LicenciasPage          from './pages/LicenciasPage';
import NotFoundPage           from './pages/NotFoundPage';
import AceptarInvitacionPage  from './pages/AceptarInvitacionPage';
import OwnerDashboard         from './pages/owner/OwnerDashboard';
import EmpresaDetail          from './pages/owner/EmpresaDetail';
import OwnerEmpresas          from './pages/owner/OwnerEmpresas';
import AuditLogsPage          from './pages/owner/AuditLogsPage';
import AdminEmpresaDashboard  from './pages/admin_empresa/AdminEmpresaDashboard';
import GestionSucursales      from './pages/admin_empresa/GestionSucursales';
import BlacklistPage          from './pages/BlacklistPage';
import AnunciosPage           from './pages/AnunciosPage';
import TicketsPage            from './pages/TicketsPage';
import ReservasAdminPage      from './pages/ReservasAdminPage';
import ReservasPage           from './pages/ReservasPage';
import AnnouncementsBell      from './components/AnnouncementsBell';
import MisAnunciosPage        from './pages/MisAnunciosPage';
import { ToastProvider }      from './components/ui/Toast';
import { cx }                 from './components/ui/cx';
import { decodeTokenPayload, getReservas, getTickets } from './services/api';
import { usePolling } from './hooks/usePolling';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { useTranslation }     from './i18n/useTranslation';
import { useRuta }            from './hooks/useRuta';
import { RUTA_PORTAL, portalDeRol, portalDeRuta, tokenDeInvitacion } from './routing/portales';
import type { PortalTab }     from './pages/ResidentePage';
import { Spinner }            from './components/ui/Skeleton';

// Carga diferida: los gráficos sólo los ve administración y no tienen por qué
// engordar el bundle inicial de residentes y del resto de pantallas.
const EstadisticasPage = lazy(() => import('./pages/EstadisticasPage'));

type Page =
  | 'dashboard' | 'residentes' | 'pagos' | 'preaut' | 'reportes' | 'config' | 'config-qr' | 'verificacion' | 'agentes' | 'garitas' | 'blacklist' | 'anuncios' | 'tickets' | 'reservas'
  | 'portal' | 'mis-reservas' | 'mis-anuncios'
  | 'owner-dashboard' | 'owner-empresas' | 'owner-empresa-detail' | 'owner-audit'
  | 'ae-dashboard' | 'ae-sucursales';

interface NavItem { key: Page; labelKey: string; d: string; }
interface NavGroup { labelKey: string; items: NavItem[]; }

const ICON = {
  dashboard:  'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',
  residents:  'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  staff:      'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  payments:   'M1 4h22v16H1zM1 10h22',
  shield:     'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  reports:    'M18 20V10M12 20V4M6 20v-6M3 20h18',
  config:     'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  verify:     'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  blacklist:  'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  announce:   'M3 11l18-5v12L3 14v-3zM11.6 16.8a3 3 0 11-5.8-1.6',
  tickets:    'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  calendar:   'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  home:       'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10',
  exit:       'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  gate:       'M2 4h20v12H2zM8 20h8M12 16v4',
  qr:         'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3z',
  audit:      'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5h6M9 12h6M9 16h4',
} as const;

/**
 * La navegación se agrupa por intención, no por orden de implementación: el
 * administrador entra a "Operación" cuando está resolviendo algo del día y a
 * "Gestión" cuando está manteniendo el padrón. Los separadores del sidebar
 * salen de estos grupos.
 */
const ADMIN_NAV: NavGroup[] = [
  { labelKey: 'nav.group.overview', items: [
    { key: 'dashboard', labelKey: 'nav.dashboard', d: ICON.dashboard },
  ]},
  { labelKey: 'nav.group.operation', items: [
    { key: 'preaut',       labelKey: 'nav.preauth',      d: ICON.shield },
    { key: 'verificacion', labelKey: 'nav.verification', d: ICON.verify },
    { key: 'blacklist',    labelKey: 'nav.blacklist',    d: ICON.blacklist },
  ]},
  { labelKey: 'nav.group.management', items: [
    { key: 'residentes', labelKey: 'nav.residents',    d: ICON.residents },
    { key: 'agentes',    labelKey: 'nav.staff',        d: ICON.staff },
    { key: 'garitas',    labelKey: 'nav.gates',        d: ICON.gate },
    { key: 'pagos',      labelKey: 'nav.payments',     d: ICON.payments },
    { key: 'reservas',   labelKey: 'nav.reservations', d: ICON.calendar },
    { key: 'config',     labelKey: 'nav.config',       d: ICON.config },
    { key: 'config-qr',  labelKey: 'nav.qrRules',      d: ICON.qr },
  ]},
  { labelKey: 'nav.group.communication', items: [
    { key: 'anuncios', labelKey: 'nav.announcements', d: ICON.announce },
    { key: 'tickets',  labelKey: 'nav.tickets',       d: ICON.tickets },
  ]},
  { labelKey: 'nav.group.analysis', items: [
    { key: 'reportes', labelKey: 'nav.reports', d: ICON.reports },
  ]},
];

/**
 * El rol agente ya no entra por la web: su terminal es la app de escritorio
 * (desktop/). GaritaPage y SalidaPage siguen en el árbol como referencia
 * (sin ruta) hasta que el equipo decida borrarlas; el login rechaza a ese
 * rol con un aviso (ver LoginPage) y una sesión suya ya guardada se descarta.
 */
const ROL_SOLO_ESCRITORIO = 'agente';

const RESIDENTE_NAV: NavGroup[] = [
  { labelKey: 'nav.group.portal', items: [
    { key: 'portal',       labelKey: 'nav.portal',       d: ICON.home },
    { key: 'mis-reservas', labelKey: 'nav.reservations', d: ICON.calendar },
    { key: 'mis-anuncios',  labelKey: 'nav.announcements', d: ICON.announce },
  ]},
];

const OWNER_NAV: NavGroup[] = [
  { labelKey: 'nav.group.global', items: [
    { key: 'owner-dashboard', labelKey: 'nav.ownerDashboard', d: ICON.dashboard },
    { key: 'owner-empresas',  labelKey: 'nav.companies',      d: ICON.home },
    { key: 'owner-audit',     labelKey: 'nav.auditLogs',      d: ICON.audit },
  ]},
];

const ADMIN_EMPRESA_NAV: NavGroup[] = [
  // «Administración global» es del owner; el administrador de empresa solo ve la suya.
  { labelKey: 'nav.group.company', items: [
    { key: 'ae-dashboard',  labelKey: 'nav.aeDashboard', d: ICON.dashboard },
    { key: 'ae-sucursales', labelKey: 'nav.aeBranches',  d: ICON.home },
    { key: 'garitas',       labelKey: 'nav.gates',       d: ICON.gate },
  ]},
];

/**
 * Barra inferior del residente en teléfono y tablet.
 *
 * Cubre las cuatro pestañas del portal más las reservas, porque en esos anchos
 * sustituye a la barra de pestañas de la pantalla en vez de duplicarla. Las
 * invitaciones QR entran aquí sí o sí: es lo que el residente enseña en la
 * garita desde el teléfono, y sin esta entrada quedarían fuera de alcance.
 * Los rótulos son cortos a propósito: cinco columnas en 390px no dan para más.
 */
const RESIDENTE_BOTTOM_NAV: Array<{ id: string; page: Page; tab?: PortalTab; labelKey: string; d: string }> = [
  { id: 'pagos',       page: 'portal',       tab: 'pagos',       labelKey: 'nav.short.payments',     d: ICON.payments },
  { id: 'visitantes',  page: 'portal',       tab: 'invitados',   labelKey: 'nav.short.visitors',     d: ICON.residents },
  { id: 'qr',          page: 'portal',       tab: 'qr',          labelKey: 'nav.short.qr',           d: ICON.qr },
  { id: 'reservas',    page: 'mis-reservas',                     labelKey: 'nav.short.reservations', d: ICON.calendar },
  { id: 'solicitudes', page: 'portal',       tab: 'solicitudes', labelKey: 'nav.short.tickets',      d: ICON.tickets },
];

function NavIcon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function resolveDefaultPage(rol: string): Page {
  if (rol === 'admin' || rol === 'admin_sucursal') return 'dashboard';
  if (rol === 'admin_empresa') return 'ae-dashboard';
  if (rol === 'residente') return 'portal';
  if (rol === 'owner') return 'owner-dashboard';
  return 'dashboard';
}

/** Se exporta para poder probar qué rótulos ve cada rol (p. ej. «Administración global» es solo del owner). */
// eslint-disable-next-line react-refresh/only-export-components
export function navForRole(rol: string): NavGroup[] {
  if (rol === 'admin' || rol === 'admin_sucursal') return ADMIN_NAV;
  if (rol === 'admin_empresa') return ADMIN_EMPRESA_NAV;
  if (rol === 'residente') return RESIDENTE_NAV;
  if (rol === 'owner') return OWNER_NAV;
  return [];
}

function AppShell() {
  const { pathname, ir } = useRuta();
  const { theme, setTheme, toggle: toggleTheme, reset: resetTheme } = useTheme();
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();

  // Una sesión de agente guardada de antes del retiro de la garita web no
  // debe abrir un dashboard vacío: se descarta como si no hubiera token.
  const tokenInicial = localStorage.getItem('token');
  if (tokenInicial && decodeTokenPayload(tokenInicial)?.rol === ROL_SOLO_ESCRITORIO) {
    localStorage.removeItem('token');
  }
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
    if (!token) return 'dashboard';
    return resolveDefaultPage((decodeTokenPayload(token)?.rol as string) || '');
  });
  const [selectedEmpresaId, setSelectedEmpresaId] = useState<string | null>(null);
  const [ticketsUnread, setTicketsUnread] = useState(0);
  const [reservasPendientes, setReservasPendientes] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Pestaña del portal del residente: la barra inferior de móvil entra directo a
  // "Pagos" o "Solicitudes" sin obligar a tocar dos veces.
  const [portalTab, setPortalTab] = useState<PortalTab>('pagos');
  const [portalTabNonce, setPortalTabNonce] = useState(0);

  /*
   * El residente cambia a layout de mano en `lg` y el personal en `md`. Una
   * tablet en vertical (768-834px) es un dispositivo que se sostiene, no un
   * escritorio: al residente le corresponde ahí la barra inferior, mientras que
   * el personal trabaja sentado y aprovecha el sidebar desde `md`.
   * Las clases se escriben literales —las dos variantes— porque Tailwind no
   * puede detectar nombres de clase construidos en tiempo de ejecución.
   */
  const corte = userRol === 'residente'
    ? {
        soloEnMano: 'lg:hidden',
        sidebarFijo: 'lg:static lg:inset-y-auto lg:w-64 lg:translate-x-0 lg:shadow-none',
        huecoInferior: 'pb-24 lg:pb-0',
        anchoEscritorio: '(min-width: 1024px)',
      }
    : {
        soloEnMano: 'md:hidden',
        sidebarFijo: 'md:static md:inset-y-auto md:w-64 md:translate-x-0 md:shadow-none',
        huecoInferior: '',
        anchoEscritorio: '(min-width: 768px)',
      };

  // Insignias del menú para el staff: tickets sin leer y reservas por aprobar. Se refrescan al
  // navegar y solas cada medio minuto (sondeo ligero, solo con la pestaña visible).
  const esAdminSucursal = userRol === 'admin' || userRol === 'admin_sucursal';
  const refrescarInsignias = useCallback(async () => {
    const [tickets, reservas] = await Promise.all([
      getTickets().catch(() => null),
      getReservas({ estado: 'pendiente_aprobacion' }).catch(() => null),
    ]);
    if (tickets) setTicketsUnread(tickets.reduce((s, tk) => s + Number(tk.no_leidos || 0), 0));
    if (reservas) setReservasPendientes(reservas.length);
  }, []);
  useEffect(() => {
    if (!esAdminSucursal) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refrescarInsignias();
  }, [esAdminSucursal, page, refrescarInsignias]);
  usePolling(refrescarInsignias, 30_000, esAdminSucursal);

  // Cierra el drawer al pasar a escritorio: si no, queda un panel flotante.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const mq = window.matchMedia(corte.anchoEscritorio);
    const onChange = () => { if (mq.matches) setMobileNavOpen(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mobileNavOpen, corte.anchoEscritorio]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileNavOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileNavOpen]);

  const navGroups = useMemo(() => navForRole(userRol), [userRol]);

  const portalRuta = portalDeRuta(pathname);
  const portalSesion = isAuthenticated ? portalDeRol(userRol) : null;
  // /invitacion/<token>: pantalla pública que vive fuera de los portales.
  const tokenInvitacion = tokenDeInvitacion(pathname);

  /**
   * Corrige la dirección cuando no cuadra: un alias (/staff, /tenant), una ruta
   * que no es de ningún portal, o el portal que no corresponde al rol de la
   * sesión. Siempre con `reemplazar`, para no dejar en el historial una ruta
   * que se volvería a corregir al pulsar atrás.
   */
  useEffect(() => {
    if (tokenInvitacion) return;
    const destino = portalSesion ?? portalRuta ?? 'personal';
    const rutaDestino = RUTA_PORTAL[destino];
    if (pathname !== rutaDestino) ir(rutaDestino, { reemplazar: true });
  }, [pathname, portalRuta, portalSesion, ir, tokenInvitacion]);

  // El portal que se pinta: el de la sesión manda sobre el de la barra de
  // direcciones, porque el efecto de arriba ya está corrigiendo la URL.
  const portalActivo = portalSesion ?? portalRuta ?? 'personal';

  const handleLogin = (token: string, rol: string, usuario: Record<string, unknown>) => {
    localStorage.setItem('token', token);
    const payload = decodeTokenPayload(token);
    setUserNombre((payload?.nombre as string) || '');
    setUserRol(rol);
    setIsAuthenticated(true);
    setPage(resolveDefaultPage(rol));
    ir(RUTA_PORTAL[portalDeRol(rol)], { reemplazar: true });

    // El tema lo decide el usuario: al entrar se aplica el que tiene guardado en
    // su perfil, y si aún no eligió ninguno se queda el default del producto.
    setTheme(usuario.tema === 'light' ? 'light' : 'dark');
    if (usuario.idioma === 'es' || usuario.idioma === 'en') setLanguage(usuario.idioma);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    // Fuera de sesión no hay preferencia que respetar: se vuelve al oscuro.
    resetTheme();
    setIsAuthenticated(false);
    setUserRol('');
    setUserNombre('');
    setSelectedEmpresaId(null);
    setPage('dashboard');
  };

  const navigate = (p: string) => {
    setPage(p as Page);
    setMobileNavOpen(false);
  };

  const goToPortalTab = (target: Page, tab?: PortalTab) => {
    if (tab) {
      setPortalTab(tab);
      setPortalTabNonce(n => n + 1);
    }
    setPage(target);
    setMobileNavOpen(false);
  };

  const defaultPage: Page = resolveDefaultPage(userRol);
  const roleLabel = userRol === 'owner'
    ? 'Admin global'
    : userRol === 'admin_empresa'
    ? 'Admin empresa'
    : userRol === 'admin_sucursal'
    ? 'Admin sucursal'
    : userRol === 'admin'
    ? 'Administrador'
    : userRol === 'residente'
    ? 'Residente'
    : '';

  const goToEmpresaDetail = (id: string) => {
    setSelectedEmpresaId(id);
    setPage('owner-empresa-detail');
  };

  const activeKey: Page = page === 'owner-empresa-detail' ? 'owner-dashboard' : page;

  /** Migas: grupo del sidebar → pantalla → subpantalla, cuando la hay. */
  const breadcrumbs = useMemo(() => {
    const group = navGroups.find(g => g.items.some(i => i.key === activeKey));
    const item = group?.items.find(i => i.key === activeKey);
    const trail: string[] = [];
    if (group) trail.push(t(group.labelKey));
    if (item) trail.push(t(item.labelKey));
    if (page === 'owner-empresa-detail') trail.push(t('owner.companyDetail', 'Detalle de empresa'));
    return trail;
  }, [navGroups, activeKey, page, t]);

  /**
   * Páginas a las que este rol puede llegar. El `default` del switch nunca se
   * alcanzaba —cubre los 22 valores del tipo—, así que la pantalla de "no
   * encontrado" era código muerto. Con esto sí cubre el caso real: que la
   * página activa no corresponda al rol de la sesión, por ejemplo si el token
   * se refresca con otro rol o si un deploy retira una sección.
   */
  const paginasPermitidas = useMemo(() => {
    const permitidas = new Set<Page>(navGroups.flatMap(g => g.items.map(i => i.key)));
    if (userRol === 'owner') permitidas.add('owner-empresa-detail');
    return permitidas;
  }, [navGroups, userRol]);

  const renderPage = () => {
    if (!paginasPermitidas.has(page)) {
      return <NotFoundPage onNavigate={navigate} defaultPage={defaultPage} />;
    }

    switch (page) {
      case 'dashboard':    return <DashboardPage onNavigate={navigate} />;
      case 'residentes':   return <ResidentesPage />;
      case 'agentes':      return <AgentesPage />;
      case 'garitas':      return <LicenciasPage />;
      case 'pagos':        return <PagosPage />;
      case 'preaut':       return <PreautPage />;
      case 'reportes':
        return (
          <Suspense fallback={<div className="flex justify-center py-24 text-gray-400"><Spinner size={24} /></div>}>
            <EstadisticasPage onNavigate={navigate} />
          </Suspense>
        );
      case 'config':       return <ConfigCargosPage />;
      case 'config-qr':    return <div className="sg-page"><ConfiguracionQrPage /></div>;
      case 'verificacion': return <VerificacionPage />;
      case 'blacklist':    return <BlacklistPage />;
      case 'anuncios':     return <AnunciosPage />;
      case 'tickets':      return <TicketsPage />;
      case 'reservas':     return <ReservasAdminPage />;
      case 'mis-reservas': return <ReservasPage />;
      case 'mis-anuncios': return <MisAnunciosPage />;
      case 'portal':       return <ResidentePage requestedTab={portalTab} tabNonce={portalTabNonce} />;
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

  // Aceptar una invitación abre sesión con la cuenta recién creada, aunque
  // hubiera otra sesión en este navegador.
  if (tokenInvitacion) {
    return (
      <AceptarInvitacionPage
        token={tokenInvitacion}
        onAceptada={r => { handleLogin(r.token, r.usuario.rol, r.usuario); }}
        onIrALogin={() => ir(RUTA_PORTAL.personal, { reemplazar: true })}
      />
    );
  }

  if (!isAuthenticated) {
    return <LoginPage portal={portalActivo} onLogin={handleLogin} onCambiarPortal={ir} />;
  }

  const isResidente = userRol === 'residente';

  const sidebar = (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-5" aria-label={t('nav.menu')}>
      {navGroups.map((group, gi) => (
        <div key={group.labelKey} className={cx(gi > 0 && 'border-t border-gray-700 pt-5')}>
          <p className="mb-2 px-3 text-2xs font-bold uppercase tracking-[0.12em] text-gray-400">
            {t(group.labelKey)}
          </p>
          <ul className="space-y-0.5">
            {group.items.map(item => {
              const active = activeKey === item.key;
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => { setPage(item.key); setMobileNavOpen(false); }}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                      active
                        ? 'bg-brand-500/12 font-bold text-brand-400'
                        : 'font-medium text-gray-300 hover:bg-gray-500/10 hover:text-gray-50',
                    )}
                  >
                    {/* Barra de acento: el estado activo se lee de un vistazo,
                        no depende solo de un cambio sutil de color. */}
                    {active && <span className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-brand-500" aria-hidden="true" />}
                    <NavIcon d={item.d} />
                    <span className="truncate">{t(item.labelKey)}</span>
                    {item.key === 'tickets' && ticketsUnread > 0 && (
                      <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-600 px-1 text-2xs font-bold leading-none text-white">
                        {ticketsUnread > 9 ? '9+' : ticketsUnread}
                      </span>
                    )}
                    {item.key === 'reservas' && reservasPendientes > 0 && (
                      <span
                        className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-warning-500 px-1 text-2xs font-bold leading-none text-black"
                        title={`${reservasPendientes} ${t('nav.badge.pendingReservations')}`}
                      >
                        {reservasPendientes > 9 ? '9+' : reservasPendientes}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col">
      {/* ── Header ── */}
      <header className="sticky top-0 z-header flex h-16 shrink-0 items-center justify-between gap-3 border-b border-gray-700 bg-dark-800 px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen(v => !v)}
            aria-label={mobileNavOpen ? t('nav.closeMenu') : t('nav.openMenu')}
            aria-expanded={mobileNavOpen}
            className={cx('flex h-10 w-10 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-gray-500/12 hover:text-gray-50', corte.soloEnMano)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d={mobileNavOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 6h16M4 12h16M4 18h16'} />
            </svg>
          </button>

          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-logo text-logo-ink">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={ICON.shield} />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-base font-bold tracking-tight text-gray-50">SecureGate</span>
              <span className="hidden text-2xs font-semibold uppercase tracking-wider text-gray-400 sm:block">{roleLabel}</span>
            </span>
          </span>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {isResidente && <AnnouncementsBell onVerTodos={() => navigate('mis-anuncios')} />}

          <button
            type="button"
            onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
            aria-label="Toggle language"
            className="flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-xs font-bold text-gray-400 transition-colors hover:bg-gray-500/12 hover:text-gray-50"
          >
            {language === 'es' ? 'EN' : 'ES'}
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
            title={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-500/12 hover:text-gray-50"
          >
            {theme === 'dark' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          {userNombre && (
            <span className="ml-1 hidden max-w-40 truncate text-sm font-medium text-gray-300 lg:block">{userNombre}</span>
          )}

          {/* En móvil el rótulo cedería el ancho del logo: se reduce a ícono. */}
          <button
            type="button"
            onClick={handleLogout}
            title={t('common.logout')}
            aria-label={t('common.logout')}
            className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-danger-400 transition-colors hover:bg-danger-500/12 sm:w-auto sm:px-3"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sm:hidden" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            <span className="hidden whitespace-nowrap text-sm font-bold sm:inline">{t('common.logout')}</span>
          </button>
        </div>
      </header>

      <div className="relative flex flex-1 overflow-hidden">
        {mobileNavOpen && (
          <button
            type="button"
            aria-label={t('nav.closeMenu')}
            onClick={() => setMobileNavOpen(false)}
            className={cx('sg-drawer-backdrop fixed inset-0 top-16 z-drawer', corte.soloEnMano)}
          />
        )}

        <aside
          className={cx(
            'fixed inset-y-16 left-0 z-drawer flex w-[min(84vw,17rem)] shrink-0 flex-col border-r border-gray-700 bg-dark-800 shadow-xl transition-transform duration-200',
            corte.sidebarFijo,
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          {sidebar}
          <div className="border-t border-gray-700 px-6 py-4">
            <p className="text-2xs font-semibold uppercase tracking-wider text-gray-400">{roleLabel}</p>
            <p className="mt-0.5 truncate text-sm font-medium text-gray-200">{userNombre || '—'}</p>
          </div>
        </aside>

        <main className={cx('relative min-w-0 flex-1 overflow-y-auto', corte.huecoInferior)}>
          {breadcrumbs.length > 1 && (
            <nav aria-label="Breadcrumb" className="border-b border-gray-700 bg-dark-800/60 px-4 py-2.5 sm:px-6">
              <ol className="flex flex-wrap items-center gap-1.5 text-xs">
                {breadcrumbs.map((crumb, i) => (
                  <li key={`${crumb}-${i}`} className="flex items-center gap-1.5">
                    {i > 0 && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-gray-500" aria-hidden="true">
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    )}
                    <span className={i === breadcrumbs.length - 1 ? 'font-semibold text-gray-100' : 'text-gray-400'}>
                      {crumb}
                    </span>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          {renderPage()}
        </main>

        {/* Barra inferior del residente: los cuatro destinos que usa a diario. */}
        {isResidente && (
          <nav
            className={cx('fixed inset-x-0 bottom-0 z-drawer grid grid-cols-5 border-t border-gray-700 bg-dark-800 pb-[env(safe-area-inset-bottom)]', corte.soloEnMano)}
            aria-label={t('nav.menu')}
          >
            {RESIDENTE_BOTTOM_NAV.map(item => {
              const active = page === item.page && (!item.tab || portalTab === item.tab);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goToPortalTab(item.page, item.tab)}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex min-h-14 flex-col items-center justify-center gap-1 text-2xs font-bold transition-colors',
                    active ? 'text-brand-400' : 'text-gray-400',
                  )}
                >
                  <NavIcon d={item.d} size={19} />
                  <span className="truncate px-1">{t(item.labelKey)}</span>
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <ToastProvider>
          <AppShell />
        </ToastProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
