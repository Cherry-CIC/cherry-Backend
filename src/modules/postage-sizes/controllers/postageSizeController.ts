import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { requireSingleParam } from '../../../shared/utils/requestParam';
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

export const updatePostageSize = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = requireSingleParam(req.params.id);
    if (!id) {
      ResponseHandler.badRequest(res, 'Postage size ID is required');
      return;
    }

    const updatedPostageSize = await repo.update(id, req.body);

    if (!updatedPostageSize) {
      ResponseHandler.notFound(
        res,
        'Postage size not found',
        `Postage size with ID ${id} does not exist`,
      );
      return;
    }

    ResponseHandler.success(
      res,
      updatedPostageSize,
      'Postage size updated successfully',
    );
  } catch (err) {
    ResponseHandler.internalServerError(
      res,
      'Failed to update postage size',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};
