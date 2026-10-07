import type { AuditEstado } from '../../services/api';

/**
 * Cómo agrupa el panel de auditoría las acciones de la bitácora (el filtro de «Acción» va por grupos, no en una lista
 * de ~75 códigos). Una acción nueva que no encaje cae en «otras»; una prueba vigila que ninguna de las documentadas lo haga.
 */
export type GrupoAuditoria = 'sesion' | 'empresas' | 'personas' | 'garita' | 'dinero' | 'comunidad' | 'datos' | 'sistema' | 'otras';

export const GRUPOS: GrupoAuditoria[] = ['sesion', 'empresas', 'personas', 'garita', 'dinero', 'comunidad', 'datos', 'sistema', 'otras'];

const REGLAS: Array<[RegExp, GrupoAuditoria]> = [
  [/^(LOGIN|LOGOUT|REFRESH_|LIMITE_|ACCESO_DENEGADO|TWOFA_)/, 'sesion'],
  [/^INVITACION_QR_/, 'garita'],
  [/^(EMPRESA_|ADMIN_|SUCURSAL_|INVITACION_)/, 'empresas'],
  [/^(USUARIO_|RESIDENTE_)/, 'personas'],
  [/^(LICENCIA_|REGISTRO_|PREAUTORIZACION_|BLACKLIST_|CONFIG_QR_|OCR_)/, 'garita'],
  [/^(PAGO_|CARGO_)/, 'dinero'],
  [/^(ANUNCIO_|AREA_|CREAR_RESERVA|RESERVA_|CONFIG_RESERVAS_|TICKET_)/, 'comunidad'],
  [/^REPORTE_/, 'datos'],
  [/^JOB_/, 'sistema'],
];

export const grupoDeAccion = (accion: string): GrupoAuditoria =>
  REGLAS.find(([patron]) => patron.test(accion))?.[1] ?? 'otras';

/** Resultado de una fila según su código HTTP (mismas reglas que el filtro «estado» del servidor). */
export const estadoDe = (status: number | null | undefined): AuditEstado => {
  if (status == null || status < 400) return 'ok';
  if (status === 429) return 'bloqueado';
  if (status >= 500) return 'error';
  return 'rechazado';
};
