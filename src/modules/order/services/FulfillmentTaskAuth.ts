import { OAuth2Client } from 'google-auth-library';
import { getFulfillmentTaskConfiguration } from './FulfillmentTaskQueue';

const oauthClient = new OAuth2Client();

export const isAuthorizedFulfillmentTask = async (
  authorizationHeader: string | undefined,
): Promise<boolean> => {
  const configuration = getFulfillmentTaskConfiguration();
  const token = authorizationHeader?.match(/^Bearer (.+)$/)?.[1];
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
