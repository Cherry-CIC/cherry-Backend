import { Product } from '../model/Product';
import { Category } from '../../categories/model/Category';
import { Charity } from '../../charities/model/Charity';
import { ProductRepository } from '../repositories/ProductRepository';
import { CategoryRepository } from '../../categories/repositories/CategoryRepository';
import { CharityRepository } from '../../charities/repositories/CharityRepository';

export class ProductService {
    constructor(
        private productRepo: ProductRepository,
        private categoryRepo: CategoryRepository,
        private charityRepo: CharityRepository
    ) {}

    async getAllProducts(): Promise<Product[]> {
        return this.productRepo.getAll();
    }

    async getProductById(id: string): Promise<Product | null> {
        return this.productRepo.getById(id);
    }

    async getProductsByUserId(userId: string): Promise<Product[]> {
        return this.productRepo.getByUserId(userId);
    }

    async createProduct(data: CreateProductData & { userId: string }): Promise<Product> {
        // Validate that category and charity exist
        await this.validateReferences(data.categoryId, data.charityId);
        
        const product: Product = {
            ...data,
            likes: data.likes || 0,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        return this.productRepo.create(product);
    }

    async getProductWithDetails(id: string): Promise<ProductWithDetails | null> {
        const product = await this.productRepo.getById(id);
        if (!product) {
            return null;
        }

        // Only fetch category and charity if IDs exist and are valid strings
        const categoryPromise = product.categoryId && typeof product.categoryId === 'string' && product.categoryId.trim()
            ? this.categoryRepo.getById(product.categoryId)
            : Promise.resolve(null);
        
        const charityPromise = product.charityId && typeof product.charityId === 'string' && product.charityId.trim()
            ? this.charityRepo.getById(product.charityId)
            : Promise.resolve(null);

        const [category, charity] = await Promise.all([
            categoryPromise,
            charityPromise
        ]);

        return {
            ...product,
            category: category || undefined,
            charity: charity || undefined
        };
    }

    async getAllProductsWithDetails(): Promise<ProductWithDetails[]> {
        const products = await this.productRepo.getAll();

        const productsWithDetails = await Promise.all(
            products.map(async (product) => {
                try {
                    // Only fetch category and charity if IDs exist and are valid strings
                    const categoryPromise = product.categoryId &&
                                          product.categoryId.trim().length > 0
                        ? this.categoryRepo.getById(product.categoryId).catch(() => null)
                        : Promise.resolve(null);

                    const charityPromise = product.charityId &&
                                         typeof product.charityId === 'string' &&
                                         product.charityId.trim().length > 0
                        ? this.charityRepo.getById(product.charityId).catch(() => null)
                        : Promise.resolve(null);

                    const [category, charity] = await Promise.all([
                        categoryPromise,
                        charityPromise
                    ]);

                    return {
                        ...product,
                        category: category || undefined,
                        charity: charity || undefined
                    };
                } catch (error) {
                    // If there's an error fetching details, return product without details
                    console.error(`Error fetching details for product ${product.id}:`, error);
                    return {
                        ...product,
                        category: undefined,
                        charity: undefined
                    };
                }
            })
        );

        return productsWithDetails;
    }

    async getProductsByCategory(categoryId: string): Promise<Product[]> {
        // Validate category exists
        const category = await this.categoryRepo.getById(categoryId);
        if (!category) {
            throw new Error('Category not found');
        }

        return this.productRepo.getProductsByCategory(categoryId);
    }

    async getProductsByCharity(charityId: string): Promise<Product[]> {
        // Validate charity exists
        const charity = await this.charityRepo.getById(charityId);
        if (!charity) {
            throw new Error('Charity not found');
        }

        return this.productRepo.getProductsByCharity(charityId);
    }

    async updateProduct(id: string, data: UpdateProductData): Promise<Product | null> {
        // Check if product exists
        const existingProduct = await this.productRepo.getById(id);
        if (!existingProduct) {
            return null;
        }

        // Validate category and charity references if they are being updated
        if (data.categoryId || data.charityId) {
            const categoryId = data.categoryId || existingProduct.categoryId;
            const charityId = data.charityId || existingProduct.charityId;
            
            if (categoryId && charityId) {
                await this.validateReferences(categoryId, charityId);
            }
        }

        return this.productRepo.update(id, data);
    }

    async deleteProduct(id: string): Promise<boolean> {
      return this.productRepo.delete(id);
    }
  
    /**
     * Adjust the product's likes/points by a signed delta.
     * Positive delta increments, negative delta decrements.
     */
    async changePoints(id: string, delta: number): Promise<Product | null> {
      // Ensure the product exists
      const product = await this.productRepo.getById(id);
      if (!product) {
        return null;
      }
      // Delegate to repository's atomic adjustLikes method
      return this.productRepo.adjustLikes(id, delta);
    }

    /**
     * Add a like from a user to a product.
     * Idempotent: safe to call multiple times.
     */
    async likeProduct(productId: string, userId: string): Promise<Product | null> {
      return this.productRepo.addLike(productId, userId);
    }

    /**
     * Remove a like from a user to a product.
     * Idempotent: safe to call even if user hasn't liked.
     */
    async unlikeProduct(productId: string, userId: string): Promise<Product | null> {
      return this.productRepo.removeLike(productId, userId);
    }

    /**
     * Get all products liked by a specific user with pagination support.
     */
    async getProductsLikedByUser(userId: string, limit?: number, startAfter?: string): Promise<Product[]> {
      return this.productRepo.getProductsLikedByUser(userId, limit, startAfter);
    }
  
    private async validateReferences(categoryId: string, charityId: string): Promise<void> {
        const [category, charity] = await Promise.all([
            this.categoryRepo.getById(categoryId),
            this.charityRepo.getById(charityId)
        ]);
        
        if (!category) {
            throw new Error('Category not found');
        }
        
        if (!charity) {
            throw new Error('Charity not found');
        }
    }
}

export interface ProductWithDetails extends Product {
    category?: Category;
    charity?: Charity;
}

export interface CreateProductData {
    name: string;
    description?: string;
    categoryId: string;
    charityId: string;
    quality: string;
    size: string;
    product_images: string[];
    donation: number;
    price: number;
    likes?: number;
    number: number;
}

export interface UpdateProductData {
    name?: string;
    description?: string;
    categoryId?: string;
    charityId?: string;
    quality?: string;
    size?: string;
    product_images?: string[];
    donation?: number;
    price?: number;
    likes?: number;
    number?: number;
}
