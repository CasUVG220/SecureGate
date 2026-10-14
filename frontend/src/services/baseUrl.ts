// URL base del backend.
//
// Se resuelve en runtime a partir del hostname desde el que se abrio la app,
// para no tener que hornear la IP de cada servidor en tiempo de build: el
// mismo contenedor sirve para localhost y para cualquier VM nueva.
//
// VITE_API_URL solo manda cuando apunta a un host distinto del loopback
// (caso produccion detras de nginx: VITE_API_URL=https://midominio.com).
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];
const API_PORT = import.meta.env.VITE_API_PORT || '3000';

export const resolveBaseUrl = (): string => {
  const envUrl = (import.meta.env.VITE_API_URL || '').trim();

  // Sin navegador (tests, SSR) no hay hostname que detectar.
  if (typeof window === 'undefined') return envUrl || `http://localhost:${API_PORT}`;

  const pageHost = window.location.hostname;
  const envPointsToLoopback = !envUrl || LOOPBACK_HOSTS.some(h => envUrl.includes(h));

  // La pagina se abrio desde una IP/hostname remoto pero la env var quedo en
  // localhost: apuntamos al backend del mismo host que sirve el frontend.
  if (envPointsToLoopback && !LOOPBACK_HOSTS.includes(pageHost)) {
    return `${window.location.protocol}//${pageHost}:${API_PORT}`;
  }

  return envUrl || `${window.location.protocol}//${pageHost}:${API_PORT}`;
};
