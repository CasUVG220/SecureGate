import { Router } from 'express';
import { requireAdminSucursal } from '../middleware/auth.middleware';
import { getBlacklist, addToBlacklist, removeFromBlacklist } from '../controllers/blacklist.controller';

const router = Router();

router.get('/',     getBlacklist);
router.post('/',    requireAdminSucursal, addToBlacklist);
router.delete('/:id', requireAdminSucursal, removeFromBlacklist);

export default router;
