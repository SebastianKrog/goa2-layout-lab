// Native Chromium surfaces are laid out over these reserved DOM rectangles.
const views = new Map();
let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    place();
  });
}
function place() {
  if (!window.layoutLabDesktop) return;
  const modal = !!document.querySelector("dialog[open]");
  const items = [];
  for (const v of views.values()) {
    const host = v.host,
      r = host.getBoundingClientRect(),
      { width, height } = v.viewport;
    const scale = v.fit
      ? Math.min(host.clientWidth / width, host.clientHeight / height)
      : 1;
    const x = Math.max(0, r.left),
      y = Math.max(0, r.top),
      right = Math.min(innerWidth, r.left + host.clientWidth),
      bottom = Math.min(innerHeight, r.top + host.clientHeight);
    const offsetX =
      (v.fit
        ? Math.max(0, (host.clientWidth - width * scale) / 2)
        : -host.scrollLeft) +
      r.left -
      x;
    const offsetY =
      (v.fit
        ? Math.max(0, (host.clientHeight - height * scale) / 2)
        : -host.scrollTop) +
      r.top -
      y;
    items.push({
      id: v.id,
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y),
      offsetX,
      offsetY,
      scale,
      visible: !modal && !document.hidden && r.width > 0 && r.height > 0,
      expanded: !!host.closest(".expanded"),
    });
  }
  window.layoutLabDesktop.layout(items);
}
window.addEventListener("resize", schedule);
window.addEventListener("scroll", schedule, true);
new MutationObserver(schedule).observe(document.body, {
  subtree: true,
  attributes: true,
  attributeFilter: ["open"],
});
export class NativeView {
  constructor(index, win, viewport) {
    this.id = win.nativeId;
    this.viewport = viewport;
    this.fit = true;
    this.host = document.createElement("div");
    this.host.className = "live-stage native-stage";
    this.host.dataset.nativeId = this.id;
    this.sizer = document.createElement("div");
    this.sizer.className = "native-sizer";
    this.host.append(this.sizer);
    this.canvas = { focus: () => window.layoutLabDesktop.focus(this.id) };
    this.observer = new ResizeObserver(schedule);
    this.observer.observe(this.host);
    views.set(this.id, this);
    schedule();
  }
  resize() {
    schedule();
  }
  zoom(fit) {
    this.fit = fit;
    this.host.classList.toggle("actual-size", !fit);
    this.sizer.style.width = fit ? "0" : this.viewport.width + "px";
    this.sizer.style.height = fit ? "0" : this.viewport.height + "px";
    schedule();
  }
  pause() {
    schedule();
  }
  destroy() {
    this.observer.disconnect();
    if (views.get(this.id) === this) views.delete(this.id);
    schedule();
  }
}
