// A partial emulator setup could send test requests to hosted Firebase services.
// Require all three services on this machine before enabling local credentials.
export function localFirebaseEmulators(env: NodeJS.ProcessEnv = process.env) {
  const authHost = env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreHost = env.FIRESTORE_EMULATOR_HOST;
  const storageHost = env.FIREBASE_STORAGE_EMULATOR_HOST;
  if (!authHost && !firestoreHost && !storageHost && !env.STORAGE_EMULATOR_HOST)
    return undefined;
  if (env.NODE_ENV === 'production')
    throw new Error('Firebase emulators must not be enabled in production.');

  const isLoopback = (host: string | undefined): host is string => {
    const match = host?.match(
      /^(localhost|127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})$/,
    );
    return !!match && Number(match[2]) <= 65535;
  };
  if (
    !isLoopback(authHost) ||
    !isLoopback(firestoreHost) ||
    !isLoopback(storageHost)
  )
    throw new Error(
      'Set Auth, Firestore and Storage emulator hosts to loopback host:port addresses together.',
    );

  const storageOrigin = `http://${storageHost}`;
  // The Admin SDK honours this alternative variable before the Firebase one.
  if (env.STORAGE_EMULATOR_HOST && env.STORAGE_EMULATOR_HOST !== storageOrigin)
    throw new Error(
      'Storage emulator host variables must identify the same local service.',
    );
  return {
    authHost,
    firestoreHost,
    storageHost,
    storageOrigin: new URL(storageOrigin).origin,
  };
}
