import { Router } from 'express';
import { getUsuarios, getUsuariosSucursal, createUsuario, updateUsuario, deleteUsuario, restablecerDosPasos, updatePreferencias } from '../controllers/usuarios.controller';
import { requireAdminSucursal } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';

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
router.post('/', requireAdminSucursal, auditLog({ accion: 'USUARIO_CREADO', tabla: 'usuarios' }), createUsuario);
router.put('/:id', requireAdminSucursal, auditLog({ accion: 'USUARIO_EDITADO', tabla: 'usuarios' }), updateUsuario);
router.delete('/:id', requireAdminSucursal, auditLog({ accion: 'USUARIO_DESACTIVADO', tabla: 'usuarios' }), deleteUsuario);
// Quien perdió el teléfono y los códigos de recuperación: un superior le restablece la verificación en dos pasos (SCRUM-123).
router.delete('/:id/2fa', requireAdminSucursal, auditLog({ accion: 'TWOFA_RESTABLECIDO', tabla: 'usuario_2fa' }), restablecerDosPasos);

export default router;
