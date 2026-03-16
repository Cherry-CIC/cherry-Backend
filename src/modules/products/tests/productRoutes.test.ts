// src/modules/products/__tests__/productRoutes.test.ts
import request from 'supertest';
import app from '../../../app';

describe('Product API', () => {
    it('should return all products', async () => {
        const res = await request(app).get('/api/products');
        expect(res.statusCode).toEqual(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});
