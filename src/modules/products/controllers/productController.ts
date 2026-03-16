import { Request, Response, NextFunction } from 'express';
import { ServiceFactory } from '../services/ServiceFactory';
import { ResponseHandler } from '../../../shared/utils/responseHandler';

export const getAllProducts = async (req: Request, res: Response): Promise<void> => {
    try {
        const productService = ServiceFactory.getProductService();
        const products = await productService.getAllProducts();
        ResponseHandler.success(res, products, 'Products fetched successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to fetch products', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const createProduct = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const productService = ServiceFactory.getProductService();
        const user = (req as any).user;
        const productData = { ...req.body, userId: user.uid };
        const product = await productService.createProduct(productData);
        ResponseHandler.created(res, product, 'Product created successfully');
    } catch (err) {
        if (err instanceof Error && (err.message === 'Category not found' || err.message === 'Charity not found')) {
            ResponseHandler.badRequest(res, err.message);
            return;
        }
        ResponseHandler.internalServerError(res, 'Failed to create product', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const getProductById = async (req: Request, res: Response): Promise<void> => {
    try {
        const productService = ServiceFactory.getProductService();
        const { id } = req.params;
        const product = await productService.getProductById(id);
        
        if (!product) {
            ResponseHandler.notFound(res, 'Product not found', `Product with ID ${id} does not exist`);
            return;
        }
        
        ResponseHandler.success(res, product, 'Product fetched successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to fetch product', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const getProductWithDetails = async (req: Request, res: Response): Promise<void> => {
    try {
        const productService = ServiceFactory.getProductService();
        const { id } = req.params;
        const product = await productService.getProductWithDetails(id);
        
        if (!product) {
            ResponseHandler.notFound(res, 'Product not found', `Product with ID ${id} does not exist`);
            return;
        }
        
        ResponseHandler.success(res, product, 'Product with details fetched successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to fetch product details', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const getAllProductsWithDetails = async (req: Request, res: Response): Promise<void> => {
    try {
        const productService = ServiceFactory.getProductService();
        const products = await productService.getAllProductsWithDetails();
        ResponseHandler.success(res, products, 'Products with details fetched successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to fetch products with details', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const updateProduct = async (req: Request, res: Response): Promise<void> => {
    try {
        const productService = ServiceFactory.getProductService();
        const { id } = req.params;
        const user = (req as any).user;
        const updateData = req.body;
        
        // First check if the product exists and belongs to the user
        const existingProduct = await productService.getProductById(id);
        if (!existingProduct) {
            ResponseHandler.notFound(res, 'Product not found', `Product with ID ${id} does not exist`);
            return;
        }
        
        if (existingProduct.userId !== user.uid) {
            ResponseHandler.forbidden(res, 'Access denied', 'You can only update your own products');
            return;
        }
        
        const product = await productService.updateProduct(id, updateData);
        ResponseHandler.success(res, product, 'Product updated successfully');
    } catch (err) {
        if (err instanceof Error && (err.message === 'Category not found' || err.message === 'Charity not found')) {
            ResponseHandler.badRequest(res, err.message);
            return;
        }
        ResponseHandler.internalServerError(res, 'Failed to update product', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
    try {
        const productService = ServiceFactory.getProductService();
        const { id } = req.params;
        const user = (req as any).user;
        
        // First check if the product exists and belongs to the user
        const existingProduct = await productService.getProductById(id);
        if (!existingProduct) {
            ResponseHandler.notFound(res, 'Product not found', `Product with ID ${id} does not exist`);
            return;
        }
        
        if (existingProduct.userId !== user.uid) {
            ResponseHandler.forbidden(res, 'Access denied', 'You can only delete your own products');
            return;
        }
        
        const deleted = await productService.deleteProduct(id);
        ResponseHandler.success(res, null, 'Product deleted successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to delete product', err instanceof Error ? err.message : 'Unknown error');
    }
};
export const likeProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const productService = ServiceFactory.getProductService();
    const { id } = req.params;
    const { like } = req.body;

    if (typeof like !== 'boolean') {
      ResponseHandler.badRequest(res, 'Like must be a boolean (true to like, false to unlike)');
      return;
    }

    // Convert the boolean 'like' flag to a numeric delta (+1 for like, -1 for unlike)
    const delta = like ? 1 : -1;
    const product = await productService.changePoints(id, delta);
    if (!product) {
      ResponseHandler.notFound(res, 'Product not found', `Product with ID ${id} does not exist`);
      return;
    }

    ResponseHandler.success(res, product, 'Product likes updated successfully');
  } catch (err) {
    ResponseHandler.internalServerError(
      res,
      'Failed to update product likes',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
};
