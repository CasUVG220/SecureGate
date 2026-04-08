const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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

export const decodeTokenPayload = (token: string): Record<string, unknown> | null => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
};