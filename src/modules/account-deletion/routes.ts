import { NextFunction, Request, Response, Router } from 'express';
import { admin, firestore } from '../../shared/config/firebaseConfig';
import { DeletionError } from './config';
import { DeletionService } from './service';
import { tokenHash } from './crypto';

const service = () => new DeletionService(firestore, admin.auth());
const failure = (res: Response, error: unknown) => {
  const known = error instanceof DeletionError;
  res.status(known ? error.status : 503).json({
    success: false,
    error: known ? error.code : 'DELETION_TEMPORARILY_UNAVAILABLE',
    message:
      'The request could not be completed. Keep your receipt and check its status before retrying.',
  });
};
export async function deletionIdentity(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const header = req.get('Authorization');
  if (!header?.startsWith('Bearer ')) {
    failure(res, new DeletionError('AUTHENTICATION_REQUIRED', 401));
    return;
  }
  try {
    (req as any).user = await admin.auth().verifyIdToken(header.slice(7), true);
  } catch {
    failure(res, new DeletionError('AUTHENTICATION_REQUIRED', 401));
    return;
  }
  next();
}
export const deletionRouter = Router();
// Bounded per-process protection. Cloud Run ingress/instance limits remain a deployment prerequisite.
const windows = new Map<string, { until: number; count: number }>();
deletionRouter.use((req, res, next) => {
  if (!req.path.startsWith('/account')) {
    next();
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  const limits: [string, number][] = [
    [tokenHash(`peer:${req.socket.remoteAddress || ''}`), 100],
    [
      tokenHash(
        `credential:${(req.get('Authorization') || '').slice(0, 4096)}`,
      ),
      30,
    ],
  ];
  const now = Date.now();
  for (const [key, limit] of limits) {
    let window = windows.get(key);
    if (!window || window.until <= now) {
      if (windows.size >= 10000) windows.delete(windows.keys().next().value!);
      window = { until: now + 60000, count: 0 };
      windows.set(key, window);
    }
    if (++window.count > limit) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ success: false, error: 'RATE_LIMITED' });
      return;
    }
  }
  next();
});
deletionRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

/**
 * @swagger
 * /api/auth/account:
 *   delete:
 *     summary: Accept a durable account deletion request (not immediate erasure)
 *     tags: [Authentication]
 *     security: [{bearerAuth: []}]
 *     parameters:
 *       - in: header
 *         name: X-Deletion-Contract
 *         required: true
 *         schema: {type: string, enum: ['1']}
 *       - in: header
 *         name: X-Deletion-Status-Token
 *         required: true
 *         description: Client-generated 32 random bytes encoded as 43-character base64url, saved securely before submission. Reuse on retries.
 *         schema: {type: string, minLength: 43, maxLength: 43}
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             properties:
 *               appleAuthorizationCode: {type: string, maxLength: 4096}
 *     responses:
 *       202:
 *         description: Account restricted and request durably accepted; erasure is pending
 *         content:
 *           application/json:
 *             schema: {$ref: '#/components/schemas/DeletionResponse'}
 *       401: {description: Invalid/revoked credential or authentication older than five minutes}
 *       409: {description: New client contract or Apple re-authorisation required}
 *       400: {description: Invalid receipt or unexpected request fields}
 *       503: {description: Disabled, unapproved policy, missing readiness or temporary failure}
 * /api/auth/account/deletion:
 *   get:
 *     summary: Read own request while Firebase authentication remains available
 *     security: [{bearerAuth: []}]
 *     responses:
 *       200:
 *         description: Current deletion status
 *         content:
 *           application/json:
 *             schema: {$ref: '#/components/schemas/DeletionResponse'}
 *       401: {description: Use receipt route after authentication removal}
 *       404: {description: No request found}
 * /api/auth/account/deletion/status:
 *   post:
 *     summary: Read limited status after sign-out using the secret receipt, never just the reference
 *     security: [{deletionReceipt: []}]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             properties:
 *               requestId: {type: string, format: uuid, description: Optional reference. Omit to recover a lost acceptance response using the saved secret alone.}
 *     responses:
 *       200:
 *         description: Current deletion status, without personal data or order access
 *         content:
 *           application/json:
 *             schema: {$ref: '#/components/schemas/DeletionResponse'}
 *       404: {description: Unknown request, invalid receipt or expired receipt}
 * components:
 *   securitySchemes:
 *     deletionReceipt:
 *       type: http
 *       scheme: bearer
 *       description: Separate 32-byte random deletion status capability, expires after 90 days
 *   schemas:
 *     DeletionResponse:
 *       type: object
 *       properties:
 *         success: {type: boolean}
 *         message: {type: string}
 *         data:
 *           type: object
 *           properties:
 *             requestId: {type: string, format: uuid}
 *             state: {type: string, enum: [accepted, processing, requires_review, retained, retrying, completed]}
 *             accountRestricted: {type: boolean}
 *             requestedAt: {type: string, format: date-time}
 *             updatedAt: {type: string, format: date-time}
 *             eraseTargetAt: {type: string, format: date-time}
 *             responseDueAt: {type: string, format: date-time}
 *             authenticationDeletedAt: {type: string, format: date-time, nullable: true}
 *             liveDataErasedAt: {type: string, format: date-time, nullable: true}
 *             completedAt: {type: string, format: date-time, nullable: true}
 *             statusTokenExpiresAt: {type: string, format: date-time}
 *             nextReviewAt: {type: string, format: date-time, nullable: true}
 *             reason: {type: string, nullable: true}
 */
deletionRouter.delete('/account', deletionIdentity, async (req, res) => {
  try {
    if (req.get('X-Deletion-Contract') !== '1')
      throw new DeletionError('DELETION_CONTRACT_REQUIRED', 409);
    const age = Date.now() / 1000 - (req as any).user.auth_time;
    if (!Number.isFinite(age) || age > 300 || age < -60)
      throw new DeletionError('RECENT_AUTHENTICATION_REQUIRED', 401);
    if (
      req.body &&
      (typeof req.body !== 'object' ||
        Array.isArray(req.body) ||
        Object.keys(req.body).some((key) => key !== 'appleAuthorizationCode') ||
        (req.body.appleAuthorizationCode !== undefined &&
          typeof req.body.appleAuthorizationCode !== 'string'))
    ) {
      throw new DeletionError('INVALID_REQUEST', 400);
    }
    const data = await service().request(
      (req as any).user.uid,
      req.get('X-Deletion-Status-Token') || '',
      req.body?.appleAuthorizationCode,
    );
    res.status(data.state === 'completed' ? 200 : 202).json({
      success: true,
      message: 'Deletion request recorded. Check the status for progress.',
      data,
    });
  } catch (error) {
    failure(res, error);
  }
});
deletionRouter.get('/account/deletion', deletionIdentity, async (req, res) => {
  try {
    res.json({
      success: true,
      data: await service().statusForUser((req as any).user.uid),
    });
  } catch (error) {
    failure(res, error);
  }
});
deletionRouter.post('/account/deletion/status', async (req, res) => {
  try {
    const header = req.get('Authorization') || '';
    if (
      !header.startsWith('Bearer ') ||
      !req.body ||
      typeof req.body !== 'object' ||
      Array.isArray(req.body) ||
      (req.body.requestId !== undefined &&
        typeof req.body.requestId !== 'string') ||
      Object.keys(req.body).some((key) => key !== 'requestId')
    )
      throw new DeletionError('REQUEST_NOT_FOUND', 404);
    res.json({
      success: true,
      data: await service().statusWithReceipt(
        req.body.requestId,
        header.slice(7),
      ),
    });
  } catch (error) {
    failure(res, error);
  }
});
