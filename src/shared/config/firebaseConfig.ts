import { initializeApp, cert } from 'firebase-admin/app';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp as initializeClientApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { localFirebaseEmulators } from './firebaseEmulators';

const emulators = localFirebaseEmulators();

// Firebase client SDK config (used for auth on the client side)
const firebaseClientConfig = {
  apiKey:
    process.env.FIREBASE_API_KEY ||
    (emulators ? 'local-emulator-key' : undefined),
  projectId: process.env.FIREBASE_PROJECT_ID,
  // authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  // storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  // messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  // appId: process.env.FIREBASE_APP_ID,
};

// Initialise client app (for client‑side Auth utilities)
const clientApp = initializeClientApp(firebaseClientConfig);
if (emulators) {
  if (!process.env.FIREBASE_PROJECT_ID)
    throw new Error('FIREBASE_PROJECT_ID is required for local emulators.');
  if (!admin.apps.length) {
    initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  }
} else if (process.env.NODE_ENV === 'production') {
  // In Cloud Run, use Application Default Credentials (ADC)
  initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}else{
  // Initialise Admin SDK (for server‑side Firestore & Auth)
  // Use full service‑account credentials from .env. Cast to any to avoid strict type errors.
  if (!admin.apps.length) {
    // @ts-ignore
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
        auth_provider_x509_cert_url:
          process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
        client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
        universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
      } as any),
    });
  }
}

// Export commonly used Firebase objects
export const firestore = getFirestore();
export const clientAuth = getAuth(clientApp);
if (emulators) connectAuthEmulator(clientAuth, `http://${emulators.authHost}`);
export { admin };
