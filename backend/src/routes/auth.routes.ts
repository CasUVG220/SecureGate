import { Router } from 'express';
import { body } from 'express-validator';
import { login, refresh, logout } from '../controllers/auth.controller';
import { validateRequest } from '../middleware/validate.middleware';
import { auditLog } from '../middleware/audit.middleware';

const router = Router();

router.post(
  '/login',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6, max: 100 }),
  validateRequest,
  auditLog({ accion: 'LOGIN' }),
  login,
);

router.post('/refresh', refresh);
router.post('/logout',  logout);

export default router;
