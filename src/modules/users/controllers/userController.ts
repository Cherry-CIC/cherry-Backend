import { Request, Response } from 'express';
import { firestore } from '../../../shared/config/firebaseConfig';
import { UserService } from '../services/UserService';
import { ResponseHandler } from '../../../shared/utils/responseHandler';

const userService = new UserService();

export const deleteMe = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user?.uid;
        if (!userId) {
            ResponseHandler.unauthorized(res, 'Authentication required');
            return;
        }

        // Verify user exists in Firestore
        const userQuery = await firestore.collection('users')
            .where('id', '==', userId)
            .limit(1)
            .get();

        if (userQuery.empty) {
            ResponseHandler.notFound(res, 'User/profile record not found');
            return;
        }

        // Check if there are outstanding blockers
        const blockers = await userService.checkBlockers(userId);
        if (blockers.length > 0) {
            res.status(409).json({
                status: "blocked",
                reason: "outstanding_tasks",
                canQueueDeletion: true,
                blockingItems: blockers,
                message: "Your account cannot be deleted yet because there are outstanding tasks."
            });
            return;
        }

        // Fully delete user
        await userService.deleteAccountFully(userId);
        res.status(204).end();
    } catch (err) {
        console.error('Error in deleteMe controller:', err);
        ResponseHandler.internalServerError(res, 'Failed to process account deletion', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const requestDeletionQueue = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user?.uid;
        if (!userId) {
            ResponseHandler.unauthorized(res, 'Authentication required');
            return;
        }

        // Verify user exists in Firestore
        const userQuery = await firestore.collection('users')
            .where('id', '==', userId)
            .limit(1)
            .get();

        if (userQuery.empty) {
            ResponseHandler.notFound(res, 'User/profile record not found');
            return;
        }

        await userService.queueDeletion(userId);
        res.status(202).json({
            success: true,
            message: "Deletion request queued successfully. Deletion will proceed once all outstanding tasks are resolved."
        });
    } catch (err) {
        console.error('Error in requestDeletionQueue controller:', err);
        ResponseHandler.internalServerError(res, 'Failed to queue account deletion request', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const triggerScheduledDeletions = async (req: Request, res: Response): Promise<void> => {
    try {
        let limit = 100;
        if (req.query.limit !== undefined) {
            limit = parseInt(req.query.limit as string, 10);
            if (isNaN(limit) || limit <= 0 || limit > 10000) {
                ResponseHandler.badRequest(res, 'Validation failed', 'Limit must be a positive integer between 1 and 10000');
                return;
            }
        }
        const result = await userService.processScheduledDeletions(limit);
        ResponseHandler.success(res, result, 'Scheduled deletions processed successfully');
    } catch (err) {
        console.error('Error in triggerScheduledDeletions controller:', err);
        ResponseHandler.internalServerError(res, 'Failed to process scheduled deletions', err instanceof Error ? err.message : 'Unknown error');
    }
};
