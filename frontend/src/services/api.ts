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
}

export interface AccesoResult {
  registro: Record<string, unknown>;
  visitante: Record<string, unknown>;
  cargo_generado: Record<string, unknown> | null;
  preautorizado: boolean;
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
  usuario: { id: string; nombre: string; email: string; rol: string; idioma?: string; tema?: string };
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

export const rechazarPago = async (id: string, comentario_rechazo?: string): Promise<Pago> => {
  const res = await fetch(`${BASE_URL}/api/pagos/${encodeURIComponent(id)}/rechazar`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ comentario_rechazo }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al rechazar pago');
  return body as Pago;
};

export const getPendientesVerificacion = async (): Promise<PagoVerificacion[]> => {
  const res = await fetch(`${BASE_URL}/api/pagos/pendientes-verificacion`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar cola de verificación');
  return res.json();
};

export const crearTransferencia = async (data: TransferenciaInput): Promise<Pago> => {
  const res = await fetch(`${BASE_URL}/api/pagos/transferencia`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al enviar comprobante');
  return body as Pago;
};

export const getMisPagos = async (): Promise<Pago[]> => {
  const res = await fetch(`${BASE_URL}/api/pagos/mis`, { headers: authHeaders() });
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

export const getMisPreautorizaciones = async (): Promise<MiPreautorizacion[]> => {
  const res = await fetch(`${BASE_URL}/api/preautorizaciones/mis`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar preautorizaciones');
  return res.json();
};

export const createMisPreautorizacion = async (
  data: Omit<PreautorizacionInput, 'residente_id'>
): Promise<MiPreautorizacion> => {
  const res = await fetch(`${BASE_URL}/api/preautorizaciones/mis`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al crear preautorización');
  return body as MiPreautorizacion;
};

export const deleteMisPreautorizacion = async (id: string): Promise<void> => {
  const res = await fetch(
    `${BASE_URL}/api/preautorizaciones/mis/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: authHeaders() }
  );
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error || 'Error al eliminar preautorización');
  }
};

export const getMisAccesos = async (): Promise<MiVisita[]> => {
  const res = await fetch(`${BASE_URL}/api/accesos/mis`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar historial de accesos');
  return res.json();
};

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
  const res = await fetch(`${BASE_URL}/api/residentes/me`, { headers: authHeaders() });
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
  const res = await fetch(`${BASE_URL}/api/dashboard`, { headers: authHeaders() });
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
  const res = await fetch(url, { headers: authHeaders() });
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
  activo: boolean;
  created_at: string;
}

export interface ConfigCargoInput {
  nombre: string;
  monto: number;
}

export const getConfigCargos = async (): Promise<ConfigCargo[]> => {
  const res = await fetch(`${BASE_URL}/api/configuracion-cargos`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar configuraciones de cargo');
  return res.json();
};

export const createConfigCargo = async (data: ConfigCargoInput): Promise<ConfigCargo> => {
  const res = await fetch(`${BASE_URL}/api/configuracion-cargos`, {
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
  const res = await fetch(`${BASE_URL}/api/configuracion-cargos/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Error al actualizar configuración');
  return body as ConfigCargo;
};

export const deleteConfigCargo = async (id: string): Promise<void> => {
  const res = await fetch(`${BASE_URL}/api/configuracion-cargos/${encodeURIComponent(id)}`, {
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
  const res = await fetch(`${BASE_URL}/api/empresas`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar empresas');
  return res.json() as Promise<Empresa[]>;
};

export const createEmpresa = async (data: EmpresaInput): Promise<Empresa> => {
  const res = await fetch(`${BASE_URL}/api/empresas`, {
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
  const res = await fetch(`${BASE_URL}/api/empresas/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al actualizar empresa');
  return body as Empresa;
};

export const getEmpresaStats = async (id: string): Promise<EmpresaStats> => {
  const res = await fetch(
    `${BASE_URL}/api/empresas/${encodeURIComponent(id)}/stats`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new Error('Error al cargar estadísticas de empresa');
  return res.json() as Promise<EmpresaStats>;
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
  const res = await fetch(`${BASE_URL}/api/sucursales`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar sucursales');
  return res.json() as Promise<Sucursal[]>;
};

export const createSucursal = async (data: SucursalInput): Promise<Sucursal> => {
  const res = await fetch(`${BASE_URL}/api/sucursales`, {
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
  const res = await fetch(
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
  const res = await fetch(`${BASE_URL}/api/sucursales/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al actualizar sucursal');
  return body as Sucursal;
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
  const res = await fetch(`${BASE_URL}/api/usuarios`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar usuarios');
  return res.json() as Promise<Usuario[]>;
};

export const createUsuario = async (data: UsuarioInput): Promise<Usuario> => {
  const res = await fetch(`${BASE_URL}/api/usuarios`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Error al crear usuario');
  return body as Usuario;
};

export const updatePreferencias = async (idioma: string, tema: string): Promise<void> => {
  const res = await fetch(`${BASE_URL}/api/usuarios/me/preferencias`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ idioma, tema }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error || 'Error al actualizar preferencias');
  }
};

