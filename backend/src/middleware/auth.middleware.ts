import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { tokenRevocado } from '../utils/revocacion';
import { registrarAuditoria } from './audit.middleware';

export type UserRol = 'owner' | 'admin_empresa' | 'admin_sucursal' | 'agente' | 'residente';

export interface JwtPayload {
  id: string;
  nombre: string;
  email: string;
  rol: UserRol;
  sucursal_id: string | null;
  empresa_id: string | null;
}

export interface TenantFilter {
  type: 'all' | 'empresa' | 'sucursal';
  empresa_id?: string;
  sucursal_id?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      tenantFilter?: TenantFilter;
    }
  }
}

export const ROLES: readonly UserRol[] = ['owner', 'admin_empresa', 'admin_sucursal', 'agente', 'residente'];

/** Roles del personal (todo lo que no es residente). Lista blanca a propósito. */
export const ROLES_PERSONAL: readonly UserRol[] = ['owner', 'admin_empresa', 'admin_sucursal', 'agente'];

export const verifyToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  const token = authHeader.split(' ')[1];
  try {
    // Algoritmo fijado: sin `algorithms`, jsonwebtoken acepta lo que declare el
    // propio token en su cabecera.
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string, { algorithms: ['HS256'] }) as
      JwtPayload & { typ?: string };
    // Los tokens de licencia (typ: 'licencia') se firman con el mismo secreto y
    // no llevan rol. Antes pasaban este middleware y, como `requireStaff` sólo
    // excluía a 'residente', un token de garita robado valía como sesión de
    // personal. Una sesión de usuario siempre trae un rol conocido y ningún typ.
    if (decoded.typ !== undefined || !ROLES.includes(decoded.rol)) {
      return res.status(403).json({ error: 'Token inválido o expirado' });
    }
    // Cuenta desactivada, rol cambiado o empresa suspendida DESPUÉS de emitirse
    // este token: se corta ya, sin esperar a que caduque (utils/revocacion.ts).
    if (tokenRevocado(decoded as JwtPayload & { iat?: number })) {
      return res.status(401).json({ error: 'Sesión revocada' });
    }
    req.user = decoded;
    next();
  } catch {
    res.status(403).json({ error: 'Token inválido o expirado' });
  }
};

/**
 * Una persona con sesión que pide algo que su rol no permite deja huella (acción ACCESO_DENEGADO): es la señal de alguien
 * que prueba rutas de administración. Va aquí, en el guard, porque el `auditLog` de cada ruta está DESPUÉS y nunca llega a
 * correr cuando el rol ya fue rechazado. Los 401 (sin sesión) no se auditan: son ruido anónimo de escáneres.
 */
const denegar = (req: Request, res: Response, guarda: string, error: string) => {
  registrarAuditoria(
    req, { accion: 'ACCESO_DENEGADO' }, 403,
    { guarda, metodo: req.method, ruta: (req.originalUrl ?? '').split('?')[0].slice(0, 200), rol: req.user?.rol ?? null },
  );
  return res.status(403).json({ error });
};

export const requireOwner = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.rol !== 'owner') {
    return denegar(req, res, 'owner', 'Acceso restringido a owner');
  }
  next();
};

export const requireAdminEmpresa = (req: Request, res: Response, next: NextFunction) => {
  const allowed: UserRol[] = ['owner', 'admin_empresa'];
  if (!req.user || !allowed.includes(req.user.rol)) {
    return denegar(req, res, 'admin_empresa', 'Acceso restringido a admin de empresa');
  }
  next();
};

export const requireAdminSucursal = (req: Request, res: Response, next: NextFunction) => {
  const allowed: UserRol[] = ['owner', 'admin_empresa', 'admin_sucursal'];
  if (!req.user || !allowed.includes(req.user.rol)) {
    return denegar(req, res, 'admin_sucursal', 'Acceso restringido a admin de sucursal');
  }
  next();
};

export const requireStaff = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || !ROLES_PERSONAL.includes(req.user.rol)) {
    return denegar(req, res, 'personal', 'Acceso restringido a personal');
  }
  next();
};

export const injectTenantFilter = (req: Request, res: Response, next: NextFunction) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  switch (user.rol) {
    case 'owner':
      req.tenantFilter = { type: 'all' };
      break;
    case 'admin_empresa':
      req.tenantFilter = { type: 'empresa', empresa_id: user.empresa_id ?? undefined };
      break;
    default:
      req.tenantFilter = { type: 'sucursal', sucursal_id: user.sucursal_id ?? undefined };
  }

  next();
};
