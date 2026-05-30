const mockGetAll = jest.fn();

jest.mock('../repositories/PostageSizeRepository', () => ({
  PostageSizeRepository: jest.fn().mockImplementation(() => ({
    getAll: mockGetAll,
  })),
}));

import express from 'express';
import request from 'supertest';
import postageSizeRoutes from '../routes/postageSizeRoutes';

describe('postageSizeRoutes', () => {
  const app = express();
  app.use('/api/postage-sizes', postageSizeRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns postage sizes at GET /api/postage-sizes', async () => {
    mockGetAll.mockResolvedValue([
      {
        id: 'small-id',
        type: 'inpost',
        size: 'small',
        description: 'Small parcel',
      },
    ]);

    const response = await request(app).get('/api/postage-sizes');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        message: 'Postage sizes fetched successfully',
        data: [
          {
            id: 'small-id',
            type: 'inpost',
            size: 'small',
            description: 'Small parcel',
          },
        ],
      }),
    );
  });
});
