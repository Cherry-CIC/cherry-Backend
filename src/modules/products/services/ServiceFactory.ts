import { ProductService } from './ProductService';
import { ProductRepository } from '../repositories/ProductRepository';
import { CategoryRepository } from '../../categories/repositories/CategoryRepository';
import { CharityRepository } from '../../charities/repositories/CharityRepository';

export class ServiceFactory {
    private static productService: ProductService | null = null;

    static getProductService(): ProductService {
        if (!this.productService) {
            const productRepo = new ProductRepository();
            const categoryRepo = new CategoryRepository();
            const charityRepo = new CharityRepository();
            
            this.productService = new ProductService(productRepo, categoryRepo, charityRepo);
        }
        
        return this.productService;
    }

    // Reset for testing purposes
    static reset(): void {
        this.productService = null;
    }
}