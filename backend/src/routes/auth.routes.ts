import { Router } from 'express';
import { body } from 'express-validator';
import { login } from '../controllers/auth.controller';
import { validateRequest } from '../middleware/validate.middleware';

const router = Router();

router.post(
  '/login',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6, max: 100 }),
  validateRequest,
  login,
);

export default router;
