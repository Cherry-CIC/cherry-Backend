import { Router } from 'express';
import { getAllPostageSizes } from '../controllers/postageSizeController';

const router = Router();

router.get('/', getAllPostageSizes);

export default router;
