import { Request, Response } from 'express';
import { CharityRepository } from '../repositories/CharityRepository';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { requireSingleParam } from '../../../shared/utils/requestParam';
import { CharityLikeRepository } from '../repositories/CharityLikeRepository';

const repo = new CharityRepository();
const likeRepo = new CharityLikeRepository();

const DEFAULT_LIKED_CHARITIES_LIMIT = 20;
const MAX_LIKED_CHARITIES_LIMIT = 50;

function parseLikedCharitiesCursor(raw: unknown): { createdAt: Date; id: string } | undefined {
    if (typeof raw !== 'string' || !raw) return undefined;
    try {
        const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
        if (
            typeof decoded?.id !== 'string' ||
            typeof decoded?.createdAt !== 'string' ||
            Number.isNaN(Date.parse(decoded.createdAt))
        ) throw new Error();
        return { id: decoded.id, createdAt: new Date(decoded.createdAt) };
    } catch {
        throw new Error('Invalid cursor');
    }
}

function encodeLikedCharitiesCursor(createdAt: Date, id: string): string {
    return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url');
}

export const getAllCharities = async (req: Request, res: Response): Promise<void> => {
    try {
        const charities = await repo.getAll();
        ResponseHandler.success(res, charities, 'Charities fetched successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to fetch charities', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const getCharityById = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = requireSingleParam(req.params.id);
        if (!id) {
            ResponseHandler.badRequest(res, 'Charity ID is required');
            return;
        }
        const charity = await repo.getById(id);
        
        if (!charity) {
            ResponseHandler.notFound(res, 'Charity not found', `Charity with ID ${id} does not exist`);
            return;
        }
        
        ResponseHandler.success(res, charity, 'Charity fetched successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to fetch charity', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const getMyLikedCharities = async (req: Request, res: Response): Promise<void> => {
    try {
        const rawLimit = req.query.limit;
        const parsedLimit = rawLimit === undefined ? DEFAULT_LIKED_CHARITIES_LIMIT : Number(rawLimit);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIKED_CHARITIES_LIMIT) {
            ResponseHandler.badRequest(res, `Limit must be an integer between 1 and ${MAX_LIKED_CHARITIES_LIMIT}`);
            return;
        }

        const cursor = parseLikedCharitiesCursor(req.query.cursor);
        const page = await likeRepo.getLikedCharitiesPage(
            (req as any).user.uid,
            parsedLimit,
            cursor,
        );
        const charities = (await Promise.all(
            page.likes.map((like) => repo.getById(like.charityId)),
        )).filter((charity): charity is NonNullable<typeof charity> => Boolean(charity));
        const lastLike = page.likes[page.likes.length - 1];

        res.status(200).json({
            success: true,
            message: 'Liked charities fetched successfully',
            data: { charities },
            meta: {
                limit: parsedLimit,
                nextCursor: page.hasMore && lastLike
                    ? encodeLikedCharitiesCursor(lastLike.createdAt, lastLike.id)
                    : null,
                hasMore: page.hasMore,
            },
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        if (err instanceof Error && err.message === 'Invalid cursor') {
            ResponseHandler.badRequest(res, 'Invalid cursor');
            return;
        }
        ResponseHandler.internalServerError(
            res,
            'Failed to fetch liked charities',
            err instanceof Error ? err.message : 'Unknown error',
        );
    }
};

export const createCharity = async (req: Request, res: Response): Promise<void> => {
    try {
        const charity = req.body;
        const newCharity = await repo.create(charity);
        ResponseHandler.created(res, newCharity, 'Charity created successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to create charity', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const updateCharity = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = requireSingleParam(req.params.id);
        if (!id) {
            ResponseHandler.badRequest(res, 'Charity ID is required');
            return;
        }
        const charityData = req.body;
        const updatedCharity = await repo.update(id, charityData);
        
        if (!updatedCharity) {
            ResponseHandler.notFound(res, 'Charity not found', `Charity with ID ${id} does not exist`);
            return;
        }
        
        ResponseHandler.success(res, updatedCharity, 'Charity updated successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to update charity', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const deleteCharity = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = requireSingleParam(req.params.id);
        if (!id) {
            ResponseHandler.badRequest(res, 'Charity ID is required');
            return;
        }
        const deleted = await repo.delete(id);
        
        if (!deleted) {
            ResponseHandler.notFound(res, 'Charity not found', `Charity with ID ${id} does not exist`);
            return;
        }

        await likeRepo.deleteLikesByCharityId(id);
        
        ResponseHandler.success(res, null, 'Charity deleted successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to delete charity', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const likeCharity = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = requireSingleParam(req.params.id);
        if (!id) {
            ResponseHandler.badRequest(res, 'Charity ID is required');
            return;
        }

        const { like } = req.body;
        if (typeof like !== 'boolean') {
            ResponseHandler.badRequest(
                res,
                'Like must be a boolean (true to like, false to unlike)',
            );
            return;
        }

        const { charity, liked } = await likeRepo.setLikeStatus(
            (req as any).user.uid,
            id,
            like,
        );
        ResponseHandler.success(
            res,
            { ...charity, liked },
            'Charity likes updated successfully',
        );
    } catch (err) {
        if (err instanceof Error && err.message === 'Charity not found') {
            ResponseHandler.notFound(
                res,
                'Charity not found',
                `Charity with ID ${req.params.id} does not exist`,
            );
            return;
        }
        ResponseHandler.internalServerError(
            res,
            'Failed to update charity likes',
            err instanceof Error ? err.message : 'Unknown error',
        );
    }
};
