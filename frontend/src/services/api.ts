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

const resolveBaseUrl = (): string => {
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

const BASE_URL = resolveBaseUrl();

const getToken = (): string => localStorage.getItem('token') || '';

const authHeaders = (): HeadersInit => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${getToken()}`,
});

// ── Auth helpers ──────────────────────────────────────────────────────────

export const refreshToken = async (): Promise<string | null> => {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = await res.json() as { token: string };
    localStorage.setItem('token', data.token);
    return data.token;
  } catch {
    return null;
  }
};

export const logout = async (): Promise<void> => {
  await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {});
  localStorage.removeItem('token');
};

let _refreshing: Promise<string | null> | null = null;

const apiFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  const res = await fetch(url, init);
  if (res.status !== 401) return res;

  // Deduplicate concurrent refresh attempts
  if (!_refreshing) {
    _refreshing = refreshToken().finally(() => { _refreshing = null; });
  }
  const newToken = await _refreshing;

  if (!newToken) {
    localStorage.removeItem('token');
    window.location.href = '/';
    return res;
  }

  // Retry once with the new access token
  const retryHeaders: HeadersInit = {
    ...(init?.headers as Record<string, string> | undefined),
    Authorization: `Bearer ${newToken}`,
  };
  return fetch(url, { ...init, headers: retryHeaders });
};

export interface Residente {
  id: string;
  numero_casa: string;
  nombre: string;
  email: string;
  estado_pago: 'al_dia' | 'mora' | 'pendiente';
  saldo_pendiente: string;
  telefono?: string;
}

export interface AccesoPayload {
  nombre_visitante: string;
  numero_dpi: string;
  foto?: string;
  residente_id: string;
  agente_id: string;
  placa?: string;
  notas?: string;
  invitacion_qr_id?: string;
}

export interface CargoGenerado {
  monto: string;
  nombre: string;
  frecuencia: string;
}

export interface AccesoResult {
  registro: Record<string, unknown>;
  visitante: Record<string, unknown>;
  cargo_generado: CargoGenerado | null;
  cargo_extra_mora: number | null;
  preautorizado: boolean;
  saldo_pendiente_actualizado: number;
}

export const getResidentes = async (): Promise<Residente[]> => {
  const res = await apiFetch(`${BASE_URL}/api/residentes`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar residentes');
  return res.json();
};

export class BlacklistDenialError extends Error {
  razon: string;
  fecha_fin: string | null;
  constructor(razon: string, fecha_fin: string | null) {
    super('Visitante en lista negra');
    this.name = 'BlacklistDenialError';
    this.razon = razon;
    this.fecha_fin = fecha_fin;
  }
}

export const registrarAcceso = async (data: AccesoPayload): Promise<AccesoResult> => {
  const res = await apiFetch(`${BASE_URL}/api/accesos`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) {
    if (res.status === 403 && (body as { razon?: string }).razon) {
      const b = body as { razon: string; fecha_fin?: string | null };
      throw new BlacklistDenialError(b.razon, b.fecha_fin ?? null);
    }
    throw new Error((body as { error?: string }).error || 'Error al registrar acceso');
  }
  return body;
};

export interface ResidenteInput {
  nombre: string;
  email: string;
  password: string;
  numero_casa: string;
  telefono?: string;
}

export interface ResidenteUpdate {
  numero_casa?: string;
  estado_pago?: string;
  telefono?: string;
  saldo_pendiente?: number;
}

export const createResidente = async (data: ResidenteInput): Promise<Residente> => {
  const res = await apiFetch(`${BASE_URL}/api/residentes`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al crear residente');
  return body;
};

export const updateResidente = async (id: string, data: ResidenteUpdate): Promise<Residente> => {
  const res = await apiFetch(`${BASE_URL}/api/residentes/${id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al actualizar residente');
  return body;
};

export const deleteResidente = async (id: string): Promise<void> => {
  const res = await apiFetch(`${BASE_URL}/api/residentes/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error || 'Error al eliminar residente');
  }
};

export interface LoginResult {
  token: string;
  usuario: { id: string; nombre: string; email: string; rol: string; idioma?: string; tema?: string };
}

/** Error de acceso que además sabe a qué portal pertenece la cuenta. */
export class PortalIncorrectoError extends Error {
  // Campo declarado aparte: el proyecto compila con `erasableSyntaxOnly`, que
  // no admite propiedades declaradas en los parámetros del constructor.
  portalCorrecto: 'personal' | 'residente';

  constructor(mensaje: string, portalCorrecto: 'personal' | 'residente') {
    super(mensaje);
    this.name = 'PortalIncorrectoError';
    this.portalCorrecto = portalCorrecto;
  }
}

/**
 * Inicia sesión contra un portal concreto. El backend rechaza las credenciales
 * que no pertenecen a ese portal: un residente no entra por el de personal ni
 * al revés.
 */
export const login = async (
  email: string,
  password: string,
  portal?: 'personal' | 'residente',
): Promise<LoginResult> => {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, portal }),
  });
  const body = await res.json();
  if (!res.ok) {
    if (res.status === 403 && body.portalCorrecto) {
      throw new PortalIncorrectoError(body.error, body.portalCorrecto);
    }
    throw new Error(body.error || 'Credenciales incorrectas');
  }
  return body;
};

export interface AccesoActivo {
  registro_id: string;
  timestamp_entrada: string;
  visitante: { id: string; nombre: string; numero_dpi: string };
  residente: { id: string; numero_casa: string; nombre: string };
  placa: string;
}

/** Retorna null cuando no hay acceso activo (404), lanza Error para otros fallos */
export const getAccesoActivo = async (placa: string): Promise<AccesoActivo | null> => {
  const res = await apiFetch(
    `${BASE_URL}/api/accesos/activo?placa=${encodeURIComponent(placa)}`,
    { headers: authHeaders() }
  );
  if (res.status === 404) return null;
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al buscar acceso activo');
  return body as AccesoActivo;
};

export const getAccesosActivos = async (): Promise<AccesoActivo[]> => {
  const res = await apiFetch(`${BASE_URL}/api/accesos/activos`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar visitantes activos');
  return res.json();
};

export const registrarSalidaVehiculo = async (
  registroId: string
): Promise<Record<string, unknown>> => {
  const res = await apiFetch(`${BASE_URL}/api/accesos/${encodeURIComponent(registroId)}/salida`, {
    method: 'PUT',
    headers: authHeaders(),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al registrar salida');
  return body as Record<string, unknown>;
};

export interface Pago {
  id: string;
  residente_id: string;
  monto: string;
  fecha_pago: string;
  metodo: 'efectivo' | 'transferencia' | 'reserva' | 'tarjeta';
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'anulado';
  concepto?: string | null;
  /** Últimos 4 dígitos de la tarjeta; el número completo nunca llega al backend. */
  tarjeta_ultimos4?: string | null;
  /** El cobro salió de la pasarela de prueba, no de un procesador real. */
  es_simulado?: boolean;
  comprobante: string | null;
  referencia: string | null;
  banco: string | null;
  fecha_transferencia: string | null;
  comentario_rechazo: string | null;
  registrado_por: string;
  numero_casa: string;
  residente_nombre: string;
}

export interface PagoVerificacion extends Pago {
  residente_email: string;
  residente_telefono: string | null;
  saldo_pendiente: string;
  estado_pago: string;
}

export interface TransferenciaInput {
  monto: number;
  referencia: string;
  banco: string;
  fecha_transferencia: string;
  comprobante?: string;
}

export interface PagoInput {
  residente_id: string;
  monto: number;
  comprobante?: string;
}

export const getPagos = async (): Promise<Pago[]> => {
  const res = await apiFetch(`${BASE_URL}/api/pagos`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar pagos');
  return res.json();
};

export const createPago = async (data: PagoInput): Promise<Pago> => {
  const res = await apiFetch(`${BASE_URL}/api/pagos`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al crear pago');
  return body as Pago;
};

export const aprobarPago = async (id: string): Promise<Pago> => {
  const res = await apiFetch(`${BASE_URL}/api/pagos/${encodeURIComponent(id)}/aprobar`, {
    method: 'PUT',
    headers: authHeaders(),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al aprobar pago');
  return body as Pago;
};

export const rechazarPago = async (id: string, comentario_rechazo?: string): Promise<Pago> => {
  const res = await apiFetch(`${BASE_URL}/api/pagos/${encodeURIComponent(id)}/rechazar`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ comentario_rechazo }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al rechazar pago');
  return body as Pago;
};

export const getPendientesVerificacion = async (): Promise<PagoVerificacion[]> => {
  const res = await apiFetch(`${BASE_URL}/api/pagos/pendientes-verificacion`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar cola de verificación');
  return res.json();
};

export const crearTransferencia = async (data: TransferenciaInput): Promise<Pago> => {
  const res = await apiFetch(`${BASE_URL}/api/pagos/transferencia`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al enviar comprobante');
  return body as Pago;
};

export interface PagoTarjetaInput {
  monto: number;
  /** Últimos 4 dígitos; el PAN completo, el CVV y el vencimiento no salen del navegador. */
  ultimos4: string;
  titular?: string;
}

/**
 * Cobro con tarjeta contra la pasarela simulada del backend.
 *
 * MOCK — el endpoint decide aprobado/rechazado con una regla determinística y
 * se sustituirá por la integración real de Visanet en un sprint futuro. La
 * firma de esta función no debería cambiar cuando eso ocurra.
 */
export const pagarConTarjeta = async (data: PagoTarjetaInput): Promise<Pago> => {
  const res = await apiFetch(`${BASE_URL}/api/pagos/tarjeta`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al procesar el pago');
  return body as Pago;
};

export const getMisPagos = async (): Promise<Pago[]> => {
  const res = await apiFetch(`${BASE_URL}/api/pagos/mis`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar historial de pagos');
  return res.json();
};

export interface Preautorizacion {
  id: string;
  residente_id: string;
  nombre_visitante: string;
  numero_dpi: string | null;
  placa: string | null;
  fecha_inicio: string;
  fecha_fin: string | null;
  activo: boolean;
  created_at: string;
  numero_casa: string;
  residente_nombre: string;
}

export interface PreautorizacionInput {
  residente_id: string;
  nombre_visitante: string;
  numero_dpi?: string;
  placa?: string;
  fecha_inicio: string;
  fecha_fin?: string;
}

export interface MiPreautorizacion {
  id: string;
  nombre_visitante: string;
  numero_dpi: string | null;
  placa: string | null;
  fecha_inicio: string;
  fecha_fin: string | null;
  activo: boolean;
  created_at: string;
}

export interface MiVisita {
  id: string;
  timestamp_entrada: string;
  timestamp_salida: string | null;
  nombre_visitante: string;
  numero_dpi: string;
  placa: string | null;
}

export interface PreautMatch {
  residente_id: string;
  nombre_visitante: string;
  numero_dpi: string | null;
  placa: string | null;
  numero_casa: string;
  residente_nombre: string;
}

/** Busca una preautorización vigente hoy por DPI o placa. Devuelve null si no existe. */
export const buscarPreautorizacion = async (
  params: { dpi?: string; placa?: string }
): Promise<PreautMatch | null> => {
  const qs = new URLSearchParams();
  if (params.dpi)   qs.set('dpi',   params.dpi);
  if (params.placa) qs.set('placa', params.placa);
  const res = await apiFetch(
    `${BASE_URL}/api/preautorizaciones/buscar?${qs.toString()}`,
    { headers: authHeaders() }
  );
  if (res.status === 404) return null;
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al buscar preautorización');
  return body as PreautMatch;
};

export const getMisPreautorizaciones = async (): Promise<MiPreautorizacion[]> => {
  const res = await apiFetch(`${BASE_URL}/api/preautorizaciones/mis`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar preautorizaciones');
  return res.json();
};

export const createMisPreautorizacion = async (
  data: Omit<PreautorizacionInput, 'residente_id'>
): Promise<MiPreautorizacion> => {
  const res = await apiFetch(`${BASE_URL}/api/preautorizaciones/mis`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al crear preautorización');
  return body as MiPreautorizacion;
};

export const deleteMisPreautorizacion = async (id: string): Promise<void> => {
  const res = await apiFetch(
    `${BASE_URL}/api/preautorizaciones/mis/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: authHeaders() }
  );
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error || 'Error al eliminar preautorización');
  }
};

