import { Request, Response, NextFunction } from 'express';
import { ServiceFactory } from '../services/ServiceFactory';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { Product } from '../model/Product';

/**
 * Helper function to format product response by removing private fields
 * and adding computed like status fields.
 * @param product - Product object from database
 * @param userId - Optional authenticated user ID
 * @returns Public product object with likeCount and isLikedByUser
 */
const formatProductResponse = (product: Product, userId?: string) => {
  const { likedBy, ...publicProduct } = product;
  return {
    ...publicProduct,
    likeCount: product.likes ?? 0,
    isLikedByUser: userId ? (likedBy?.includes(userId) ?? false) : false
  };
};

export const getAllProducts = async (req: Request, res: Response): Promise<void> => {
    try {
        const productService = ServiceFactory.getProductService();
        const products = await productService.getAllProducts();
        
        // Add isLikedByUser if user is authenticated and strip private likedBy field
        const user = (req as any).user;
        const productsWithLikeStatus = products.map(product => 
            formatProductResponse(product, user?.uid)
        );
        
        ResponseHandler.success(res, productsWithLikeStatus, 'Products fetched successfully');
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
        
        // Add like status if user is authenticated and strip private likedBy field
        const user = (req as any).user;
        const productWithLikeStatus = formatProductResponse(product, user?.uid);
        
        ResponseHandler.success(res, productWithLikeStatus, 'Product fetched successfully');
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
        
        // Add like status if user is authenticated and strip private likedBy field
        const user = (req as any).user;
        const productWithLikeStatus = formatProductResponse(product, user?.uid);
        
        ResponseHandler.success(res, productWithLikeStatus, 'Product with details fetched successfully');
    } catch (err) {
        ResponseHandler.internalServerError(res, 'Failed to fetch product details', err instanceof Error ? err.message : 'Unknown error');
    }
};

export const getAllProductsWithDetails = async (req: Request, res: Response): Promise<void> => {
    try {
        const productService = ServiceFactory.getProductService();
        const products = await productService.getAllProductsWithDetails();
        
        // Add like status if user is authenticated and strip private likedBy field
        const user = (req as any).user;
        const productsWithLikeStatus = products.map(product => 
            formatProductResponse(product, user?.uid)
        );
        
        ResponseHandler.success(res, productsWithLikeStatus, 'Products with details fetched successfully');
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
    const user = (req as any).user;

    if (!user || !user.uid) {
      ResponseHandler.unauthorized(res, 'Authentication required', 'User must be authenticated to like products');
      return;
    }

    const product = await productService.likeProduct(id, user.uid);
    
    if (!product) {
      ResponseHandler.notFound(res, 'Product not found', `Product with ID ${id} does not exist`);
      return;
    }

    ResponseHandler.success(
      res,
      {
        likeCount: product.likes || 0,
        isLikedByUser: true
      },
      'Product liked successfully'
    );
  } catch (err) {
    ResponseHandler.internalServerError(
      res,
      'Failed to like product',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
};

export const unlikeProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const productService = ServiceFactory.getProductService();
    const { id } = req.params;
    const user = (req as any).user;

    if (!user || !user.uid) {
      ResponseHandler.unauthorized(res, 'Authentication required', 'User must be authenticated to unlike products');
      return;
    }

    const product = await productService.unlikeProduct(id, user.uid);
    
    if (!product) {
      ResponseHandler.notFound(res, 'Product not found', `Product with ID ${id} does not exist`);
      return;
    }

    ResponseHandler.success(
      res,
      {
        likeCount: product.likes || 0,
        isLikedByUser: false
      },
      'Product unliked successfully'
    );
  } catch (err) {
    ResponseHandler.internalServerError(
      res,
      'Failed to unlike product',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
};

export const getLikedProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const productService = ServiceFactory.getProductService();
    const user = (req as any).user;

    if (!user || !user.uid) {
      ResponseHandler.unauthorized(res, 'Authentication required', 'User must be authenticated to view liked products');
      return;
    }

    // Get pagination parameters from query
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const startAfter = req.query.startAfter as string | undefined;

    const products = await productService.getProductsLikedByUser(user.uid, limit, startAfter);
    
    // Add like status (all will be true) and strip private likedBy field
    const productsWithLikeStatus = products.map(product => 
      formatProductResponse(product, user.uid)
    );

    ResponseHandler.success(res, productsWithLikeStatus, 'Liked products fetched successfully');
  } catch (err) {
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch liked products',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
};
