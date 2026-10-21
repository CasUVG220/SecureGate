// URL base del backend: ver services/baseUrl.ts (módulo aparte para que el landing no cargue este archivo).
import { resolveBaseUrl } from './baseUrl';

const BASE_URL = resolveBaseUrl();

const getToken = (): string => localStorage.getItem('token') || '';

const authHeaders = (): HeadersInit => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${getToken()}`,
});

// ── Empresa suspendida / de baja ─────────────────────────────────────────
// El backend responde 423 en login, refresh y licencias cuando la empresa del
// usuario está suspendida (owner) o dada de baja. El aviso se muestra en la
// pantalla de acceso; nadie de esa empresa entra hasta que se levante.

export const HTTP_BLOQUEO = 423;
export const BLOQUEO_KEY = 'sg_bloqueo';

export interface BloqueoEmpresa {
  codigo: 'empresa_suspendida' | 'empresa_inactiva';
  empresa: string;
  motivo: string | null;
  desde: string | null;
  error: string;
}

export class EmpresaBloqueadaError extends Error {
  bloqueo: BloqueoEmpresa;
  constructor(b: BloqueoEmpresa) {
    super(b.error);
    this.name = 'EmpresaBloqueadaError';
    this.bloqueo = b;
  }
}

const guardarBloqueo = (b: Partial<BloqueoEmpresa>): void => {
  try { localStorage.setItem(BLOQUEO_KEY, JSON.stringify(b)); } catch { /* sin storage no se recuerda */ }
};

/** Lee y borra el aviso guardado por un refresh rechazado (una sola vez). */
export const tomarBloqueoGuardado = (): BloqueoEmpresa | null => {
  try {
    const raw = localStorage.getItem(BLOQUEO_KEY);
    if (!raw) return null;
    localStorage.removeItem(BLOQUEO_KEY);
    return JSON.parse(raw) as BloqueoEmpresa;
  } catch {
    return null;
  }
};

// ── Sesión cerrada por seguridad (S-06) ───────────────────────────────────
// Si un refresh token ya usado se presenta otra vez, el servidor cierra la sesión entera y responde
// `sesion_comprometida`. Quien la pierde llega a la pantalla de acceso: sin una explicación creería que es un fallo.

export const AVISO_SESION_KEY = 'sg_aviso_sesion';

/** Lee y borra el aviso de «sesión cerrada por seguridad» (una sola vez). */
export const tomarAvisoSesionGuardado = (): 'sesion_comprometida' | null => {
  try {
    const raw = localStorage.getItem(AVISO_SESION_KEY);
    if (!raw) return null;
    localStorage.removeItem(AVISO_SESION_KEY);
    return raw === 'sesion_comprometida' ? raw : null;
  } catch {
    return null;
  }
};

// ── Auth helpers ──────────────────────────────────────────────────────────

export const refreshToken = async (): Promise<string | null> => {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.status === HTTP_BLOQUEO) {
      // La empresa fue suspendida con la sesión abierta: se guarda el aviso
      // para que la pantalla de acceso lo muestre al volver.
      const body = await res.json().catch(() => ({})) as Partial<BloqueoEmpresa>;
      guardarBloqueo(body);
      return null;
    }
    if (res.status === 401) {
      const body = await res.json().catch(() => ({})) as { codigo?: string };
      if (body.codigo === 'sesion_comprometida') {
        try { localStorage.setItem(AVISO_SESION_KEY, 'sesion_comprometida'); } catch { /* sin storage no se recuerda */ }
      }
      return null;
    }
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
  /** Qué coincidió con la lista negra: el DPI del visitante o la placa del vehículo. */
  motivo: 'dpi' | 'placa';
  constructor(razon: string, fecha_fin: string | null, motivo: 'dpi' | 'placa' = 'dpi') {
    super(motivo === 'placa' ? 'Vehículo en lista negra' : 'Visitante en lista negra');
    this.name = 'BlacklistDenialError';
    this.razon = razon;
    this.fecha_fin = fecha_fin;
    this.motivo = motivo;
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
      const b = body as { razon: string; fecha_fin?: string | null; motivo?: 'dpi' | 'placa' };
      throw new BlacklistDenialError(b.razon, b.fecha_fin ?? null, b.motivo === 'placa' ? 'placa' : 'dpi');
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
 * La contraseña fue correcta pero la cuenta tiene la verificación en dos pasos: todavía NO hay sesión. El `desafio`
 * (válido 5 minutos) se canjea por la sesión en `verificarDosPasos` junto con el código (SCRUM-123).
 */
export interface DesafioDosPasos { requiere_2fa: true; desafio: string }

/**
 * Inicia sesión contra un portal concreto. El backend rechaza las credenciales
 * que no pertenecen a ese portal: un residente no entra por el de personal ni
 * al revés. Si la cuenta tiene la verificación en dos pasos activa responde un
 * `DesafioDosPasos` en vez de la sesión (`'requiere_2fa' in resultado`).
 */
export const login = async (
  email: string,
  password: string,
  portal?: 'personal' | 'residente',
): Promise<LoginResult | DesafioDosPasos> => {
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
    if (res.status === HTTP_BLOQUEO) {
      throw new EmpresaBloqueadaError(body as BloqueoEmpresa);
    }
    throw new Error(body.error || 'Credenciales incorrectas');
  }
  return body;
};

// ── Verificación en dos pasos (SCRUM-123) ─────────────────────────────────

/**
 * Error de una operación de dos pasos. `codigo` es el que manda el backend (`CODIGO_INCORRECTO`, `BLOQUEADO`,
 * `PASSWORD_INCORRECTA`, `DESAFIO_INVALIDO`, `YA_ACTIVA`…) para que la pantalla muestre el texto en el idioma elegido;
 * `espera_s` viene cuando la persona quedó bloqueada por demasiados intentos.
 */
export class DosPasosError extends Error {
  codigo: string;
  status: number;
  espera_s?: number;

  constructor(mensaje: string, codigo: string, status: number, espera_s?: number) {
    super(mensaje);
    this.name = 'DosPasosError';
    this.codigo = codigo;
    this.status = status;
    this.espera_s = espera_s;
  }
}

const errorDeDosPasos = async (res: Response, respaldo: string): Promise<DosPasosError> => {
  const body = await res.json().catch(() => ({})) as { error?: string; codigo?: string; espera_s?: number };
  return new DosPasosError(body.error || respaldo, body.codigo ?? '', res.status, body.espera_s);
};

/** Segundo paso del acceso: canjea el desafío del login y un código (de la app o de recuperación) por la sesión. */
export const verificarDosPasos = async (desafio: string, codigo: string): Promise<LoginResult> => {
  const res = await fetch(`${BASE_URL}/api/auth/2fa/verificar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ desafio, codigo }),
  });
  if (res.status === HTTP_BLOQUEO) throw new EmpresaBloqueadaError(await res.json() as BloqueoEmpresa);
  if (!res.ok) throw await errorDeDosPasos(res, 'No se pudo verificar el código');
  return res.json() as Promise<LoginResult>;
};

