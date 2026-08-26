import { Request, Response, NextFunction } from 'express';
import { ServiceFactory } from '../services/ServiceFactory';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { requireSingleParam } from '../../../shared/utils/requestParam';
import { calculateSecurityFeePence } from '../../../shared/config/checkoutConfig';
import { gbpToPence } from '../../../shared/utils/money';
import { ProductListQuery } from '../services/ProductService';

const withSecurityFee = <T extends { price: number }>(product: T) => ({
  ...product,
  securityFee: calculateSecurityFeePence(gbpToPence(product.price)) / 100,
});

const sendPaginatedProductsResponse = <T extends { price: number }>(
  res: Response,
  items: T[],
  limit: number,
  nextCursor: string | null,
  hasMore: boolean,
  message: string,
) => {
  res.status(200).json({
    success: true,
    message,
    data: {
      products: items.map((product) => withSecurityFee(product)),
    },
    meta: {
      limit,
      nextCursor,
      hasMore,
    },
    timestamp: new Date().toISOString(),
  });
};

export const getAllProducts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const productService = ServiceFactory.getProductService();
    const query = req.query as unknown as ProductListQuery;
    const result = await productService.getPaginatedProducts(query);
    sendPaginatedProductsResponse(
      res,
      result.items,
      result.limit,
      result.nextCursor,
      result.hasMore,
      'Products fetched successfully',
    );
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid cursor') {
      ResponseHandler.badRequest(res, 'Invalid cursor', err.message);
      return;
    }
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch products',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const createProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const productService = ServiceFactory.getProductService();
    const user = (req as any).user;
    const productData = { ...req.body, userId: user.uid };
    const product = await productService.createProduct(productData);
    ResponseHandler.created(res, product, 'Product created successfully');
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message === 'Category not found' ||
        err.message === 'Charity not found' ||
        err.message === 'Postage size not found')
    ) {
      ResponseHandler.badRequest(res, err.message);
      return;
    }
    ResponseHandler.internalServerError(
      res,
      'Failed to create product',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const getProductById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const productService = ServiceFactory.getProductService();
    const id = requireSingleParam(req.params.id);
    if (!id) {
      ResponseHandler.badRequest(res, 'Product ID is required');
      return;
    }
    const product = await productService.getProductById(id);

    if (!product) {
      ResponseHandler.notFound(
        res,
        'Product not found',
        `Product with ID ${id} does not exist`,
      );
      return;
    }

    ResponseHandler.success(
      res,
      withSecurityFee(product),
      'Product fetched successfully',
    );
  } catch (err) {
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch product',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const getProductWithDetails = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const productService = ServiceFactory.getProductService();
    const id = requireSingleParam(req.params.id);
    if (!id) {
      ResponseHandler.badRequest(res, 'Product ID is required');
      return;
    }
    const product = await productService.getProductWithDetails(id);

    if (!product) {
      ResponseHandler.notFound(
        res,
        'Product not found',
        `Product with ID ${id} does not exist`,
      );
      return;
    }

    ResponseHandler.success(
      res,
      withSecurityFee(product),
      'Product with details fetched successfully',
    );
  } catch (err) {
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch product details',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const getAllProductsWithDetails = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const productService = ServiceFactory.getProductService();
    const query = req.query as unknown as ProductListQuery;
    const result = await productService.getPaginatedProductsWithDetails(query);
    sendPaginatedProductsResponse(
      res,
      result.items,
      result.limit,
      result.nextCursor,
      result.hasMore,
      'Products with details fetched successfully',
    );
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid cursor') {
      ResponseHandler.badRequest(res, 'Invalid cursor', err.message);
      return;
    }
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch products with details',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const getMyProducts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const productService = ServiceFactory.getProductService();
    const user = (req as any).user;
    const query = req.query as unknown as ProductListQuery;
    const result = await productService.getPaginatedProductsByUserId(
      user.uid,
      query,
    );

    sendPaginatedProductsResponse(
      res,
      result.items,
      result.limit,
      result.nextCursor,
      result.hasMore,
      'User products fetched successfully',
    );
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid cursor') {
      ResponseHandler.badRequest(res, 'Invalid cursor', err.message);
      return;
    }
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch user products',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const getMyLikedProducts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const productService = ServiceFactory.getProductService();
    const user = (req as any).user;
    const query = req.query as unknown as ProductListQuery;
    const result = await productService.getPaginatedLikedProductsByUserId(
      user.uid,
      query,
    );

    sendPaginatedProductsResponse(
      res,
      result.items,
      result.limit,
      result.nextCursor,
      result.hasMore,
      'Liked products fetched successfully',
    );
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid cursor') {
      ResponseHandler.badRequest(res, 'Invalid cursor', err.message);
      return;
    }
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch liked products',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const updateProduct = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const productService = ServiceFactory.getProductService();
    const id = requireSingleParam(req.params.id);
    if (!id) {
      ResponseHandler.badRequest(res, 'Product ID is required');
      return;
    }
    const user = (req as any).user;
    const updateData = req.body;

    // First check if the product exists and belongs to the user
    const existingProduct = await productService.getProductById(id);
    if (!existingProduct) {
      ResponseHandler.notFound(
        res,
        'Product not found',
        `Product with ID ${id} does not exist`,
      );
      return;
    }

    if (existingProduct.userId !== user.uid) {
      ResponseHandler.forbidden(
        res,
        'Access denied',
        'You can only update your own products',
      );
      return;
    }

    const product = await productService.updateProduct(id, updateData);
    ResponseHandler.success(res, product, 'Product updated successfully');
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message === 'Category not found' ||
        err.message === 'Charity not found' ||
        err.message === 'Postage size not found')
    ) {
      ResponseHandler.badRequest(res, err.message);
      return;
    }
    ResponseHandler.internalServerError(
      res,
      'Failed to update product',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const deleteProduct = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const productService = ServiceFactory.getProductService();
    const id = requireSingleParam(req.params.id);
    if (!id) {
      ResponseHandler.badRequest(res, 'Product ID is required');
      return;
    }
    const user = (req as any).user;

    // First check if the product exists and belongs to the user
    const existingProduct = await productService.getProductById(id);
    if (!existingProduct) {
      ResponseHandler.notFound(
        res,
        'Product not found',
        `Product with ID ${id} does not exist`,
      );
      return;
    }

    if (existingProduct.userId !== user.uid) {
      ResponseHandler.forbidden(
        res,
        'Access denied',
        'You can only delete your own products',
      );
      return;
    }

    const deleted = await productService.deleteProduct(id);
    ResponseHandler.success(res, null, 'Product deleted successfully');
  } catch (err) {
    ResponseHandler.internalServerError(
      res,
      'Failed to delete product',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const unlistProduct = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const productService = ServiceFactory.getProductService();
    const id = requireSingleParam(req.params.id);
    if (!id) {
      ResponseHandler.badRequest(res, 'Product ID is required');
      return;
    }
    const user = (req as any).user;

    const existingProduct = await productService.getProductById(id);
    if (!existingProduct) {
      ResponseHandler.notFound(
        res,
        'Product not found',
        `Product with ID ${id} does not exist`,
      );
      return;
    }

    if (existingProduct.userId !== user.uid) {
      ResponseHandler.forbidden(
        res,
        'Access denied',
        'You can only unlist your own products',
      );
      return;
    }

    const product = await productService.unlistProduct(id);
    ResponseHandler.success(res, product, 'Product unlisted successfully');
  } catch (err) {
    if (
      err instanceof Error &&
      err.message === 'Sold products cannot be unlisted'
    ) {
      ResponseHandler.conflict(res, 'Product cannot be unlisted', err.message);
      return;
    }
    ResponseHandler.internalServerError(
      res,
      'Failed to unlist product',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const relistProduct = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const productService = ServiceFactory.getProductService();
    const id = requireSingleParam(req.params.id);
    if (!id) {
      ResponseHandler.badRequest(res, 'Product ID is required');
      return;
    }
    const user = (req as any).user;

    const existingProduct = await productService.getProductById(id);
    if (!existingProduct) {
      ResponseHandler.notFound(
        res,
        'Product not found',
        `Product with ID ${id} does not exist`,
      );
      return;
    }

    if (existingProduct.userId !== user.uid) {
      ResponseHandler.forbidden(
        res,
        'Access denied',
        'You can only relist your own products',
      );
      return;
    }

    const product = await productService.relistProduct(id);
    ResponseHandler.success(res, product, 'Product relisted successfully');
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message === 'Sold products cannot be relisted' ||
        err.message === 'Product must have stock before it can be relisted')
    ) {
      ResponseHandler.conflict(res, 'Product cannot be relisted', err.message);
      return;
    }
    ResponseHandler.internalServerError(
      res,
      'Failed to relist product',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const likeProduct = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const productService = ServiceFactory.getProductService();
    const user = (req as any).user;
    const id = requireSingleParam(req.params.id);
    if (!id) {
      ResponseHandler.badRequest(res, 'Product ID is required');
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

    // Convert the boolean 'like' flag to a numeric delta (+1 for like, -1 for unlike)
    const { product, liked } = await productService.setProductLikeStatus(
      user.uid,
      id,
      like,
    );

    ResponseHandler.success(
      res,
      {
        ...product,
        liked,
      },
      'Product likes updated successfully',
    );
  } catch (err) {
    if (err instanceof Error && err.message === 'Product not found') {
      ResponseHandler.notFound(
        res,
        'Product not found',
        `Product with ID ${req.params.id} does not exist`,
      );
      return;
    }
    ResponseHandler.internalServerError(
      res,
      'Failed to update product likes',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};