export type InvitacionQrTipo = 'grupal' | 'individual';

export interface InvitacionQr {
  id: string;
  tipo: InvitacionQrTipo;
  etiqueta: string | null;
  nombre_visitante: string | null;
  numero_dpi: string | null;
  placa: string | null;
  fecha_inicio: string;
  fecha_fin: string | null;
  usos_maximos: number | null;
  usos_actuales: number;
  activo: boolean;
  created_at: string;
}

export interface InvitacionQrInput {
  tipo: InvitacionQrTipo;
  etiqueta?: string;
  nombre_visitante?: string;
  numero_dpi?: string;
  placa?: string;
  fecha_inicio: string;
  fecha_fin?: string;
  usos_maximos?: number;
}

export interface InvitacionQrVerificada {
  id: string;
  tipo: InvitacionQrTipo;
  etiqueta: string | null;
  nombre_visitante: string | null;
  numero_dpi: string | null;
  placa: string | null;
  residente_id: string;
  numero_casa: string;
  residente_nombre: string;
  usos_maximos: number | null;
  usos_actuales: number;
}

export interface ConfigQr {
  dpi_obligatorio_individual: boolean;
  requiere_placa: boolean;
  autorizacion_automatica: boolean;
  max_intentos_fallidos: number;
  bloqueo_minutos: number;
  es_default?: boolean;
}

