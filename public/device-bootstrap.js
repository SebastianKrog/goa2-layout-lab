// Lab-only adapter, loaded before the frontend on a real device.
if (!crypto.randomUUID)
  crypto.randomUUID = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join(
      "",
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
// Persist supported lab preferences in this tab's sessionStorage. The phone's
// personal localStorage values are never overwritten, including after navigation.
try {
  const {
    presentation: saved,
    storageScope,
    userStateKeys = [],
    sessionStoragePrefixes = [],
  } = window.__GOA2_DEVICE__;
  const original = window.localStorage;
  const scope = `__goa2_lab_${storageScope}:`;
  const supports = (key) =>
    userStateKeys.includes(key) ||
    sessionStoragePrefixes.some((prefix) => key.startsWith(prefix));
  const read = (key) => {
    const scoped = sessionStorage.getItem(scope + key);
    return scoped === null ? original.getItem(key) : JSON.parse(scoped);
  };
  const write = (key, value) =>
    supports(key)
      ? sessionStorage.setItem(scope + key, JSON.stringify(value))
      : value === null
        ? original.removeItem(key)
        : original.setItem(key, value);
  const keys = () =>
    [
      ...new Set([
        ...Object.keys(original),
        ...Object.keys(sessionStorage)
          .filter((k) => k.startsWith(scope))
          .map((k) => k.slice(scope.length)),
      ]),
    ].filter((key) => read(key) !== null);
  const methods = {
    getItem: (key) => read(String(key)),
    setItem: (key, value) => write(String(key), String(value)),
    removeItem: (key) => write(String(key), null),
    key: (index) => keys()[index] ?? null,
    clear: () => keys().forEach((key) => write(key, null)),
  };
  const scoped = new Proxy(Object.create(null), {
    get: (_, key) =>
      key === "length"
        ? keys().length
        : methods[key] || (typeof key === "string" ? read(key) : undefined),
    set: (_, key, value) => {
      write(String(key), String(value));
      return true;
    },
    deleteProperty: (_, key) => {
      write(String(key), null);
      return true;
    },
    ownKeys: keys,
    getOwnPropertyDescriptor: (_, key) =>
      read(key) !== null
        ? { enumerable: true, configurable: true, value: read(key) }
        : undefined,
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: scoped,
  });
  for (let [key, value] of Object.entries(saved.storage || {})) {
    if (!supports(key)) continue;
    if (saved.gamePath) key = key.replaceAll(saved.gamePath, location.pathname);
    write(key, value);
  }
} catch (error) {
  window.__GOA2_DEVICE_STORAGE_WARNING__ = error.message;
}
const OriginalSocket = window.WebSocket;
window.WebSocket = class extends OriginalSocket {
  constructor(...args) {
    super(...args);
    this.addEventListener("message", (event) => {
      try {
        const value = JSON.parse(event.data);
        if (value.type === "STATE_UPDATE") window.__GOA2_LAB_STATE__ = value;
        if (value.type === "update")
          window.__GOA2_LAB_HMR_UPDATES__ =
            (window.__GOA2_LAB_HMR_UPDATES__ || 0) + 1;
      } catch {
        /* Non-game socket message. */
      }
    });
  }
};
// Match the lab's frozen clock without freezing animation or performance.now().
const NativeDate = Date;
window.Date = class extends NativeDate {
  constructor(...args) {
    super(...(args.length ? args : [1792238400000]));
  }
  static now() {
    return 1792238400000;
  }
};
const cheatStyle = document.createElement("style");
cheatStyle.textContent = "[data-lab-cheats]{display:none!important}";
document.head.append(cheatStyle);
