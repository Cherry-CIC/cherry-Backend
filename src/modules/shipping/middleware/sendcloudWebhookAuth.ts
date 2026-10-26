import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';
import { ResponseHandler } from '../../../shared/utils/responseHandler';

const isValidSignature = (signature: string, expected: string): boolean => {
  if (!/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  return (
    signatureBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  );
};

export const verifySendcloudWebhookSignature = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const signature = req.get('Sendcloud-Signature');
  const signatureKeys = [
    sendcloudConfig.webhookSignatureKey,
    sendcloudConfig.secretKey,
  ]
    .map((key) => key?.trim())
    .filter((key, index, keys): key is string =>
      Boolean(key) && keys.indexOf(key) === index,
    );

  if (signatureKeys.length === 0) {
    ResponseHandler.internalServerError(
      res,
      'Sendcloud webhook signature key is not configured',
    );
    return;
  }

  if (!signature) {
    ResponseHandler.unauthorized(
      res,
      'Missing Sendcloud signature',
      'Sendcloud-Signature header is required',
    );
    return;
  }

  const rawBody = (req as any).rawBody;
  const payload = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(JSON.stringify(req.body));
  const matchesSignature = signatureKeys.some((signatureKey) => {
    const expectedSignature = crypto
      .createHmac('sha256', signatureKey)
      .update(payload)
      .digest('hex');

    return isValidSignature(signature, expectedSignature);
  });

  if (!matchesSignature) {
    ResponseHandler.unauthorized(
      res,
      'Invalid Sendcloud signature',
      'Sendcloud webhook signature could not be verified',
    );
    return;
  }

  next();
};
