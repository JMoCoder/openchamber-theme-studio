/* Fixture only; the real extension bundles the official SDK. */
(() => {
  const wire = { channel: 'openchamber.sdk', v: 1 };
  const pending = new Map();
  let counter = 0;
  const probe = globalThis.ocFixture = {
    ready: null,
    call(type, payload) {
      const id = `scoped-fs-${++counter}`;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, code: 'FIXTURE_TIMEOUT' });
        }, 2500);
        pending.set(id, { resolve, timer });
        parent.postMessage({ ...wire, type, id, payload }, '*');
      });
    },
  };
  addEventListener('message', ({ source, data }) => {
    if (source !== parent || data?.channel !== wire.channel || data.v !== wire.v) return;
    if (data.type === 'ready') {
      probe.ready = data.payload;
      document.getElementById('ready').textContent = 'ready';
    }
    const waiting = pending.get(data.id);
    if (waiting) {
      clearTimeout(waiting.timer);
      waiting.resolve({ ok: data.ok, payload: data.payload, code: data.code, error: data.error });
      pending.delete(data.id);
    }
  });
  parent.postMessage({ ...wire, type: 'hello' }, '*');
})();
