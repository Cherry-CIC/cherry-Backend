import path from 'node:path';

import { buildIndexFromEnvironment, saveIndex } from '../src/retrieval';

async function main(): Promise<void> {
  const indexPath = process.env.INDEX_PATH ?? path.join(process.cwd(), 'data', 'index.json');
  const index = await buildIndexFromEnvironment(process.env);
  await saveIndex(indexPath, index);
  console.log(`Built cherry-help index with ${index.chunks.length} chunks.`);
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'UnknownError';
  console.error(`Failed to build cherry-help index: ${name}.`);
  process.exit(1);
});
