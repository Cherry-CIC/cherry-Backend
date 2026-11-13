import { Request, Response } from 'express';
import { CharityRepository } from '../repositories/CharityRepository';
import {
  CharityProfileService,
  InvalidCharityProductCursor,
} from '../services/CharityProfileService';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { requireSingleParam } from '../../../shared/utils/requestParam';

const repo = new CharityRepository();

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
        
        ResponseHandler.success(res, null, 'Charity deleted successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to delete charity', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const getCharityProducts = async (req: Request, res: Response): Promise<void> => {
    // Authenticated product responses must never be shared between viewers.
    res.setHeader('Cache-Control', 'private, no-store');
    const viewerId = (req as Request & { user?: { uid?: string } }).user?.uid;
    if (!viewerId) {
        ResponseHandler.unauthorized(res, 'Authentication required');
        return;
    }

    const id = requireSingleParam(req.params.id);
    if (!id) {
        ResponseHandler.badRequest(res, 'Charity ID is required');
        return;
    }

    const rawLimit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined;
    const limit = rawLimit !== undefined && Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 50
        ? rawLimit
        : rawLimit === undefined
            ? undefined
            : NaN;
    if (limit !== undefined && Number.isNaN(limit)) {
        ResponseHandler.badRequest(res, 'Invalid limit parameter');
        return;
    }

    const cursor = typeof req.query.cursor === 'string' && req.query.cursor.trim()
        ? req.query.cursor.trim()
        : undefined;

    try {
        const page = await new CharityProfileService().getCharityProducts(id, viewerId, { limit, cursor });
        if (!page) {
            ResponseHandler.notFound(res, 'Charity not found', `Charity with ID ${id} does not exist`);
            return;
        }
        ResponseHandler.paginated(res, page.data, page.meta);
    } catch (err) {
        if (err instanceof InvalidCharityProductCursor) {
            ResponseHandler.badRequest(res, 'Invalid cursor');
            return;
        }
        console.error('charity_products.fetch_failed');
        ResponseHandler.custom(res, 503, false, 'Unable to load these products. Please try again.');
    }
};
