import { Router } from 'express';
import { scanDpi, scanPlaca } from '../controllers/ocr.controller';
import { auditLog } from '../middleware/audit.middleware';

const router = Router();

// Lee fotos de documentos de identidad y cuesta dinero por llamada (Google Vision): cada lectura queda en la bitácora con quién,
// cuándo y desde dónde. La imagen NO se guarda ahí, sólo el hecho. El límite por usuario está en routes/index.ts.
router.post('/dpi',   auditLog({ accion: 'OCR_DPI', tabla: 'visitantes' }), scanDpi);
router.post('/placa', auditLog({ accion: 'OCR_PLACA', tabla: 'vehiculos' }), scanPlaca);

export default router;