export interface DosPasosEstado {
  activado: boolean;
  activado_en: string | null;
  codigos_restantes: number;
}

const llamarDosPasos = async <T,>(ruta: string, metodo: 'GET' | 'POST', cuerpo?: object, respaldo = 'No se pudo completar la operación'): Promise<T> => {
  const res = await apiFetch(`${BASE_URL}/api/auth/2fa/${ruta}`, {
    method: metodo,
    headers: authHeaders(),
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
  if (!res.ok) throw await errorDeDosPasos(res, respaldo);
  return res.json() as Promise<T>;
};

export const getDosPasosEstado = (): Promise<DosPasosEstado> =>
  llamarDosPasos<DosPasosEstado>('estado', 'GET', undefined, 'No se pudo consultar la verificación en dos pasos');

/** Empieza la configuración: entrega el secreto (para escribirlo a mano) y la URL `otpauth://` que se dibuja como QR. */
export const iniciarDosPasos = (): Promise<{ secreto: string; otpauth_url: string }> =>
  llamarDosPasos('iniciar', 'POST', {}, 'No se pudo iniciar la verificación en dos pasos');

/**
 * Activa con la contraseña y el primer código de la app (la contraseña se pide como para desactivarla: re-autenticación ante
 * un cambio de seguridad de la cuenta). Devuelve los códigos de recuperación: se muestran UNA vez.
 */
export const confirmarDosPasos = async (codigo: string, password: string): Promise<string[]> =>
  (await llamarDosPasos<{ codigos_recuperacion: string[] }>('confirmar', 'POST', { codigo, password }, 'No se pudo activar')).codigos_recuperacion;

export const desactivarDosPasos = async (password: string, codigo: string): Promise<void> => {
  await llamarDosPasos('desactivar', 'POST', { password, codigo }, 'No se pudo desactivar');
};

/** Códigos de recuperación nuevos; los anteriores dejan de valer. Pide un código de la app. */
export const regenerarCodigosRecuperacion = async (codigo: string): Promise<string[]> =>
  (await llamarDosPasos<{ codigos_recuperacion: string[] }>('codigos-recuperacion', 'POST', { codigo }, 'No se pudieron generar los códigos')).codigos_recuperacion;

/** Un superior borra el segundo factor de quien perdió el teléfono y los códigos; le cierra las sesiones. */
export const restablecerDosPasos = async (usuarioId: string): Promise<void> => {
  const res = await apiFetch(`${BASE_URL}/api/usuarios/${usuarioId}/2fa`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw await errorDeDosPasos(res, 'No se pudo restablecer la verificación en dos pasos');
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
/** La pasarela rechazó la tarjeta (HTTP 402). No es un pago: el servidor no lo guarda. */
export class PagoRechazadoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'PagoRechazadoError';
  }
}

export const pagarConTarjeta = async (data: PagoTarjetaInput): Promise<Pago> => {
  const res = await apiFetch(`${BASE_URL}/api/pagos/tarjeta`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 402) {
    throw new PagoRechazadoError((body as { error?: string }).error || 'Pago rechazado');
  }
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al procesar el pago');
  return body as Pago;
};

export interface EstadoTarjeta {
  /** El cobro con tarjeta está habilitado en este servidor. */
  disponible: boolean;
  /** La pasarela es la de prueba: solo entonces se muestran los avisos de «pago simulado». */
  simulada: boolean;
}

/**
 * Pregunta al servidor si hay pasarela y si es simulada. Si la consulta falla se asume que
 * SÍ hay pasarela y que NO es simulada: no se esconde el botón por un fallo de red (el
 * servidor responde con su propio mensaje si no está disponible) ni se muestra un aviso de
 * «entorno de prueba» sin saberlo.
 */
export const getEstadoTarjeta = async (): Promise<EstadoTarjeta> => {
  try {
    const res = await apiFetch(`${BASE_URL}/api/pagos/tarjeta/estado`, { headers: authHeaders() });
    if (!res.ok) throw new Error('estado');
    return await res.json() as EstadoTarjeta;
  } catch {
    return { disponible: true, simulada: false };
  }
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
  /** Residentes registrados en el alcance; en 0 el panel enseña los primeros pasos. */
  total_residentes?: number;
  pagos_pendientes: number;
  /** Reservas en estado «pendiente de aprobación» dentro del alcance del usuario. */
  reservas_pendientes?: number;
  accesos_recientes: Array<{
    id: string;
    /** El visitante o, en una entrada por placas, el residente. */
    nombre_visitante: string;
    numero_casa: string;
    timestamp_entrada: string;
    timestamp_salida: string | null;
    /** Sprint 10: cómo se capturó (las entradas por placas son `anpr`). Ausentes en un backend anterior. */
    metodo?: MetodoAcceso;
    es_residente?: boolean;
    verificado?: boolean;
    placa?: string | null;
  }>;
  /** Accesos de hoy por hora (24 posiciones, 0 = medianoche). */
  accesos_por_hora: number[];
  /** Accesos de ayer hasta esta misma hora: la referencia justa para "hoy". */
  accesos_ayer_misma_hora: number;
  /** Entradas sin salida de las últimas 24 h. */
  dentro_ahora: number;
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

/**
 * Descarga un CSV autenticado. Rechaza si el backend responde con error: antes
 * el fallo se tragaba en silencio y la pantalla decía "descargado" sin archivo.
 */
const downloadCSV = async (url: string, filename: string): Promise<void> => {
  const res = await apiFetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || 'No se pudo generar el reporte');
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
};

export const downloadReporteAccesos = (desde: string, hasta: string): Promise<void> =>
  downloadCSV(
    `${BASE_URL}/api/reportes/accesos?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
    `accesos_${desde}_${hasta}.csv`
  );

export const downloadReportePagos = (desde: string, hasta: string): Promise<void> =>
  downloadCSV(
    `${BASE_URL}/api/reportes/pagos?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
    `pagos_${desde}_${hasta}.csv`
  );

// ── Estadísticas (Análisis) ───────────────────────────────────────────────

export interface MontoConteo { cantidad: number; monto: number }

export interface Estadisticas {
  periodo: {
    desde: string;
    hasta: string;
    dias: number;
    anterior: { desde: string; hasta: string };
  };
  accesos: {
    total: number;
    total_anterior: number;
    visitantes_unicos: number;
    con_vehiculo: number;
    sin_salida: number;
    no_autorizados: number;
    /** Mediana de la duración de las visitas con salida, en minutos. */
    duracion_mediana_min: number | null;
    por_dia: Array<{ fecha: string; total: number }>;
    /** Alineada por posición con `por_dia`. */
    por_dia_anterior: number[];
    /** 7 filas (lunes→domingo) × 24 horas. */
    por_franja: number[][];
    top_casas: Array<{ numero_casa: string; total: number }>;
  };
  pagos: {
    recaudado: number;
    recaudado_anterior: number;
    por_estado: Record<'aprobado' | 'pendiente' | 'rechazado', MontoConteo>;
    por_metodo: Array<{ metodo: string } & MontoConteo>;
    por_dia: Array<{ fecha: string; monto: number }>;
    por_dia_anterior: number[];
  };
  cartera: { residentes: number; al_dia: number; pendiente: number; mora: number; saldo_pendiente: number };
  solicitudes: {
    total: number;
    por_estado: Record<'abierto' | 'en_proceso' | 'cerrado', number>;
    por_tipo: Array<{ tipo: string; total: number }>;
  };
  reservas: {
    total: number;
    por_estado: Record<'pendiente_aprobacion' | 'confirmada' | 'completada' | 'cancelada' | 'rechazada', number>;
    cargos: number;
    top_areas: Array<{ area: string; total: number }>;
  };
}

export const getEstadisticas = async (desde: string, hasta: string, signal?: AbortSignal): Promise<Estadisticas> => {
  const res = await apiFetch(
    `${BASE_URL}/api/reportes/estadisticas?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
    { headers: authHeaders(), signal }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || 'Error al cargar estadísticas');
  }
  return res.json();
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
  /** Pausa reversible decidida por el owner (impago, incumplimiento). */
  suspendida: boolean;
  suspension_motivo: string | null;
  suspendida_en: string | null;
  created_at: string;
  total_sucursales: number;
  /** Hay un administrador de empresa activo. Ausente en respuestas de servidores anteriores. */
  tiene_admin?: boolean;
  /** Hay una invitación de administrador vigente (aún sin aceptar). */
  invitacion_pendiente?: boolean;
}

export const suspenderEmpresa = async (id: string, motivo: string): Promise<Empresa> => {
  const res = await apiFetch(`${BASE_URL}/api/empresas/${id}/suspender`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ motivo }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al suspender la empresa');
  return body as Empresa;
};

/**
 * Borrado físico e irreversible de la empresa y todo lo que cuelga de ella.
 * Exige la contraseña del owner; el backend la comprueba y limita intentos.
 */
export const eliminarEmpresaDefinitivo = async (id: string, password: string): Promise<{ nombre: string; eliminado: Record<string, number> }> => {
  const res = await apiFetch(`${BASE_URL}/api/empresas/${id}/eliminar-definitivo`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al eliminar la empresa');
  return body as { nombre: string; eliminado: Record<string, number> };
};

export const reactivarEmpresa = async (id: string): Promise<Empresa> => {
  const res = await apiFetch(`${BASE_URL}/api/empresas/${id}/reactivar`, { method: 'PATCH', headers: authHeaders() });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al reactivar la empresa');
  return body as Empresa;
};

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
  /** Hay un administrador de sucursal activo. */
  tiene_admin?: boolean;
  /** Hay una invitación de administrador vigente (aún sin aceptar). */
  invitacion_pendiente?: boolean;
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
  /** Tiene la verificación en dos pasos activada (sólo la lista de administración lo informa). */
  dos_pasos?: boolean;
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

export interface UsuarioCambios {
  nombre?: string;
  email?: string;
  /** Solo `agente` o `admin_sucursal`. */
  rol?: string;
  /** Opcional: vacío o ausente conserva la contraseña actual. */
  password?: string;
}

/** Edita a un usuario del personal. Alcance y reglas: backend `updateUsuario`. */
export const updateUsuario = async (id: string, cambios: UsuarioCambios): Promise<Usuario> => {
  const res = await apiFetch(`${BASE_URL}/api/usuarios/${id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(cambios),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al editar usuario');
  return body as Usuario;
};

/** Baja lógica: el usuario deja de poder entrar y se le cierran las sesiones. */
export const desactivarUsuario = async (id: string): Promise<void> => {
  const res = await apiFetch(`${BASE_URL}/api/usuarios/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Error al dar de baja al usuario');
  }
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
  /** Vacíos cuando se bloqueó solo un vehículo (placa) sin visitante conocido. */
  visitante_id: string | null;
  visitante_nombre: string | null;
  numero_dpi: string | null;
  /** Placa normalizada (P123ABC) si el bloqueo es por vehículo. */
  placa: string | null;
  sucursal_nombre: string;
  creado_por_nombre: string;
}

/** @deprecated alias de Blacklist */
export type BlacklistEntry = Blacklist;

export type BlacklistDuracion = 'temporal_dias' | '30_dias' | 'indefinido';

export interface BlacklistInput {
  /** Se necesita `visitante_id` o `placa` (o las dos). */
  visitante_id?: string;
  placa?: string;
  razon: string;
  duracion: BlacklistDuracion;
  dias?: number;
  sucursal_id?: string;
}

export interface VisitanteBasico {
  id: string;
  nombre: string;
  numero_dpi: string;
  /** Presente al buscar por placa: el vehículo que coincidió. */
  placa?: string | null;
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

/** «Buscar visitante por DPI o placa»: la placa se compara sin guiones ni espacios y sin importar mayúsculas. */
export const buscarVisitantesPorPlaca = async (placa: string): Promise<VisitanteBasico[]> => {
  if (placa.replace(/[^A-Za-z0-9]/g, '').length < 3) return [];
  const res = await apiFetch(
    `${BASE_URL}/api/visitantes?placa=${encodeURIComponent(placa)}`,
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
  /** Residentes que ya lo abrieron. */
  total_lecturas: number;
  /** Residentes de la sucursal, que son quienes pueden verlo. Ausente en servidores anteriores. */
  total_residentes?: number;
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
  /** Aviso dirigido a este residente (no un comunicado para toda la comunidad). */
  es_personal?: boolean;
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
  registro_id?: string | null;
  ip_address: string | null;
  sucursal_id: string | null;
  /** Código HTTP con el que terminó la acción: 2xx salió bien, 429 la frenó un límite, 4xx se rechazó. */
  status_code?: number | null;
  /** Detalle: el correo intentado en un login, el límite que bloqueó, el guard que denegó… Nunca contraseñas. */
  datos_nuevos?: Record<string, unknown> | null;
}

export type AuditEstado = 'ok' | 'rechazado' | 'bloqueado' | 'error';

export const getAuditLogs = async (params: {
  limit?: number;
  offset?: number;
  accion?: string;
  usuario_id?: string;
  desde?: string;
  hasta?: string;
  /** Resultado de la acción según su código HTTP. */
  estado?: AuditEstado;
  /** Persona (nombre o correo de la cuenta) o correo intentado en un login. */
  buscar?: string;
}): Promise<{ logs: AuditLog[]; total: number }> => {
  const url = new URL(`${BASE_URL}/api/audit-logs`);
  if (params.limit  !== undefined) url.searchParams.set('limit',  String(params.limit));
  if (params.offset !== undefined) url.searchParams.set('offset', String(params.offset));
  if (params.accion)     url.searchParams.set('accion',     params.accion);
  if (params.usuario_id) url.searchParams.set('usuario_id', params.usuario_id);
  if (params.desde)      url.searchParams.set('desde',      params.desde);
  if (params.hasta)      url.searchParams.set('hasta',      params.hasta);
  if (params.estado)     url.searchParams.set('estado',     params.estado);
  if (params.buscar)     url.searchParams.set('buscar',     params.buscar);

  const res = await apiFetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar logs de auditoría');
  return res.json() as Promise<{ logs: AuditLog[]; total: number }>;
};

export interface AuditAccion { accion: string; total: number; ultima: string }

/** Acciones que existen en la bitácora (con su cantidad): llenan el filtro del panel. */
export const getAuditAcciones = async (): Promise<AuditAccion[]> => {
  const res = await apiFetch(`${BASE_URL}/api/audit-logs/acciones`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar las acciones de auditoría');
  return ((await res.json()) as { acciones: AuditAccion[] }).acciones;
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

// ── Invitaciones administrativas (owner → admin_empresa → admin_sucursal) ──
// Nada que ver con las invitaciones QR de visitantes ni con las licencias de
// la app de garita: esto crea cuentas administrativas por correo.

export type InvitacionRol = 'admin_empresa' | 'admin_sucursal';
export type InvitacionEstado = 'pendiente' | 'aceptada' | 'expirada' | 'revocada';

export interface Invitacion {
  id: string;
  email: string;
  rol_invitado: InvitacionRol;
  empresa_id: string | null;
  empresa_nombre: string | null;
  /** La invitación crea la empresa al aceptarse (owner → admin de empresa nueva). */
  crea_empresa: boolean;
  sucursal_id: string | null;
  sucursal_nombre: string | null;
  invitado_por: string;
  invitado_por_nombre: string | null;
  estado: InvitacionEstado;
  expira_en: string;
  created_at: string;
  aceptada_en: string | null;
  revocada_en: string | null;
  /** Sólo al crear o reenviar: enlace para compartir por otro canal. */
  enlace?: string;
}

export interface InvitacionInput {
  email: string;
  rol_invitado: InvitacionRol;
  empresa_id?: string;
  empresa_nombre?: string;
  sucursal_id?: string;
}

/** Vista pública de una invitación (lo que ve quien abre el enlace). */
export interface InvitacionPublica {
  email: string;
  rol_invitado: InvitacionRol;
  rol_nombre: string;
  empresa_nombre: string | null;
  crea_empresa: boolean;
  sucursal_nombre: string | null;
  expira_en: string;
}

/** Error con el status HTTP: 410 (expirada) y 409 (usada/revocada) se muestran distinto. */
export class InvitacionError extends Error {
  status: number;
  estado?: InvitacionEstado;
  constructor(mensaje: string, status: number, estado?: InvitacionEstado) {
    super(mensaje);
    this.name = 'InvitacionError';
    this.status = status;
    this.estado = estado;
  }
}

export const getInvitaciones = async (): Promise<Invitacion[]> => {
  const res = await apiFetch(`${BASE_URL}/api/invitaciones`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar invitaciones');
  return res.json() as Promise<Invitacion[]>;
};

export const crearInvitacion = async (data: InvitacionInput): Promise<Invitacion> => {
  const res = await apiFetch(`${BASE_URL}/api/invitaciones`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al crear la invitación');
  return body as Invitacion;
};

export const revocarInvitacion = async (id: string): Promise<Invitacion> => {
  const res = await apiFetch(`${BASE_URL}/api/invitaciones/${id}/revocar`, { method: 'PATCH', headers: authHeaders() });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al revocar la invitación');
  return body as Invitacion;
};

export const reenviarInvitacion = async (id: string): Promise<Invitacion> => {
  const res = await apiFetch(`${BASE_URL}/api/invitaciones/${id}/reenviar`, { method: 'POST', headers: authHeaders() });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al reenviar la invitación');
  return body as Invitacion;
};

// Públicos: sin token de sesión (quien acepta todavía no tiene cuenta).
export const getInvitacionPublica = async (token: string): Promise<InvitacionPublica> => {
  const res = await fetch(`${BASE_URL}/api/invitaciones/${encodeURIComponent(token)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new InvitacionError((body as { error?: string }).error || 'Invitación no válida', res.status, (body as { estado?: InvitacionEstado }).estado);
  }
  return body as InvitacionPublica;
};

export const aceptarInvitacion = async (token: string, data: { nombre: string; password: string }): Promise<LoginResult> => {
  const res = await fetch(`${BASE_URL}/api/invitaciones/${encodeURIComponent(token)}/aceptar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new InvitacionError((body as { error?: string }).error || 'No se pudo aceptar la invitación', res.status, (body as { estado?: InvitacionEstado }).estado);
  }
  return body as LoginResult;
};

// ── Licencias de la app de garita (Sprint 8) ───────────────────────────────
// Códigos de activación que vinculan un equipo de garita (por huella de
// hardware) a una sucursal. Nada que ver con las invitaciones por correo.

export type LicenciaEstado = 'activa' | 'revocada';

export interface Licencia {
  id: string;
  sucursal_id: string;
  sucursal_nombre: string;
  codigo_activacion: string;
  etiqueta: string | null;
  estado: LicenciaEstado;
  /** true cuando un equipo ya canjeó el código (tiene fingerprint). */
  activada: boolean;
  activado_en: string | null;
  ultimo_heartbeat: string | null;
  revocado_en: string | null;
  created_at: string;
}

export interface LicenciaInput {
  etiqueta?: string;
  /** Sólo owner / admin_empresa: el admin de sucursal la toma del JWT. */
  sucursal_id?: string;
}

export const getLicencias = async (): Promise<Licencia[]> => {
  const res = await apiFetch(`${BASE_URL}/api/licencias`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar licencias');
  return res.json() as Promise<Licencia[]>;
};

export const crearLicencia = async (data: LicenciaInput): Promise<Licencia> => {
  const res = await apiFetch(`${BASE_URL}/api/licencias`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al generar el código');
  return body as Licencia;
};

export const revocarLicencia = async (id: string): Promise<void> => {
  const res = await apiFetch(`${BASE_URL}/api/licencias/${id}/revocar`, { method: 'PATCH', headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Error al revocar la licencia');
  }
};

// ── SaaS: planes, consumo, facturas, alta autoservicio y exportación (T10–T12) ─────────────────────────
// Dinero SIEMPRE en centavos enteros (como lo devuelve el backend); se formatea solo al mostrarlo.

export type EstadoSuscripcion = 'prueba' | 'activa' | 'vencida' | 'cancelada';
export type EstadoFacturaSaas = 'pendiente' | 'pagada' | 'vencida' | 'anulada';
export type MetodoPagoSaas = 'transferencia' | 'deposito' | 'efectivo' | 'otro';

export interface PlanSaas {
  id?: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  precio_mensual_centavos: number;
  visitas_incluidas: number;
  precio_visita_extra_centavos: number;
  max_sucursales: number | null;
  max_garitas: number | null;
  dias_prueba: number;
  moneda: string;
  /** `true` = precio supuesto, todavía sin confirmar por el equipo. */
  supuesto: boolean;
}

export interface SuscripcionSaas {
  id: string;
  empresa_id: string;
  estado: EstadoSuscripcion;
  inicio_en: string;
  prueba_hasta: string | null;
  plan: PlanSaas;
}

export interface FacturaSaas {
  id: string;
  numero: number;
  numero_texto: string;
  empresa_id: string;
  empresa_nombre: string;
  periodo: string;
  plan_nombre: string;
  dias_del_mes: number;
  dias_facturados: number;
  cuota_centavos: number;
  visitas: number;
  visitas_incluidas: number;
  excedente_visitas: number;
  excedente_centavos: number;
  total_centavos: number;
  estado: EstadoFacturaSaas;
  emitida_en: string;
  vence_en: string;
  pagada_en: string | null;
  metodo_pago: MetodoPagoSaas | null;
  referencia_pago: string | null;
  detalle: { lineas: Array<{ concepto: string; cantidad: number; precio_unitario_centavos: number; monto_centavos: number }> };
}

export type PasoOnboardingId = 'empresa' | 'sucursal' | 'plan' | 'admin' | 'garita';
export interface ProgresoOnboarding {
  pasos: Array<{ id: PasoOnboardingId; hecho: boolean }>;
  completo: boolean;
  primera_sucursal_id: string | null;
}

export interface PanelEmpresa {
  empresa: { id: string; nombre: string };
  suscripcion: SuscripcionSaas | null;
  uso: { periodo: string; visitas: number; incluidas: number | null; excedente: number; excedente_centavos: number; plan: string | null; dia_del_mes: number; dias_del_mes: number };
  proyeccion: { visitas_proyectadas: number; excedente_proyectado: number; excedente_proyectado_centavos: number } | null;
  limites: { sucursales: { usadas: number; maximo: number | null }; garitas: { usadas: number; maximo: number | null } };
  facturas: FacturaSaas[];
  pendiente_centavos: number;
  facturas_vencidas: number;
  progreso: ProgresoOnboarding;
}

export interface UsoEmpresaOwner {
  empresa_id: string;
  nombre: string;
  activo: boolean;
  suspendida: boolean;
  estado: EstadoSuscripcion | null;
  plan: string | null;
  plan_nombre: string | null;
  visitas: number;
  incluidas: number | null;
  excedente: number;
  excedente_centavos: number;
  facturas_pendientes: number;
  facturas_vencidas: number;
  pendiente_centavos: number;
}

/** Lee la respuesta JSON y, si no fue exitosa, lanza el `error` que mandó el backend (o `porDefecto`). */
async function resultado<T>(res: Response, porDefecto: string): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || porDefecto);
  return body as T;
}

export const getPanelEmpresa = async (empresaId: string): Promise<PanelEmpresa> =>
  resultado(await apiFetch(`${BASE_URL}/api/empresas/${empresaId}/panel`, { headers: authHeaders() }), 'No se pudo cargar tu plan');

export const getPlanesSaas = async (): Promise<PlanSaas[]> =>
  resultado(await apiFetch(`${BASE_URL}/api/planes`, { headers: authHeaders() }), 'No se pudieron cargar los planes');

export const getUsoOwner = async (mes?: string): Promise<{ periodo: string; empresas: UsoEmpresaOwner[] }> =>
  resultado(await apiFetch(`${BASE_URL}/api/planes/uso${mes ? `?mes=${encodeURIComponent(mes)}` : ''}`, { headers: authHeaders() }), 'No se pudo cargar el consumo');

export const cambiarSuscripcion = async (
  empresaId: string, data: { plan_codigo?: string; estado?: EstadoSuscripcion; motivo?: string },
): Promise<{ suscripcion: SuscripcionSaas }> =>
  resultado(await apiFetch(`${BASE_URL}/api/empresas/${empresaId}/suscripcion`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(data) }), 'No se pudo cambiar la suscripción');

export const getFacturasSaas = async (filtro: { estado?: EstadoFacturaSaas; empresa_id?: string; periodo?: string } = {}): Promise<FacturaSaas[]> => {
  const qs = new URLSearchParams(Object.entries(filtro).filter(([, v]) => v) as Array<[string, string]>).toString();
  return resultado(await apiFetch(`${BASE_URL}/api/facturas-saas${qs ? `?${qs}` : ''}`, { headers: authHeaders() }), 'No se pudieron cargar las facturas');
};

export const pagarFacturaSaas = async (id: string, data: { metodo: MetodoPagoSaas; referencia?: string; nota?: string }): Promise<FacturaSaas> =>
  resultado(await apiFetch(`${BASE_URL}/api/facturas-saas/${id}/pagar`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(data) }), 'No se pudo marcar el pago');

export const anularFacturaSaas = async (id: string, motivo: string): Promise<FacturaSaas> =>
  resultado(await apiFetch(`${BASE_URL}/api/facturas-saas/${id}/anular`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ motivo }) }), 'No se pudo anular la factura');

export interface ResumenGeneracionFacturas { periodo: string; generadas: number; existentes: number; sin_cobro: number; errores: number; total_centavos: number }
export const generarFacturasSaas = async (mes?: string): Promise<ResumenGeneracionFacturas> =>
  resultado(await apiFetch(`${BASE_URL}/api/facturas-saas/generar`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(mes ? { mes } : {}) }), 'No se pudieron generar las facturas');

export const revisarVencidasSaas = async (): Promise<{ vencidas: number }> =>
  resultado(await apiFetch(`${BASE_URL}/api/facturas-saas/revisar-vencidas`, { method: 'POST', headers: authHeaders(), body: '{}' }), 'No se pudieron revisar los vencimientos');

/** Descarga el .zip con los datos de la empresa (el navegador lo guarda con el nombre que manda el servidor). */
export const exportarDatosEmpresa = async (empresaId: string): Promise<{ blob: Blob; nombre: string }> => {
  const res = await apiFetch(`${BASE_URL}/api/empresas/${empresaId}/exportar`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'No se pudo exportar los datos');
  }
  const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'securegate-datos.zip';
  return { blob: await res.blob(), nombre };
};

// Alta autoservicio (públicas: sin sesión). `OnboardingError.status` distingue enlace vencido (410) de uno inválido (404).
export class OnboardingError extends Error {
  status: number;
  codigo?: string;
  constructor(mensaje: string, status: number, codigo?: string) {
    super(mensaje);
    this.name = 'OnboardingError';
    this.status = status;
    this.codigo = codigo;
  }
}

async function publico<T>(res: Response, porDefecto: string): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new OnboardingError((body as { error?: string }).error || porDefecto, res.status, (body as { codigo?: string }).codigo);
  return body as T;
}
const json = { 'Content-Type': 'application/json' };

export interface BorradorOnboarding {
  empresa_nombre?: string; nit?: string | null; sucursal_nombre?: string; direccion?: string | null; tipo?: string | null; plan_codigo?: string;
}
export interface EstadoOnboarding {
  estado: 'abierta' | 'invitada';
  email: string;
  borrador: BorradorOnboarding;
  expira_en: string;
  invitacion: { estado: string; puede_reenviar: boolean } | null;
  planes: PlanSaas[];
}

export const solicitarAlta = async (data: { email: string; empresa_nombre: string; acepta_terminos: boolean; sitio_web?: string }): Promise<{ ok: boolean; mensaje: string }> =>
  publico(await fetch(`${BASE_URL}/api/onboarding/solicitar`, { method: 'POST', headers: json, body: JSON.stringify(data) }), 'No se pudo registrar la solicitud');

export const getOnboarding = async (token: string): Promise<EstadoOnboarding> =>
  publico(await fetch(`${BASE_URL}/api/onboarding/${encodeURIComponent(token)}`), 'Enlace no válido');

export const guardarBorradorOnboarding = async (token: string, data: BorradorOnboarding): Promise<{ borrador: BorradorOnboarding }> =>
  publico(await fetch(`${BASE_URL}/api/onboarding/${encodeURIComponent(token)}/borrador`, { method: 'PUT', headers: json, body: JSON.stringify(data) }), 'No se pudo guardar');

export const completarOnboarding = async (token: string): Promise<{ ok: boolean; email: string; mensaje: string }> =>
  publico(await fetch(`${BASE_URL}/api/onboarding/${encodeURIComponent(token)}/completar`, { method: 'POST', headers: json, body: '{}' }), 'No se pudo completar el alta');

export const reenviarInvitacionOnboarding = async (token: string): Promise<{ ok: boolean; mensaje: string }> =>
  publico(await fetch(`${BASE_URL}/api/onboarding/${encodeURIComponent(token)}/reenviar`, { method: 'POST', headers: json, body: '{}' }), 'No se pudo reenviar la invitación');

// ── Entradas: listado de la administración con los accesos del ANPR (Sprint 10, seguimiento) ─────────────────

/** Cómo se capturó una entrada (lo deduce el backend de columnas que ya existían). */
export type MetodoAcceso = 'manual' | 'clic' | 'qr' | 'anpr';

export interface EntradaAcceso {
  id: string;
  timestamp_entrada: string;
  timestamp_salida: string | null;
  autorizado: boolean;
  origen: string;
  metodo: MetodoAcceso;
  /** Entrada de un residente con su vehículo autorizado (por placas): no hay visitante. */
  es_residente: boolean;
  visitante_nombre: string | null;
  numero_dpi: string | null;
  numero_casa: string;
  residente_nombre: string;
  /** Placa canónica (`P123ABC`). */
  placa: string | null;
  /** Confianza del reconocimiento de placas (0–1); null en las demás. */
  confianza: number | null;
  /** Un agente confirmó la entrada por placas con un clic. */
  verificado: boolean;
  verificado_por_nombre: string | null;
  sucursal_id: string;
  sucursal_nombre: string;
  /** Para pedir la evidencia; null si no hay. */
  id_cliente: string | null;
  evidencia_placa: boolean;
  evidencia_vehiculo: boolean;
}

export interface ListadoEntradas { accesos: EntradaAcceso[]; total: number; pagina: number; por_pagina: number }

export const getEntradas = async (params: {
  metodo?: MetodoAcceso; placa?: string; desde?: string; hasta?: string; pagina?: number; por_pagina?: number;
}): Promise<ListadoEntradas> => {
  const url = new URL(`${BASE_URL}/api/accesos`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const res = await apiFetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'No se pudieron cargar las entradas');
  }
  return res.json() as Promise<ListadoEntradas>;
};

/** Recorte de la placa o del vehículo de una entrada por placas (con la misma sesión); null si ya no está (se borra a los 7 días). */
export const getEvidenciaAnpr = async (idCliente: string, tipo: 'placa' | 'vehiculo'): Promise<Blob | null> => {
  const res = await apiFetch(`${BASE_URL}/api/anpr/evidencias/${encodeURIComponent(idCliente)}/${tipo}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('No se pudo cargar la evidencia');
  return res.blob();
};

