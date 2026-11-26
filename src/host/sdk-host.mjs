import { connectHost } from '@openchamber/sdk';

// Keep the app's API boundary explicit: no HTTP, service or private host state.
// SDK 2.8 has one request deadline per connection. Allow the observed ~5.3 s
// filesystem replies without opening a second client on the same message channel.
export function createSdkHost({ client = connectHost({ requestTimeoutMs: 6500 }) } = {}) {
  const instance = { scope: 'instance' };
  return {
    onReady: (listener) => client.onReady(listener),
    readFile: (path) => client.readFile(path),
    writeFile: (path, content) => client.writeFile(path, content),
    stat: (path) => client.stat(path),
    listDir: (path) => client.listDir(path),
    storage: {
      get: (key) => client.storage.get(key, instance),
      set: (key, value) => client.storage.set(key, value, instance),
      delete: (key) => client.storage.delete(key, instance),
      keys: () => client.storage.keys(instance),
    },
    writeClipboard: (text) => client.writeClipboard(text),
    toast: (request) => client.toast(request),
    openUrl: (url) => client.openUrl(url),
    dispose: () => client.dispose(),
  };
}
