import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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

export const verifyToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(403).json({ error: 'Token inválido o expirado' });
  }
};

export const requireOwner = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.rol !== 'owner') {
    return res.status(403).json({ error: 'Acceso restringido a owner' });
  }
  next();
};

export const requireAdminEmpresa = (req: Request, res: Response, next: NextFunction) => {
  const allowed: UserRol[] = ['owner', 'admin_empresa'];
  if (!req.user || !allowed.includes(req.user.rol)) {
    return res.status(403).json({ error: 'Acceso restringido a admin de empresa' });
  }
  next();
};

export const requireAdminSucursal = (req: Request, res: Response, next: NextFunction) => {
  const allowed: UserRol[] = ['owner', 'admin_empresa', 'admin_sucursal'];
  if (!req.user || !allowed.includes(req.user.rol)) {
    return res.status(403).json({ error: 'Acceso restringido a admin de sucursal' });
  }
  next();
};

export const requireStaff = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || req.user.rol === 'residente') {
    return res.status(403).json({ error: 'Acceso restringido a personal' });
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
