import { OAuth2Client } from 'google-auth-library';
import { getOrderReleaseTaskConfiguration } from './OrderReleaseTaskQueue';

const oauthClient = new OAuth2Client();

export const isAuthorizedOrderReleaseTask = async (
  authorizationHeader: string | undefined,
): Promise<boolean> => {
  const configuration = getOrderReleaseTaskConfiguration();
  const token = authorizationHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    return false;
  }

  const ticket = await oauthClient.verifyIdToken({
    idToken: token,
    audience: configuration.audience,
  });
  const payload = ticket.getPayload();
  return (
    payload?.email === configuration.serviceAccountEmail &&
    payload.email_verified === true
  );
};