export const getConfigQr = async (): Promise<ConfigQr> => {
  const res = await apiFetch(`${BASE_URL}/api/config-qr`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar la configuración de QR');
  return res.json();
};

export const updateConfigQr = async (data: Partial<ConfigQr>): Promise<ConfigQr> => {
  const res = await apiFetch(`${BASE_URL}/api/config-qr`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al guardar la configuración de QR');
  return body;
};

export const getMisInvitaciones = async (): Promise<InvitacionQr[]> => {
  const res = await apiFetch(`${BASE_URL}/api/invitaciones-qr/mis`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar invitaciones QR');
  return res.json();
};

export const crearInvitacionQr = async (data: InvitacionQrInput): Promise<InvitacionQr> => {
  const res = await apiFetch(`${BASE_URL}/api/invitaciones-qr/mis`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al crear invitación QR');
  return body as InvitacionQr;
};

export const revocarInvitacionQr = async (id: string): Promise<void> => {
  const res = await apiFetch(
    `${BASE_URL}/api/invitaciones-qr/mis/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: authHeaders() }
  );
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error || 'Error al revocar invitación QR');
  }
};

/** Verifica un código QR escaneado en garita. Lanza Error con el motivo de rechazo si no es válido. */
export const verificarInvitacionQr = async (id: string): Promise<InvitacionQrVerificada> => {
  const res = await apiFetch(
    `${BASE_URL}/api/invitaciones-qr/verificar/${encodeURIComponent(id)}`,
    { headers: authHeaders() }
  );
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Código QR inválido');
  return body as InvitacionQrVerificada;
};

export const getMisAccesos = async (): Promise<MiVisita[]> => {
  const res = await apiFetch(`${BASE_URL}/api/accesos/mis`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar historial de accesos');
  return res.json();
};

export const getPreautorizaciones = async (): Promise<Preautorizacion[]> => {
  const res = await apiFetch(`${BASE_URL}/api/preautorizaciones`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar preautorizaciones');
  return res.json();
};

export const createPreautorizacion = async (
  data: PreautorizacionInput
): Promise<Preautorizacion> => {
  const res = await apiFetch(`${BASE_URL}/api/preautorizaciones`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al crear preautorización');
  return body as Preautorizacion;
};

export const deletePreautorizacion = async (id: string): Promise<void> => {
  const res = await apiFetch(
    `${BASE_URL}/api/preautorizaciones/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: authHeaders() }
  );
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error || 'Error al eliminar preautorización');
  }
};

export interface ResidenteMe {
  id: string;
  numero_casa: string;
  estado_pago: 'al_dia' | 'mora' | 'pendiente';
  saldo_pendiente: string;
  telefono: string | null;
  nombre: string;
  email: string;
  pagos_recientes: Array<{
    id: string;
    monto: string;
    fecha_pago: string;
    metodo: string;
    estado: string;
  }>;
}

export const getResidenteMe = async (): Promise<ResidenteMe> => {
  const res = await apiFetch(`${BASE_URL}/api/residentes/me`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar tus datos');
  return res.json();
};

export interface DashboardData {
  accesos_hoy: number;
  residentes_mora: number;
  pagos_pendientes: number;
  accesos_recientes: Array<{
    id: string;
    nombre_visitante: string;
    numero_casa: string;
    timestamp_entrada: string;
    timestamp_salida: string | null;
  }>;
}

export const getDashboard = async (): Promise<DashboardData> => {
  const res = await apiFetch(`${BASE_URL}/api/dashboard`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar el dashboard');
  return res.json();
};

export const decodeTokenPayload = (token: string): Record<string, unknown> | null => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
};

export const scanDPI = async (
  base64: string
): Promise<{ nombre: string; numero_dpi: string }> => {
  const res = await fetch(`${BASE_URL}/api/ocr/dpi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64 }),
  });
  return res.json();
};

export const scanPlaca = async (
  base64: string
): Promise<{ placa: string }> => {
  const res = await fetch(`${BASE_URL}/api/ocr/placa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64 }),
  });
  return res.json();
};

