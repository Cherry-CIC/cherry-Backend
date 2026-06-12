import { ProductService } from './ProductService';
import { ProductRepository } from '../repositories/ProductRepository';
import { CategoryRepository } from '../../categories/repositories/CategoryRepository';
import { CharityRepository } from '../../charities/repositories/CharityRepository';
import { PostageSizeRepository } from '../../postage-sizes/repositories/PostageSizeRepository';

export class ServiceFactory {
    private static productService: ProductService | null = null;

    static getProductService(): ProductService {
        if (!this.productService) {
            const productRepo = new ProductRepository();
            const categoryRepo = new CategoryRepository();
            const charityRepo = new CharityRepository();
            const postageSizeRepo = new PostageSizeRepository();
            
            this.productService = new ProductService(
                productRepo,
                categoryRepo,
                charityRepo,
                postageSizeRepo,
            );
        }
        
        return this.productService;
    }

    // Reset for testing purposes
    static reset(): void {
        this.productService = null;
    }
}
