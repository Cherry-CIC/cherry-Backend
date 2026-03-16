import { initializeApp, cert } from 'firebase-admin/app';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getApps as getClientApps, initializeApp as initializeClientApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || 'cherry-mvp-dev';
const usingEmulators = Boolean(
  process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST
);

// Firebase client SDK config used by backend auth helpers.
const firebaseClientConfig = {
  apiKey: process.env.FIREBASE_API_KEY || 'dummy-api-key',
  projectId: firebaseProjectId,
  ...(process.env.FIREBASE_AUTH_DOMAIN
    ? { authDomain: process.env.FIREBASE_AUTH_DOMAIN }
    : {}),
};

const clientApp = getClientApps()[0] || initializeClientApp(firebaseClientConfig);
const clientAuth = getAuth(clientApp);

if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  connectAuthEmulator(
    clientAuth,
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`
  );
}

if (!admin.apps.length) {
  if (process.env.NODE_ENV === 'production') {
    initializeApp({
      projectId: firebaseProjectId,
    });
  } else if (usingEmulators) {
    initializeApp({
      projectId: firebaseProjectId,
    });
  } else if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    initializeApp({
      credential: cert({
        type: process.env.FIREBASE_TYPE,
        project_id: firebaseProjectId,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: process.env.FIREBASE_AUTH_URI,
        token_uri: process.env.FIREBASE_TOKEN_URI,
        auth_provider_x509_cert_url:
          process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
        client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
        universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
      } as any),
      projectId: firebaseProjectId,
    });
  } else {
    console.warn(
      'Firebase Admin initialised without a service account. Set FIREBASE_* credentials or enable the local emulators.'
    );
    initializeApp({
      projectId: firebaseProjectId,
    });
  }
}

export const firestore = getFirestore();
export { admin, clientAuth };
