process.env.NODE_ENV = 'test';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_mock';
process.env.STRIPE_PUBLISHABLE_KEY =
  process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_mock';
process.env.FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || 'cherry-test-project';
process.env.FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY || 'firebase-test-api-key';
process.env.FIREBASE_STORAGE_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET || 'cherry-test.appspot.com';
process.env.SENDCLOUD_WEBHOOK_SECRET =
  process.env.SENDCLOUD_WEBHOOK_SECRET || 'sendcloud-test-secret';
process.env.SENDCLOUD_MODE = process.env.SENDCLOUD_MODE || 'mock';
