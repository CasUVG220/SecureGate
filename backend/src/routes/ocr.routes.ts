import { Router } from 'express';
import { scanDpi, scanPlaca } from '../controllers/ocr.controller';

const router = Router();

router.post('/dpi',   scanDpi);
router.post('/placa', scanPlaca);

export default router;
