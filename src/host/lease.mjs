export const problem = (code, message) => Object.assign(new Error(message), { code });

// Advisory only: the SDK has neither exclusive create nor compare-and-swap.
// Every caller still verifies the destination file around its own write.
export async function acquireLease(storage, key, { writer, now, timers, settle = 35 }) {
  const stamp = { writer, expires: now() + 12_000 };
  const current = await storage.get(key);
  if (current?.writer !== writer && current?.expires > now()) throw problem('CONFLICT', 'Another panel has an operation in progress');
  await storage.set(key, stamp);
  if (settle) await new Promise((resolve) => timers.setTimeout(resolve, settle));
  const verify = async () => {
    const lock = await storage.get(key);
    if (lock?.writer !== writer || lock.expires <= now()) throw problem('CONFLICT', 'This operation no longer owns the lease');
  };
  const release = async () => {
    if ((await storage.get(key))?.writer === writer) await storage.delete(key);
  };
  try { await verify(); } catch (error) { await release().catch(() => {}); throw error; }
  return { verify, release };
}
