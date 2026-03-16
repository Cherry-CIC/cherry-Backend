import { Request, Response } from 'express';
import { CharityRepository } from '../repositories/CharityRepository';
import { ResponseHandler } from '../../../shared/utils/responseHandler';

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
        const { id } = req.params;
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
        const { id } = req.params;
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
        const { id } = req.params;
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