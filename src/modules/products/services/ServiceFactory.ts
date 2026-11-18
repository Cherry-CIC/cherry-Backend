import { ProductService } from './ProductService';
import { ProductRepository } from '../repositories/ProductRepository';
import { ProductLikeRepository } from '../repositories/ProductLikeRepository';
import { CategoryRepository } from '../../categories/repositories/CategoryRepository';
import { CharityRepository } from '../../charities/repositories/CharityRepository';
import { PostageSizeRepository } from '../../postage-sizes/repositories/PostageSizeRepository';
import { OrderRepository } from '../../order/repositories/OrderRepository';
import { UserBlockRepository } from '../../blocks/repositories/UserBlockRepository';
import { RecommendationService } from './RecommendationService';

export class ServiceFactory {
    private static productService: ProductService | null = null;
    private static recommendationService: RecommendationService | null = null;

    static getProductService(): ProductService {
        if (!this.productService) {
            const productRepo = new ProductRepository();
            const productLikeRepo = new ProductLikeRepository();
            const categoryRepo = new CategoryRepository();
            const charityRepo = new CharityRepository();
            const postageSizeRepo = new PostageSizeRepository();
            
            this.productService = new ProductService(
                productRepo,
                productLikeRepo,
                categoryRepo,
                charityRepo,
                postageSizeRepo,
            );
        }
        
        return this.productService;
    }

    // One shared instance, so its in-memory feed order is shared by every
    // request.
    static getRecommendationService(): RecommendationService {
        if (!this.recommendationService) {
            this.recommendationService = new RecommendationService(
                this.getProductService(),
                new ProductLikeRepository(),
                new OrderRepository(),
                new UserBlockRepository(),
            );
        }

        return this.recommendationService;
    }

    // Reset for testing purposes
    static reset(): void {
        this.productService = null;
        this.recommendationService = null;
    }
}
