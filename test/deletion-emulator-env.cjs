Object.assign(process.env, {
  FIREBASE_PROJECT_ID: 'demo-cherry-deletion', FIREBASE_API_KEY: 'demo-key',
  FIREBASE_STORAGE_BUCKET: 'demo-cherry-deletion.appspot.com',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199', ACCOUNT_DELETION_MODE: 'emulator',
  ACCOUNT_DELETION_WORKER_ENABLED: 'true', SENDCLOUD_MODE: 'mock',
  ACCOUNT_DELETION_POLICY: JSON.stringify({ policyVersion: 'test-only-v1', orderEvidenceMonths: 18,
    financialYears: 6, financialYearEndMonth: 3, financialYearEndDay: 31, auditDays: 30, backupDays: 30, reviewDays: 1 }),
});
