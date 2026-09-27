/**
 * Separación de portales.
 *
 * La aplicación se sirve desde dos entradas distintas en vez de una sola que
 * decide por rol después de entrar:
 *
 *   /personal   → administración, garita y dirección (admin, agente, owner…)
 *   /residente  → portal del residente
 *
 * Tenerlas separadas hace que cada público reciba su propia dirección —la que
 * se le comparte en un correo o en un cartel de la garita— y que el portal que
 * no le corresponde no llegue siquiera a montarse. Es una separación de
 * entrada, no de permisos: quien autoriza sigue siendo el backend.
 */

export type Portal = 'personal' | 'residente';

/** Ruta canónica de cada portal. Es la que queda en la barra de direcciones. */
export const RUTA_PORTAL: Record<Portal, string> = {
  personal: '/personal',
  residente: '/residente',
};

/**
 * Alias aceptados. Existen porque cada equipo llama distinto a lo mismo y no
 * cuesta nada absorberlo; todos redirigen a la ruta canónica.
 */
const ALIAS: Record<string, Portal> = {
  '/staff': 'personal',
  '/admin': 'personal',
  '/tenant': 'residente',
  '/resident': 'residente',
  '/portal': 'residente',
};

/** Quita la barra final y las mayúsculas para comparar rutas. */
export function normalizarRuta(pathname: string): string {
  const limpia = pathname.toLowerCase().replace(/\/+$/, '');
  return limpia === '' ? '/' : limpia;
}

/** Portal que le corresponde a un rol. Todo lo que no es residente es personal. */
export function portalDeRol(rol: string): Portal {
  return rol === 'residente' ? 'residente' : 'personal';
}

/** Portal al que apunta una ruta, o `null` si no es la entrada de ninguno. */
export function portalDeRuta(pathname: string): Portal | null {
  const ruta = normalizarRuta(pathname);
  const canonico = (Object.keys(RUTA_PORTAL) as Portal[]).find(p => RUTA_PORTAL[p] === ruta);
  return canonico ?? ALIAS[ruta] ?? null;
}

/** El otro portal, para el enlace cruzado de las pantallas de acceso. */
export function otroPortal(portal: Portal): Portal {
  return portal === 'personal' ? 'residente' : 'personal';
}

/** Clave de traducción del nombre de cada portal. */
export const NOMBRE_PORTAL: Record<Portal, string> = {
  personal: 'portal.staffName',
  residente: 'portal.tenantName',
};

/** Clave de traducción del enlace hacia el otro portal. */
export const ENLACE_PORTAL: Record<Portal, string> = {
  personal: 'portal.gotoStaff',
  residente: 'portal.gotoTenant',
};

/**
 * Ruta pública de aceptación de invitaciones administrativas:
 * /invitacion/<token>. No pertenece a ningún portal (quien la abre todavía no
 * tiene cuenta), así que la corrección automática de rutas la deja en paz.
 * Devuelve el token, o `null` si la ruta no es esa.
 */
export function tokenDeInvitacion(pathname: string): string | null {
  const m = /^\/invitacion\/([A-Za-z0-9_-]{20,})\/?$/.exec(pathname);
  return m ? m[1] : null;
}
