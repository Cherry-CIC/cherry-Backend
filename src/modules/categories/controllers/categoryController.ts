import { Request, Response } from 'express';
import { CategoryRepository } from '../repositories/CategoryRepository';
import { ResponseHandler } from '../../../shared/utils/responseHandler';

const repo = new CategoryRepository();

export const getAllCategories = async (req: Request, res: Response): Promise<void> => {
    try {
        const categories = await repo.getAll();
        ResponseHandler.success(res, categories, 'Categories fetched successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to fetch categories', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const getCategoryById = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const category = await repo.getById(id);
        
        if (!category) {
            ResponseHandler.notFound(res, 'Category not found', `Category with ID ${id} does not exist`);
            return;
        }
        
        ResponseHandler.success(res, category, 'Category fetched successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to fetch category', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const createCategory = async (req: Request, res: Response): Promise<void> => {
    try {
        const category = req.body;
        const newCategory = await repo.create(category);
        ResponseHandler.created(res, newCategory, 'Category created successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to create category', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const updateCategory = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const categoryData = req.body;
        const updatedCategory = await repo.update(id, categoryData);
        
        if (!updatedCategory) {
            ResponseHandler.notFound(res, 'Category not found', `Category with ID ${id} does not exist`);
            return;
        }
        
        ResponseHandler.success(res, updatedCategory, 'Category updated successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to update category', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const deleteCategory = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const deleted = await repo.delete(id);
        
        if (!deleted) {
            ResponseHandler.notFound(res, 'Category not found', `Category with ID ${id} does not exist`);
            return;
        }
        
        ResponseHandler.success(res, null, 'Category deleted successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to delete category', err instanceof Error ? err.message : 'Unknown error');
    }
};