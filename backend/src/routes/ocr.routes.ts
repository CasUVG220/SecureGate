import { Router } from 'express';
import { scanDpi } from '../controllers/ocr.controller';

const router = Router();

router.post('/dpi', scanDpi);

export default router;
