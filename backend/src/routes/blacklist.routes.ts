import { Router } from 'express';
import { requireAdminSucursal } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { getBlacklist, createBlacklist, deleteBlacklist } from '../controllers/blacklist.controller';

const router = Router();

router.get('/', getBlacklist);
router.post('/',
  requireAdminSucursal,
  auditLog({ accion: 'BLACKLIST_AGREGADO', tabla: 'visitante_blacklist' }),
  createBlacklist,
);
router.delete('/:id',
  requireAdminSucursal,
  auditLog({ accion: 'BLACKLIST_REMOVIDO', tabla: 'visitante_blacklist' }),
  deleteBlacklist,
);

export default router;
