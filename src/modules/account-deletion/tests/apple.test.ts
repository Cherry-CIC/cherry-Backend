import axios from 'axios';
import { prepareAppleRevocation, revokeApple } from '../apple';
import { decryptSecret } from '../crypto';
jest.mock('axios');
const post = axios.post as jest.Mock;
beforeEach(() => {
  post.mockReset();
  process.env.APPLE_CLIENT_ID = 'test.app';
  process.env.APPLE_CLIENT_SECRET = 'test-secret';
  process.env.ACCOUNT_DELETION_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString(
    'base64',
  );
});
test('exchanged Apple identity must match the Firebase-linked account', async () => {
  const claims = Buffer.from(
    JSON.stringify({ sub: 'another-user', aud: 'test.app' }),
  ).toString('base64url');
  post.mockResolvedValue({
    data: { refresh_token: 'secret', id_token: `header.${claims}.signature` },
  });
  await expect(prepareAppleRevocation('code', 'owner')).rejects.toThrow(
    'APPLE_REAUTHORISATION_REQUIRED',
  );
});
test('revocation secret is encrypted durably and used only with Apple', async () => {
  const claims = Buffer.from(
    JSON.stringify({ sub: 'owner', aud: 'test.app' }),
  ).toString('base64url');
  post.mockResolvedValue({
    data: { refresh_token: 'secret', id_token: `header.${claims}.signature` },
  });
  const encrypted = await prepareAppleRevocation('code', 'owner');
  expect(encrypted).not.toContain('secret');
  expect(decryptSecret(encrypted)).toBe('secret');
  await revokeApple(encrypted);
  expect(post.mock.calls[1][0]).toBe('https://appleid.apple.com/auth/revoke');
});
