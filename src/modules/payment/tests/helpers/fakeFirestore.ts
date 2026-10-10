// In-memory stand-in for the Firestore calls used in transactions (tests only)
type Data = Record<string, any>;

export const createFakeFirestore = (seed: Record<string, Data> = {}) => {
  const store = new Map<string, Data>(Object.entries(seed));
  let autoId = 0;

  const docRef = (collection: string, id: string) => ({
    id,
    path: `${collection}/${id}`,
  });

  const snapshot = (path: string) => {
    const data = store.get(path);
    return {
      exists: data !== undefined,
      data: () => (data === undefined ? undefined : { ...data }),
    };
  };

  const firestore = {
    collection: (collection: string) => ({
      doc: (id?: string) => docRef(collection, id ?? `auto-${++autoId}`),
    }),
    runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      const writes: Array<() => void> = [];
      const tx = {
        get: async (ref: { path: string }) => snapshot(ref.path),
        set: (ref: { path: string }, data: Data) => {
          writes.push(() => store.set(ref.path, { ...data }));
        },
        update: (ref: { path: string }, data: Data) => {
          writes.push(() => {
            const current = store.get(ref.path);
            if (!current) {
              throw new Error(`No document to update: ${ref.path}`);
            }
            store.set(ref.path, { ...current, ...data });
          });
        },
      };
      const result = await fn(tx);
      writes.forEach((write) => write());
      return result;
    },
  };

  return { firestore, store };
};
