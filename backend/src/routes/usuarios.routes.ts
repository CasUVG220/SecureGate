import { Router } from 'express';
import { getUsuarios, getUsuariosSucursal, createUsuario, deleteUsuario, updatePreferencias } from '../controllers/usuarios.controller';
import { requireAdminSucursal } from '../middleware/auth.middleware';

const router = Router();

/**
 * Preferencias propias (tema e idioma): cualquier usuario con sesión.
 *
 * Antes el guard de administración estaba en el `router.use('/usuarios', …)` del
 * index y cubría también esta ruta, así que un agente o un residente recibía 403
 * al guardar su tema. El frontend ignora ese error en silencio, de modo que la
 * preferencia parecía aplicarse pero se perdía al cerrar sesión: al volver a
 * entrar el backend seguía devolviendo el tema por defecto.
 *
 * El resto del router sí es de administración, y ahora lo declara ruta por ruta.
 */
router.put('/me/preferencias', updatePreferencias);

router.get('/', requireAdminSucursal, getUsuarios);
router.get('/sucursal', requireAdminSucursal, getUsuariosSucursal);
router.post('/', requireAdminSucursal, createUsuario);
router.delete('/:id', requireAdminSucursal, deleteUsuario);

export default router;
