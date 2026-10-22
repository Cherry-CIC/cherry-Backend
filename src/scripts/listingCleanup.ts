// A bounded scheduled job. Dry run by default; does not start with the web server.
import { localFirebaseEmulators } from '../shared/config/firebaseEmulators';

export function cleanupArguments(args: string[], env: NodeJS.ProcessEnv) {
  const allowed = new Set(['--apply', '--project', '--limit', '--retry']);
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.has(key) || values.has(key))
      throw new Error('Invalid or repeated cleanup argument.');
    if (key === '--apply') values.set(key, 'true');
    else {
      const value = args[++i];
      if (!value || value.startsWith('--'))
        throw new Error(`Missing value for ${key}.`);
      values.set(key, value);
    }
  }
  const project = values.get('--project');
  if (!project || project !== env.FIREBASE_PROJECT_ID)
    throw new Error('--project must match FIREBASE_PROJECT_ID.');
  const emulators = localFirebaseEmulators(env);
  if (emulators && !project.startsWith('demo-'))
    throw new Error('Cleanup emulator runs require a demo- project.');
  if (!emulators && env.NODE_ENV !== 'production')
    throw new Error(
      'Use isolated emulators or an explicitly configured production job.',
    );
  const apply = values.has('--apply');
  const limit = Number(values.get('--limit') ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Use a limit between 1 and 100.');
  const retry = values.get('--retry');
  if (retry && (!apply || !/^[a-zA-Z0-9_-]{3,150}$/.test(retry)))
    throw new Error('--retry requires --apply and a valid job ID.');
  return { apply, limit, retry };
}

async function main() {
  const options = cleanupArguments(process.argv.slice(2), process.env);
  // Import credentials only after validating the explicit project and emulator configuration.
  const { firestore } = await import('../shared/config/firebaseConfig');
  const { ListingCleanupWorker } =
    await import('../modules/products/cleanup/worker');
  const { ListingCleanupStorage } =
    await import('../modules/products/cleanup/storage');
  const { DELETION_JOBS } = await import('../modules/products/cleanup/jobs');
  try {
    if (options.retry) {
      const ref = firestore.collection(DELETION_JOBS).doc(options.retry);
      await firestore.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        if (!doc.exists || !['review', 'waiting'].includes(doc.get('status')))
          throw new Error('Only review or waiting jobs can be retried.');
        tx.update(ref, {
          status: 'pending',
          attempts: 0,
          nextAttemptAt: new Date(),
        });
      });
    }
    const result = await new ListingCleanupWorker(
      firestore,
      new ListingCleanupStorage(),
    ).run(options.limit, options.apply);
    // Never print photo URLs, credentials, participant details or provider error bodies.
    console.log(
      JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', ...result }),
    );
  } finally {
    await firestore.terminate();
  }
}

if (require.main === module)
  main().catch(() => {
    console.error(
      'Listing cleanup failed. Check configuration and job state; no raw provider errors are logged.',
    );
    process.exitCode = 1;
  });
