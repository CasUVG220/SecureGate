import { Router } from 'express';
import { getUsuarios, getUsuariosSucursal, createUsuario, updatePreferencias } from '../controllers/usuarios.controller';
import { requireAdminSucursal } from '../middleware/auth.middleware';

const router = Router();

router.put('/me/preferencias', updatePreferencias);

router.get('/', getUsuarios);
router.get('/sucursal', requireAdminSucursal, getUsuariosSucursal);
router.post('/', createUsuario);

export default router;
