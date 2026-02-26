import { initializeApp, cert } from 'firebase-admin/app';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp as initializeClientApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

// Firebase client SDK config (used for auth on the client side utilities)
const firebaseClientConfig = {
  apiKey: process.env.FIREBASE_API_KEY || 'dummy-api-key',
  projectId: process.env.FIREBASE_PROJECT_ID || 'cherry-mvp-dev',
};

// Initialise client app
const clientApp = initializeClientApp(firebaseClientConfig);
const clientAuth = getAuth(clientApp);

// If emulator host is provided, connect the client auth to it
if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.log(`Connecting to Firebase Auth Emulator: ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
  connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
}

if (process.env.NODE_ENV === 'production') {
  // In Cloud Run, use Application Default Credentials (ADC)
  initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
} else {
  // Initialise Admin SDK
  if (!admin.apps.length) {
    // Check if we have enough info for a service account, or if we are using emulators
    const hasServiceAccount = process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL;
    
    if (hasServiceAccount) {
      initializeApp({
        credential: cert({
          type: process.env.FIREBASE_TYPE,
          project_id: process.env.FIREBASE_PROJECT_ID,
          private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
          private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          client_email: process.env.FIREBASE_CLIENT_EMAIL,
          client_id: process.env.FIREBASE_CLIENT_ID,
          auth_uri: process.env.FIREBASE_AUTH_URI,
          token_uri: process.env.FIREBASE_TOKEN_URI,
          auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
          client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
          universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
        } as any),
      });
    } else {
      // Fallback for local development/emulators without a full service account JSON
      console.warn('No Firebase service account found. Falling back to default project ID for Emulators.');
      initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || 'cherry-mvp-dev',
      });
    }
  }
}

// Export commonly used Firebase objects
export const firestore = getFirestore();
export { clientAuth, admin };
