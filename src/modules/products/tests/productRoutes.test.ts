// src/modules/products/__tests__/productRoutes.test.ts
import request from 'supertest';
import app from '../../../app';

describe('Product API', () => {
    it('should require authentication for product listing', async () => {
        const res = await request(app).get('/api/products');
        expect(res.statusCode).toEqual(401);
        expect(res.body.success).toBe(false);
    });
});
