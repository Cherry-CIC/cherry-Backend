import { validateProduct } from '../validators/productValidator';

const createResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const validProductPayload = {
  name: 'Winter Coat',
  description: 'A warm donated coat',
  categoryId: 'category-1',
  charityId: 'charity-1',
  quality: 'Good',
  size: 'Medium',
  product_images: ['https://example.com/coat.jpg'],
  donation: 10,
  price: 25,
  likes: 0,
  number: 1,
};

describe('productValidator', () => {
  it('accepts a valid postage_size value', () => {
    const req: any = {
      body: {
        ...validProductPayload,
        postage_size: 'small',
      },
    };
    const res = createResponse();
    const next = jest.fn();

    validateProduct(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects an unsupported postage_size value', () => {
    const req: any = {
      body: {
        ...validProductPayload,
        postage_size: 'extra_large',
      },
    };
    const res = createResponse();
    const next = jest.fn();

    validateProduct(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('postage_size'),
      }),
    );
  });
});
