import { Router } from 'express';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { blockUser, listBlockedUsers, unblockUser } from '../controllers/blockController';

const router = Router();

router.get('/', authMiddleware, listBlockedUsers);
router.post('/:userId', authMiddleware, blockUser);
router.delete('/:userId', authMiddleware, unblockUser);

export default router;
