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
try {
  const saved = window.__GOA2_DEVICE__.presentation;
  for (let [key, value] of Object.entries(saved.storage || {})) {
    if (
      !/^goa2[.:-]/i.test(key) ||
      /token|auth|credential|spectator/i.test(key)
    )
      continue;
    if (saved.gamePath) key = key.replaceAll(saved.gamePath, location.pathname);
    localStorage.setItem(key, value);
  }
} catch {
  /* Device storage can be disabled. The game still opens. */
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
