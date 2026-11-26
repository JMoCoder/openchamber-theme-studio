import { uid } from '../core/project.mjs';

export const byteLength = (value) => new TextEncoder().encode(value).length;
const limit = 60 * 1024; // Leave room for the SDK value envelope.
const prefix = 'studio:v1:';

export function createPersistence(storage) {
  const serialize = new Map();
  async function read(name, retried = false) {
    const address = `${prefix}${name}`;
    const head = await storage.get(address);
    if (head === undefined || head === null) return undefined;
    if (!head.pages) return head.value;
    if (!Number.isInteger(head.pages) || head.pages < 1 || head.pages > 40 ||
      typeof head.generation !== 'string' || !/^[\w-]{1,128}$/u.test(head.generation)) throw new Error('storageInvalid');
    const chunks = await Promise.all(Array.from({ length: head.pages },
      (_, i) => storage.get(`${address}:${head.generation}:${i}`)));
    if (chunks.some((chunk) => typeof chunk !== 'string')) {
      if (!retried) return read(name, true);
      throw new Error('storageIncomplete');
    }
    return JSON.parse(chunks.join(''));
  }
  async function discard(address, head) {
    if (!head?.generation || !Number.isInteger(head?.pages) || head.pages > 40) return;
    await Promise.allSettled(Array.from({ length: head.pages },
      (_, i) => storage.delete(`${address}:${head.generation}:${i}`)));
  }
  async function write(name, value) {
    const address = `${prefix}${name}`;
    const json = JSON.stringify(value);
    if (typeof json !== 'string' || byteLength(json) > 560 * 1024) throw new Error('storageValueTooLarge');
    const previous = await storage.get(address);
    if (byteLength(`{"value":${json}}`) <= limit) {
      await storage.set(address, { value });
    } else {
      const generation = uid();
      let pages = 0;
      try {
        // 16,000 UTF-16 units keep encoded strings < 64 KB even for control chars
        // escaped twice by JSON; avoid splitting surrogate pairs.
        for (let i = 0; i < json.length;) {
          let end = Math.min(json.length, i + 16_000);
          if (/[\uD800-\uDBFF]/u.test(json[end - 1]) && end < json.length) --end;
          if (pages >= 40) throw new Error('storageValueTooLarge');
          await storage.set(`${address}:${generation}:${pages++}`, json.slice(i, end));
          i = end;
        }
        await storage.set(address, { generation, pages });
      } catch (error) {
        await discard(address, { generation, pages });
        throw error;
      }
    }
    await discard(address, previous);
  }
  return {
    get: (name) => read(name),
    set(name, value) {
      const op = (serialize.get(name) ?? Promise.resolve()).catch(() => {}).then(() => write(name, value));
      serialize.set(name, op);
      op.finally(() => { if (serialize.get(name) === op) serialize.delete(name); }).catch(() => {});
      return op;
    },
  };
}
