import { Router } from 'express';
import {
  processOrderReleaseTask,
  reconcileOrderReleases,
} from '../controllers/orderReleaseTaskController';

const router = Router();

router.post('/tasks', processOrderReleaseTask);
router.post('/reconcile', reconcileOrderReleases);

export default router;
