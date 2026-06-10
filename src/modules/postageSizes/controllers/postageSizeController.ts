import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { PostageSizeRepository } from '../repositories/PostageSizeRepository';

const repo = new PostageSizeRepository();

export const getAllPostageSizes = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const postageSizes = await repo.getAll();
    ResponseHandler.success(
      res,
      postageSizes,
      'Postage sizes fetched successfully',
    );
  } catch (err) {
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch postage sizes',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};
