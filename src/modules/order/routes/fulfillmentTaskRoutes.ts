import { Router } from 'express';
import { processFulfillmentTask } from '../controllers/fulfillmentTaskController';

const router = Router();

router.post('/tasks', processFulfillmentTask);

export default router;
