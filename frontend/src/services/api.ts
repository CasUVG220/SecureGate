let envUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
if (envUrl.includes('localhost') && typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
  envUrl = `${window.location.protocol}//${window.location.hostname}:3000`;
}
const BASE_URL = envUrl;

const getToken = (): string => localStorage.getItem('token') || '';

const authHeaders = (): HeadersInit => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${getToken()}`,
});

export interface Residente {
  id: string;
  numero_casa: string;
  nombre: string;
  email: string;
  estado_pago: 'al_dia' | 'mora' | 'pendiente';
  saldo_pendiente: string;
}

export interface AccesoPayload {
  nombre_visitante: string;
  numero_dpi: string;
  foto?: string;
  residente_id: string;
  agente_id: string;
  placa?: string;
  notas?: string;
}

export interface AccesoResult {
  registro: Record<string, unknown>;
  visitante: Record<string, unknown>;
  cargo_generado: Record<string, unknown> | null;
}

export const getResidentes = async (): Promise<Residente[]> => {
  const res = await fetch(`${BASE_URL}/api/residentes`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar residentes');
  return res.json();
};

export const registrarAcceso = async (data: AccesoPayload): Promise<AccesoResult> => {
  const res = await fetch(`${BASE_URL}/api/accesos`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al registrar acceso');
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
  const res = await fetch(`${BASE_URL}/api/residentes`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al crear residente');
  return body;
};

export const updateResidente = async (id: string, data: ResidenteUpdate): Promise<Residente> => {
  const res = await fetch(`${BASE_URL}/api/residentes/${id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al actualizar residente');
  return body;
};

export const deleteResidente = async (id: string): Promise<void> => {
  const res = await fetch(`${BASE_URL}/api/residentes/${id}`, {
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
  usuario: { id: string; nombre: string; email: string; rol: string };
}

export const login = async (email: string, password: string): Promise<LoginResult> => {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Credenciales incorrectas');
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
  const res = await fetch(
    `${BASE_URL}/api/accesos/activo?placa=${encodeURIComponent(placa)}`,
    { headers: authHeaders() }
  );
  if (res.status === 404) return null;
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al buscar acceso activo');
  return body as AccesoActivo;
};

export const registrarSalidaVehiculo = async (
  registroId: string
): Promise<Record<string, unknown>> => {
  const res = await fetch(`${BASE_URL}/api/accesos/${encodeURIComponent(registroId)}/salida`, {
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
  metodo: 'efectivo' | 'transferencia';
  estado: 'pendiente' | 'aprobado' | 'rechazado';
  comprobante: string | null;
  registrado_por: string;
  numero_casa: string;
  residente_nombre: string;
}

export interface PagoInput {
  residente_id: string;
  monto: number;
  comprobante?: string;
}

export const getPagos = async (): Promise<Pago[]> => {
  const res = await fetch(`${BASE_URL}/api/pagos`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar pagos');
  return res.json();
};

export const createPago = async (data: PagoInput): Promise<Pago> => {
  const res = await fetch(`${BASE_URL}/api/pagos`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al crear pago');
  return body as Pago;
};

export const aprobarPago = async (id: string): Promise<Pago> => {
  const res = await fetch(`${BASE_URL}/api/pagos/${encodeURIComponent(id)}/aprobar`, {
    method: 'PUT',
    headers: authHeaders(),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al aprobar pago');
  return body as Pago;
};

export const rechazarPago = async (id: string): Promise<Pago> => {
  const res = await fetch(`${BASE_URL}/api/pagos/${encodeURIComponent(id)}/rechazar`, {
    method: 'PUT',
    headers: authHeaders(),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al rechazar pago');
  return body as Pago;
};

export interface Preautorizacion {
  id: string;
  residente_id: string;
  nombre_visitante: string;
  numero_dpi: string | null;
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
  fecha_inicio: string;
  fecha_fin?: string;
}

export const getPreautorizaciones = async (): Promise<Preautorizacion[]> => {
  const res = await fetch(`${BASE_URL}/api/preautorizaciones`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar preautorizaciones');
  return res.json();
};

export const createPreautorizacion = async (
  data: PreautorizacionInput
): Promise<Preautorizacion> => {
  const res = await fetch(`${BASE_URL}/api/preautorizaciones`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al crear preautorización');
  return body as Preautorizacion;
};

export const deletePreautorizacion = async (id: string): Promise<void> => {
  const res = await fetch(
    `${BASE_URL}/api/preautorizaciones/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: authHeaders() }
  );
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error || 'Error al eliminar preautorización');
  }
};

export const decodeTokenPayload = (token: string): Record<string, unknown> | null => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
};