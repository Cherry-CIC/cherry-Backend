import axios from 'axios';
import { DeletionError } from './config';
import { encryptSecret, decryptSecret } from './crypto';

function credentials() {
  const client_id = process.env.APPLE_CLIENT_ID;
  const client_secret = process.env.APPLE_CLIENT_SECRET;
  if (!client_id || !client_secret)
    throw new DeletionError('APPLE_CONFIGURATION_REQUIRED');
  return { client_id, client_secret };
}

export async function prepareAppleRevocation(
  code: string,
  expectedAppleUid: string,
): Promise<string> {
  if (!code || code.length > 4096)
    throw new DeletionError('APPLE_REAUTHORISATION_REQUIRED', 409);
  // Validate encryption configuration before exchanging the one-use code.
  encryptSecret('configuration-check');
  try {
    const response = await axios.post<{
      refresh_token?: string;
      id_token?: string;
    }>(
      'https://appleid.apple.com/auth/token',
      new URLSearchParams({
        ...credentials(),
        code,
        grant_type: 'authorization_code',
      }).toString(),
      {
        timeout: 15000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );
    const token = response.data.refresh_token;
    if (typeof token !== 'string' || !token)
      throw new Error('Missing refresh token');
    // This ID token comes directly from Apple's authenticated TLS token endpoint,
    // never from an unverified client. Bind the exchanged code to the linked user.
    const claims = JSON.parse(
      Buffer.from(
        response.data.id_token?.split('.')[1] || '',
        'base64url',
      ).toString('utf8'),
    );
    if (
      claims.sub !== expectedAppleUid ||
      claims.aud !== credentials().client_id
    )
      throw new Error('Apple identity mismatch');
    return encryptSecret(token);
  } catch {
    // Axios errors can include the client secret and authorisation code.
    throw new DeletionError('APPLE_REAUTHORISATION_REQUIRED', 409);
  }
}

export async function revokeApple(encryptedToken: string): Promise<void> {
  try {
    await axios.post(
      'https://appleid.apple.com/auth/revoke',
      new URLSearchParams({
        ...credentials(),
        token: decryptSecret(encryptedToken),
        token_type_hint: 'refresh_token',
      }).toString(),
      {
        timeout: 15000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );
  } catch {
    throw new DeletionError('APPLE_REVOCATION_RETRY');
  }
}
