/** Runs async tasks with a fixed concurrency limit, preserving input order in the result. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i] as T, i);
      }
    }),
  );
  return results;
}
