import { Router } from 'express';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { createReport } from '../controllers/reportController';

const router = Router();

router.post('/', authMiddleware, createReport);

export default router;
