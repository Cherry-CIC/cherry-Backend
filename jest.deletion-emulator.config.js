module.exports = {
  preset: 'ts-jest', testEnvironment: 'node',
  testMatch: ['**/account-deletion/tests/*.emulator.test.ts'],
  setupFiles: ['<rootDir>/test/deletion-emulator-env.cjs'],
  testTimeout: 120000, maxWorkers: 1,
};
