import { Router } from 'express';
import { verifyToken, requireStaff } from '../middleware/auth.middleware';
import { verifyLicencia } from '../middleware/licencia.middleware';
import { getSnapshotGarita } from '../controllers/sync.controller';

const router = Router();

// Doble llave: sesión de agente (persona) + licencia del dispositivo. Una
// licencia revocada corta la sincronización aunque el agente tenga sesión.
router.get('/garita', verifyToken, requireStaff, verifyLicencia, getSnapshotGarita);

export default router;