const downloadCSV = async (url: string, filename: string): Promise<void> => {
  const res = await apiFetch(url, { headers: authHeaders() });
  if (!res.ok) return;
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
};

export const downloadReporteAccesos = (desde: string, hasta: string): void => {
  void downloadCSV(
    `${BASE_URL}/api/reportes/accesos?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
    `accesos_${desde}_${hasta}.csv`
  );
};

export const downloadReportePagos = (desde: string, hasta: string): void => {
  void downloadCSV(
    `${BASE_URL}/api/reportes/pagos?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
    `pagos_${desde}_${hasta}.csv`
  );
};

export interface ConfigCargo {
  id: string;
  nombre: string;
  monto: string;
  frecuencia: 'mensual' | 'quincenal' | 'unica_vez';
  restringir_visitas_mora: boolean;
  costo_extra_visita_mora: string;
  activo: boolean;
  created_at: string;
}

export interface ConfigCargoInput {
  nombre: string;
  monto: number;
  frecuencia?: 'mensual' | 'quincenal' | 'unica_vez';
  restringir_visitas_mora?: boolean;
  costo_extra_visita_mora?: number;
  sucursal_id?: string;
}

export const getConfigCargos = async (): Promise<ConfigCargo[]> => {
  const res = await apiFetch(`${BASE_URL}/api/configuracion-cargos`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar configuraciones de cargo');
  return res.json();
};

export const createConfigCargo = async (data: ConfigCargoInput): Promise<ConfigCargo> => {
  const res = await apiFetch(`${BASE_URL}/api/configuracion-cargos`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al crear configuración');
  return body as ConfigCargo;
};

export const updateConfigCargo = async (
  id: string,
  data: Partial<ConfigCargoInput & { activo: boolean }>
): Promise<ConfigCargo> => {
  const res = await apiFetch(`${BASE_URL}/api/configuracion-cargos/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al actualizar configuración');
  return body as ConfigCargo;
};

export const deleteConfigCargo = async (id: string): Promise<void> => {
  const res = await apiFetch(`${BASE_URL}/api/configuracion-cargos/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error || 'Error al eliminar configuración');
  }
};

// ── Empresas ──────────────────────────────────────────────────────────────

export interface Empresa {
  id: string;
  nombre: string;
  nit: string | null;
  logo_url: string | null;
  activo: boolean;
  created_at: string;
  total_sucursales: number;
}

export interface EmpresaInput {
  nombre: string;
  nit?: string;
  logo_url?: string;
}

export interface EmpresaStats {
  total_sucursales: number;
  total_residentes: number;
  total_accesos_hoy: number;
  total_pagos_pendientes: number;
  sucursales: Array<{ id: string; nombre: string; accesos_hoy: number }>;
}

export const getEmpresas = async (): Promise<Empresa[]> => {
  const res = await apiFetch(`${BASE_URL}/api/empresas`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar empresas');
  return res.json() as Promise<Empresa[]>;
};

export const createEmpresa = async (data: EmpresaInput): Promise<Empresa> => {
  const res = await apiFetch(`${BASE_URL}/api/empresas`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al crear empresa');
  return body as Empresa;
};

export const updateEmpresa = async (
  id: string,
  data: Partial<EmpresaInput & { activo: boolean }>
): Promise<Empresa> => {
  const res = await apiFetch(`${BASE_URL}/api/empresas/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al actualizar empresa');
  return body as Empresa;
};

export const getEmpresaStats = async (id: string): Promise<EmpresaStats> => {
  const res = await apiFetch(
    `${BASE_URL}/api/empresas/${encodeURIComponent(id)}/stats`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new Error('Error al cargar estadísticas de empresa');
  return res.json() as Promise<EmpresaStats>;
};

export const deleteEmpresa = async (id: string): Promise<void> => {
  const res = await apiFetch(`${BASE_URL}/api/empresas/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Error al eliminar empresa');
  }
};

export const assignAdminEmpresa = async (empresaId: string, usuarioId: string): Promise<void> => {
  const res = await apiFetch(`${BASE_URL}/api/empresas/${encodeURIComponent(empresaId)}/admin`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ usuario_id: usuarioId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Error al asignar admin');
  }
};

// ── Sucursales ────────────────────────────────────────────────────────────

export interface Sucursal {
  id: string;
  empresa_id: string;
  empresa_nombre: string;
  nombre: string;
  direccion: string | null;
  tipo: string | null;
  activo: boolean;
  total_residentes: number;
  total_agentes: number;
  created_at: string;
}

export interface SucursalInput {
  empresa_id: string;
  nombre: string;
  direccion?: string;
  tipo?: string;
}

export const getSucursales = async (): Promise<Sucursal[]> => {
  const res = await apiFetch(`${BASE_URL}/api/sucursales`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar sucursales');
  return res.json() as Promise<Sucursal[]>;
};

export const createSucursal = async (data: SucursalInput): Promise<Sucursal> => {
  const res = await apiFetch(`${BASE_URL}/api/sucursales`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al crear sucursal');
  return body as Sucursal;
};

export const assignAdminSucursal = async (
  sucursal_id: string,
  usuario_id: string
): Promise<unknown> => {
  const res = await apiFetch(
    `${BASE_URL}/api/sucursales/${encodeURIComponent(sucursal_id)}/admin`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ usuario_id }),
    }
  );
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al asignar admin');
  return body;
};

export const updateSucursal = async (
  id: string,
  data: Partial<SucursalInput & { activo: boolean }>
): Promise<Sucursal> => {
  const res = await apiFetch(`${BASE_URL}/api/sucursales/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al actualizar sucursal');
  return body as Sucursal;
};

export const deleteSucursal = async (id: string): Promise<void> => {
  const res = await apiFetch(`${BASE_URL}/api/sucursales/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Error al eliminar sucursal');
  }
};

// ── Usuarios (staff) ──────────────────────────────────────────────────────

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  sucursal_id: string | null;
  empresa_id: string | null;
  sucursal_nombre: string | null;
  activo: boolean;
  created_at: string;
}

export interface UsuarioInput {
  nombre: string;
  email: string;
  password: string;
  rol: string;
  sucursal_id?: string;
}

export const getUsuarios = async (): Promise<Usuario[]> => {
  const res = await apiFetch(`${BASE_URL}/api/usuarios`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar usuarios');
  return res.json() as Promise<Usuario[]>;
};

export const createUsuario = async (data: UsuarioInput): Promise<Usuario> => {
  const res = await apiFetch(`${BASE_URL}/api/usuarios`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al crear usuario');
  return body as Usuario;
};

export interface Preferencias {
  idioma?: string;
  tema?: string;
}

/**
 * Guarda las preferencias propias. Se manda sólo lo que cambió: enviar las dos
 * juntas hacía que quien cambiaba una pisara el valor de la otra.
 */
export const updatePreferencias = async (prefs: Preferencias): Promise<void> => {
  const res = await apiFetch(`${BASE_URL}/api/usuarios/me/preferencias`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(prefs),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Error al actualizar preferencias');
  }
};

export const deleteUsuario = async (id: string): Promise<void> => {
  const res = await apiFetch(`${BASE_URL}/api/usuarios/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Error al eliminar usuario');
  }
};

// ── Blacklist ─────────────────────────────────────────────────────────────

export interface Blacklist {
  id: string;
  razon: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  activo: boolean;
  created_at: string;
  visitante_id: string;
  visitante_nombre: string;
  numero_dpi: string;
  sucursal_nombre: string;
  creado_por_nombre: string;
}

/** @deprecated alias de Blacklist */
export type BlacklistEntry = Blacklist;

export type BlacklistDuracion = 'temporal_dias' | '30_dias' | 'indefinido';

export interface BlacklistInput {
  visitante_id: string;
  razon: string;
  duracion: BlacklistDuracion;
  dias?: number;
  sucursal_id?: string;
}

export interface VisitanteBasico {
  id: string;
  nombre: string;
  numero_dpi: string;
}

export interface VisitanteFrecuente {
  id: string;
  nombre: string;
  numero_dpi: string;
  placa: string | null;
  ultima_visita: string | null;
}

export const buscarVisitantesPorDpi = async (dpi: string): Promise<VisitanteBasico[]> => {
  if (dpi.length < 3) return [];
  const res = await apiFetch(
    `${BASE_URL}/api/visitantes?dpi=${encodeURIComponent(dpi)}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return [];
  return res.json() as Promise<VisitanteBasico[]>;
};

export const buscarVisitantesFrecuentes = async (
  q: string,
  residente_id?: string
): Promise<VisitanteFrecuente[]> => {
  if (q.length < 4) return [];
  const url = new URL(`${BASE_URL}/api/visitantes/buscar`);
  url.searchParams.set('q', q);
  if (residente_id) url.searchParams.set('residente_id', residente_id);
  const res = await apiFetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json() as Promise<VisitanteFrecuente[]>;
};

export const getBlacklist = async (): Promise<Blacklist[]> => {
  const res = await apiFetch(`${BASE_URL}/api/blacklist`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar blacklist');
  return res.json() as Promise<Blacklist[]>;
};

export const createBlacklist = async (data: BlacklistInput): Promise<Blacklist> => {
  const res = await apiFetch(`${BASE_URL}/api/blacklist`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al agregar a blacklist');
  return body as Blacklist;
};

export const deleteBlacklist = async (id: string): Promise<void> => {
  const res = await apiFetch(`${BASE_URL}/api/blacklist/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Error al remover de blacklist');
  }
};

/** @deprecated alias de createBlacklist */
export const addToBlacklist = createBlacklist;
/** @deprecated alias de deleteBlacklist */
export const removeFromBlacklist = deleteBlacklist;

// ── Anuncios ──────────────────────────────────────────────────────────────

export type AnuncioPrioridad = 'normal' | 'importante' | 'urgente';

export interface Anuncio {
  id: string;
  sucursal_id: string;
  titulo: string;
  contenido: string;
  prioridad: AnuncioPrioridad;
  vigente_desde: string;
  vigente_hasta: string | null;
  creado_por: string;
  created_at: string;
  sucursal_nombre: string;
  creado_por_nombre: string;
  total_lecturas: number;
}

export interface AnuncioInput {
  titulo: string;
  contenido: string;
  prioridad: AnuncioPrioridad;
  vigente_desde?: string | null;
  vigente_hasta?: string | null;
  sucursal_id?: string;
}

export interface MiAnuncio {
  id: string;
  titulo: string;
  contenido: string;
  prioridad: AnuncioPrioridad;
  vigente_desde: string;
  vigente_hasta: string | null;
  created_at: string;
  leido: boolean;
  leido_at: string | null;
}

export const getAnuncios = async (): Promise<Anuncio[]> => {
  const res = await apiFetch(`${BASE_URL}/api/anuncios`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar anuncios');
  return res.json() as Promise<Anuncio[]>;
};

export const createAnuncio = async (data: AnuncioInput): Promise<Anuncio> => {
  const res = await apiFetch(`${BASE_URL}/api/anuncios`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al crear anuncio');
  return body as Anuncio;
};

export const updateAnuncio = async (
  id: string,
  data: Partial<AnuncioInput>
): Promise<Anuncio> => {
  const res = await apiFetch(`${BASE_URL}/api/anuncios/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al actualizar anuncio');
  return body as Anuncio;
};

export const deleteAnuncio = async (id: string): Promise<void> => {
  const res = await apiFetch(`${BASE_URL}/api/anuncios/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Error al eliminar anuncio');
  }
};

export const getMisAnuncios = async (): Promise<MiAnuncio[]> => {
  const res = await apiFetch(`${BASE_URL}/api/anuncios/mis`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar anuncios');
  return res.json() as Promise<MiAnuncio[]>;
};

export const marcarAnuncioLeido = async (id: string): Promise<void> => {
  const res = await apiFetch(`${BASE_URL}/api/anuncios/${encodeURIComponent(id)}/leer`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Error al marcar como leído');
  }
};

/** alias del ticket */
export const marcarLeido = marcarAnuncioLeido;

// ── Tickets (chat interno) ──────────────────────────────────────────────────

export type TicketTipo   = 'mantenimiento' | 'queja' | 'seguridad' | 'otro';
export type TicketEstado = 'abierto' | 'en_proceso' | 'cerrado';

export interface Ticket {
  id: string;
  sucursal_id: string;
  residente_id: string;
  tipo: TicketTipo;
  titulo: string;
  estado: TicketEstado;
  created_at: string;
  updated_at: string;
  ultimo_mensaje: string | null;
  ultimo_mensaje_at: string | null;
  no_leidos: number;
  numero_casa?: string;
  residente_nombre?: string;
}

export interface TicketMensaje {
  id: string;
  ticket_id: string;
  autor_id: string;
  mensaje: string;
  created_at: string;
  leido_admin: boolean;
  leido_residente: boolean;
  autor_nombre: string;
  autor_rol: string;
}

export interface TicketInput {
  tipo: TicketTipo;
  titulo: string;
  mensaje: string;
}

export const getMisTickets = async (): Promise<Ticket[]> => {
  const res = await apiFetch(`${BASE_URL}/api/tickets/mis`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar tickets');
  return res.json() as Promise<Ticket[]>;
};

export const getTickets = async (): Promise<Ticket[]> => {
  const res = await apiFetch(`${BASE_URL}/api/tickets`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar tickets');
  return res.json() as Promise<Ticket[]>;
};

export const createTicket = async (data: TicketInput): Promise<Ticket> => {
  const res = await apiFetch(`${BASE_URL}/api/tickets`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al crear ticket');
  return body as Ticket;
};

export const getTicketMensajes = async (
  id: string
): Promise<{ ticket: Ticket; mensajes: TicketMensaje[] }> => {
  const res = await apiFetch(`${BASE_URL}/api/tickets/${encodeURIComponent(id)}/mensajes`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Error al cargar el chat');
  return res.json() as Promise<{ ticket: Ticket; mensajes: TicketMensaje[] }>;
};

export const addTicketMensaje = async (id: string, mensaje: string): Promise<TicketMensaje> => {
  const res = await apiFetch(`${BASE_URL}/api/tickets/${encodeURIComponent(id)}/mensajes`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ mensaje }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al enviar mensaje');
  return body as TicketMensaje;
};

export const cerrarTicket = async (id: string): Promise<Ticket> => {
  const res = await apiFetch(`${BASE_URL}/api/tickets/${encodeURIComponent(id)}/cerrar`, {
    method: 'PUT',
    headers: authHeaders(),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al cerrar ticket');
  return body as Ticket;
};

// ── Cargos Programados ────────────────────────────────────────────────────

export class PeriodConflictError extends Error {
  ultimo_aplicado: string | null;
  constructor(message: string, ultimo_aplicado: string | null) {
    super(message);
    this.name = 'PeriodConflictError';
    this.ultimo_aplicado = ultimo_aplicado;
  }
}

export interface CargoProgramado {
  id: string;
  sucursal_id: string;
  nombre: string;
  descripcion: string | null;
  monto: string;
  frecuencia: 'mensual' | 'quincenal' | 'unica_vez';
  aplica_a: 'todos' | 'individual';
  activo: boolean;
  ultimo_aplicado: string | null;
  creado_por: string;
  created_at: string;
  veces_aplicado: number;
  residentes_afectados: number;
}

export interface CargoProgramadoInput {
  nombre: string;
  descripcion?: string;
  monto: number;
  frecuencia?: 'mensual' | 'quincenal' | 'unica_vez';
  aplica_a?: 'todos' | 'individual';
}

export interface HistorialAplicacion {
  applied_at: string;
  residentes: number;
  monto_total: string;
  aplicado_por_nombre: string;
}

export interface AplicarCargoResult {
  aplicado_a: number;
  monto_total: string;
}

export const getCargosProgramados = async (): Promise<CargoProgramado[]> => {
  const res = await apiFetch(`${BASE_URL}/api/cargos-programados`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar cargos programados');
  return res.json() as Promise<CargoProgramado[]>;
};

export const createCargoProgramado = async (data: CargoProgramadoInput): Promise<CargoProgramado> => {
  const res = await apiFetch(`${BASE_URL}/api/cargos-programados`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al crear cargo programado');
  return body as CargoProgramado;
};

export const updateCargoProgramado = async (
  id: string,
  data: Partial<CargoProgramadoInput & { activo: boolean }>
): Promise<CargoProgramado> => {
  const res = await apiFetch(`${BASE_URL}/api/cargos-programados/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al actualizar cargo');
  return body as CargoProgramado;
};

export const deleteCargoProgramado = async (id: string): Promise<void> => {
  const res = await apiFetch(`${BASE_URL}/api/cargos-programados/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Error al eliminar cargo');
  }
};

export const aplicarCargoProgramado = async (id: string): Promise<AplicarCargoResult> => {
  const res = await apiFetch(`${BASE_URL}/api/cargos-programados/${encodeURIComponent(id)}/aplicar`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const body = await res.json();
  if (res.status === 409) {
    throw new PeriodConflictError(
      (body as { error?: string }).error || 'Este cargo ya fue aplicado en el periodo actual',
      (body as { ultimo_aplicado?: string | null }).ultimo_aplicado ?? null
    );
  }
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al aplicar cargo');
  return body as AplicarCargoResult;
};

export const getHistorialCargo = async (id: string): Promise<HistorialAplicacion[]> => {
  const res = await apiFetch(
    `${BASE_URL}/api/cargos-programados/${encodeURIComponent(id)}/historial`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new Error('Error al cargar historial');
  return res.json() as Promise<HistorialAplicacion[]>;
};

// ── Audit Logs ────────────────────────────────────────────────────────────

export interface AuditLog {
  id: string;
  created_at: string;
  usuario_nombre: string | null;
  usuario_email: string | null;
  accion: string;
  tabla_afectada: string | null;
  ip_address: string | null;
  sucursal_id: string | null;
}

export const getAuditLogs = async (params: {
  limit?: number;
  offset?: number;
  accion?: string;
  usuario_id?: string;
  desde?: string;
  hasta?: string;
}): Promise<{ logs: AuditLog[]; total: number }> => {
  const url = new URL(`${BASE_URL}/api/audit-logs`);
  if (params.limit  !== undefined) url.searchParams.set('limit',  String(params.limit));
  if (params.offset !== undefined) url.searchParams.set('offset', String(params.offset));
  if (params.accion)     url.searchParams.set('accion',     params.accion);
  if (params.usuario_id) url.searchParams.set('usuario_id', params.usuario_id);
  if (params.desde)      url.searchParams.set('desde',      params.desde);
  if (params.hasta)      url.searchParams.set('hasta',      params.hasta);

  const res = await apiFetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar logs de auditoría');
  return res.json() as Promise<{ logs: AuditLog[]; total: number }>;
};


// ── Reservas de áreas comunes ─────────────────────────────────────────────

export type TarifaTipo = 'gratis' | 'por_hora' | 'unica';

export type EstadoReserva =
  | 'pendiente_aprobacion'
  | 'confirmada'
  | 'cancelada'
  | 'rechazada'
  | 'completada';

export interface AreaComun {
  id: string;
  sucursal_id: string;
  nombre: string;
  descripcion: string | null;
  imagen_url: string | null;
  tarifa_tipo: TarifaTipo;
  tarifa_monto: string;
  requiere_aprobacion: boolean | null;
  activa: boolean;
  created_at: string;
  reservas_activas?: string;
}

export interface AreaComunInput {
  nombre: string;
  descripcion?: string | null;
  imagen_url?: string | null;
  tarifa_tipo: TarifaTipo;
  tarifa_monto: number;
  requiere_aprobacion?: boolean | null;
  activa?: boolean;
  sucursal_id?: string;
}

export interface ConfigReservas {
  sucursal_id: string;
  permite_cancelacion: boolean;
  horas_limite_cancelacion_completa: number;
  horas_limite_cancelacion_parcial: number;
  porcentaje_reembolso_parcial: number | string;
  max_reservas_activas_por_residente: number | null;
  requiere_aprobacion_admin: boolean;
  buffer_minutos_entre_reservas: number;
  buffer_motivo: string | null;
  es_default?: boolean;
}

export interface OcupadoSlot {
  id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  estado: EstadoReserva;
  bloqueo_desde: string;
  bloqueo_hasta: string;
}

export interface Disponibilidad {
  area: { id: string; nombre: string; activa: boolean; tarifa_tipo: TarifaTipo; tarifa_monto: string };
  fecha: string;
  buffer_minutos: number;
  buffer_motivo: string | null;
  ocupados: OcupadoSlot[];
}

export interface Reserva {
  id: string;
  area_id: string;
  residente_id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  estado: EstadoReserva;
  cargo_id: string | null;
  monto_cargo: string;
  motivo_cancelacion: string | null;
  reembolso_aplicado: string | null;
  created_at: string;
  area_nombre?: string;
  imagen_url?: string | null;
  tarifa_tipo?: TarifaTipo;
  cargo_monto?: string | null;
  cargo_estado?: string | null;
  numero_casa?: string;
  residente_nombre?: string;
  es_futura?: boolean;
  monto?: number;
  requiere_aprobacion?: boolean;
}

export interface PreviewCancelacion {
  reserva_id: string;
  estado: EstadoReserva;
  permite_cancelacion: boolean;
  cancelable: boolean;
  horas_restantes: number;
  reembolso_aplicado: number;
  monto_cargo: number;
  monto_reembolso: number;
  horas_limite_cancelacion_completa: number;
  horas_limite_cancelacion_parcial: number;
}

export interface ResumenMesItem {
  id: string;
  concepto: string | null;
  monto: string;
  metodo: string;
  estado: string;
  fecha_pago: string;
  reserva_id: string | null;
  area_nombre: string | null;
  reserva_fecha: string | null;
}

export interface ResumenMes {
  periodo: string;
  items: ResumenMesItem[];
  total_pendiente: number;
  saldo_pendiente: number;
  estado_pago: string;
}

// Áreas

export const getAreas = async (soloActivas = false): Promise<AreaComun[]> => {
  const url = new URL(`${BASE_URL}/api/areas`);
  if (soloActivas) url.searchParams.set('activa', 'true');
  const res = await apiFetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar áreas comunes');
  return res.json() as Promise<AreaComun[]>;
};

export const createArea = async (data: AreaComunInput): Promise<AreaComun> => {
  const res = await apiFetch(`${BASE_URL}/api/areas`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al crear el área');
  return body as AreaComun;
};

export const updateArea = async (id: string, data: Partial<AreaComunInput>): Promise<AreaComun> => {
  const res = await apiFetch(`${BASE_URL}/api/areas/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al actualizar el área');
  return body as AreaComun;
};

export const deleteArea = async (id: string): Promise<void> => {
  const res = await apiFetch(`${BASE_URL}/api/areas/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Error al eliminar el área');
  }
};

// Configuración

export const getConfigReservas = async (): Promise<ConfigReservas> => {
  const res = await apiFetch(`${BASE_URL}/api/config-reservas`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar la configuración de reservas');
  return res.json() as Promise<ConfigReservas>;
};

export const updateConfigReservas = async (
  data: Partial<ConfigReservas>
): Promise<ConfigReservas> => {
  const res = await apiFetch(`${BASE_URL}/api/config-reservas`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al guardar la configuración');
  return body as ConfigReservas;
};

// Reservas

export const getDisponibilidad = async (
  area_id: string,
  fecha: string
): Promise<Disponibilidad> => {
  const url = new URL(`${BASE_URL}/api/reservas/disponibilidad`);
  url.searchParams.set('area_id', area_id);
  url.searchParams.set('fecha', fecha);
  const res = await apiFetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar la disponibilidad');
  return res.json() as Promise<Disponibilidad>;
};

export const crearReserva = async (data: {
  area_id: string; fecha: string; hora_inicio: string; hora_fin: string;
}): Promise<Reserva> => {
  const res = await apiFetch(`${BASE_URL}/api/reservas`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al crear la reserva');
  return body as Reserva;
};

export const getMisReservas = async (): Promise<Reserva[]> => {
  const res = await apiFetch(`${BASE_URL}/api/reservas/mis-reservas`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar tus reservas');
  return res.json() as Promise<Reserva[]>;
};

export const getReservas = async (filtros: {
  area_id?: string; estado?: string; fecha_desde?: string; fecha_hasta?: string;
} = {}): Promise<Reserva[]> => {
  const url = new URL(`${BASE_URL}/api/reservas`);
  if (filtros.area_id)    url.searchParams.set('area_id',     filtros.area_id);
  if (filtros.estado)     url.searchParams.set('estado',      filtros.estado);
  if (filtros.fecha_desde) url.searchParams.set('fecha_desde', filtros.fecha_desde);
  if (filtros.fecha_hasta) url.searchParams.set('fecha_hasta', filtros.fecha_hasta);
  const res = await apiFetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar reservas');
  return res.json() as Promise<Reserva[]>;
};

export const getPreviewCancelacion = async (id: string): Promise<PreviewCancelacion> => {
  const res = await apiFetch(
    `${BASE_URL}/api/reservas/${encodeURIComponent(id)}/preview-cancelacion`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new Error('Error al calcular el reembolso');
  return res.json() as Promise<PreviewCancelacion>;
};

export const aprobarReserva = async (id: string): Promise<Reserva> => {
  const res = await apiFetch(`${BASE_URL}/api/reservas/${encodeURIComponent(id)}/aprobar`, {
    method: 'PATCH', headers: authHeaders(),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al aprobar la reserva');
  return body as Reserva;
};

export const rechazarReserva = async (id: string, motivo?: string): Promise<Reserva> => {
  const res = await apiFetch(`${BASE_URL}/api/reservas/${encodeURIComponent(id)}/rechazar`, {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ motivo: motivo ?? null }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al rechazar la reserva');
  return body as Reserva;
};

export const cancelarReserva = async (id: string, motivo?: string): Promise<Reserva> => {
  const res = await apiFetch(`${BASE_URL}/api/reservas/${encodeURIComponent(id)}/cancelar`, {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ motivo: motivo ?? null }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al cancelar la reserva');
  return body as Reserva;
};

// Resumen de la factura del mes (residente)

export const getMiResumenMes = async (): Promise<ResumenMes> => {
  const res = await apiFetch(`${BASE_URL}/api/pagos/mi-resumen`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar el resumen del mes');
  return res.json() as Promise<ResumenMes>;
};
