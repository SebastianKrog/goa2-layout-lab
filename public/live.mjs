// A scaled live browser viewport. Scaling never changes the emulated device.
export class LiveView {
  constructor(index, win, viewport) {
    this.index = index;
    this.key = win.gameId;
    this.viewport = viewport;
    this.frames = 0;
    this.host = document.createElement("div");
    this.host.className = "live-stage";
    this.canvas = document.createElement("canvas");
    this.canvas.width = viewport.width;
    this.canvas.height = viewport.height;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "application");
    this.canvas.setAttribute(
      "aria-label",
      `${win.config.label || win.config.source} game view`,
    );
    this.canvas.dataset.view = index;
    this.label = document.createElement("span");
    this.label.className = "stream-status";
    this.label.textContent = "Connecting view...";
    this.host.append(this.canvas, this.label);
    this.fit = true;
    this.closed = false;
    this.touch = false;
    this.points = new Map();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.host);
    this.bind();
    this.connect();
  }
  resize() {
    const { width, height } = this.viewport;
    const scale = this.fit
      ? Math.min(this.host.clientWidth / width, this.host.clientHeight / height)
      : 1;
    this.canvas.style.width = `${Math.max(1, width * scale)}px`;
    this.canvas.style.height = `${Math.max(1, height * scale)}px`;
    this.host.classList.toggle("actual-size", !this.fit);
  }
  zoom(fit) {
    this.fit = fit;
    this.resize();
  }
  connect() {
    if (this.closed || document.hidden) return;
    const ws = (this.ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/stream?index=${this.index}&game=${encodeURIComponent(this.key)}`,
    ));
    ws.binaryType = "blob";
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        const v = JSON.parse(e.data);
        if (v.viewport) {
          this.viewport = v.viewport;
          this.touch = v.touch;
          this.canvas.width = v.viewport.width;
          this.canvas.height = v.viewport.height;
          this.resize();
        }
        if (v.error) {
          this.label.hidden = false;
          this.label.textContent = v.error;
        }
        return;
      }
      this.next = e.data;
      void this.draw();
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.label.hidden = false;
      this.label.textContent = "Reconnecting view...";
      this.timer = setTimeout(() => this.connect(), 1200);
    };
    ws.onerror = () => {};
  }
  async draw() {
    if (this.drawing) return;
    this.drawing = true;
    try {
      while (this.next && !this.closed) {
        const frame = this.next;
        this.next = null;
        const bitmap = await createImageBitmap(frame);
        if (!this.closed) {
          this.canvas
            .getContext("2d", { alpha: false })
            .drawImage(bitmap, 0, 0, this.canvas.width, this.canvas.height);
          this.frames++;
          this.canvas.dataset.frames = this.frames;
          this.label.hidden = true;
        }
        bitmap.close();
      }
    } catch {
      this.label.textContent = "Waiting for view...";
      this.label.hidden = false;
    } finally {
      this.drawing = false;
    }
  }
  send(value) {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(value));
  }
  bind() {
    const c = this.canvas;
    const modifiers = (e) =>
      (e.altKey ? 1 : 0) |
      (e.ctrlKey ? 2 : 0) |
      (e.metaKey ? 4 : 0) |
      (e.shiftKey ? 8 : 0);
    const point = (e) => {
      const r = c.getBoundingClientRect();
      return {
        x: Math.max(
          0,
          Math.min(
            this.viewport.width,
            ((e.clientX - r.left) * this.viewport.width) / r.width,
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            this.viewport.height,
            ((e.clientY - r.top) * this.viewport.height) / r.height,
          ),
        ),
        id: e.pointerId,
      };
    };
    const buttons = ["left", "middle", "right"];
    let clicks = 1,
      lastClick = null;
    const pointer = (e, event) => {
      if (this.disabled || this.ws?.readyState !== WebSocket.OPEN) return;
      e.preventDefault();
      if (event === "down") {
        const now = Date.now();
        clicks =
          lastClick &&
          now - lastClick.time < 450 &&
          lastClick.button === e.button &&
          Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 6
            ? (clicks % 3) + 1
            : 1;
        lastClick = { time: now, button: e.button, x: e.clientX, y: e.clientY };
        c.focus({ preventScroll: true });
        c.setPointerCapture(e.pointerId);
      }
      const p = point(e);
      if (this.touch && !document.body.classList.contains("report-selecting")) {
        if (
          event === "down" ||
          (event === "move" && this.points.has(e.pointerId))
        )
          this.points.set(e.pointerId, p);
        else if (event === "up" || event === "cancel")
          this.points.delete(e.pointerId);
        else return;
        const points = [...this.points.values()];
        this.send({
          type: "touch",
          event:
            event === "cancel"
              ? "touchCancel"
              : event === "down"
                ? "touchStart"
                : points.length
                  ? "touchMove"
                  : "touchEnd",
          points: event === "cancel" ? [] : points,
          modifiers: modifiers(e),
        });
      } else
        this.send({
          type: "mouse",
          event: {
            down: "mousePressed",
            up: "mouseReleased",
            move: "mouseMoved",
            cancel: "mouseReleased",
          }[event],
          ...p,
          button: event === "move" ? "none" : buttons[e.button] || "left",
          buttons: event === "cancel" ? 0 : e.buttons,
          clicks: event === "move" ? 0 : clicks,
          modifiers: modifiers(e),
        });
    };
    c.onpointerdown = (e) => pointer(e, "down");
    c.onpointermove = (e) => pointer(e, "move");
    c.onpointerup = (e) => pointer(e, "up");
    c.onpointercancel = (e) => pointer(e, "cancel");
    c.onlostpointercapture = () => {
      this.points.clear();
      this.send({ type: "release" });
    };
    c.oncontextmenu = (e) => e.preventDefault();
    c.addEventListener(
      "wheel",
      (e) => {
        if (this.disabled) return;
        e.preventDefault();
        const factor =
          e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.viewport.height : 1;
        this.send({
          type: "mouse",
          event: "mouseWheel",
          ...point(e),
          button: "none",
          buttons: 0,
          dx: Math.max(-10000, Math.min(10000, e.deltaX * factor)),
          dy: Math.max(-10000, Math.min(10000, e.deltaY * factor)),
          modifiers: modifiers(e),
        });
      },
      { passive: false },
    );
    for (const [name, event] of [
      ["keydown", "keyDown"],
      ["keyup", "keyUp"],
    ])
      c.addEventListener(name, (e) => {
        if (this.disabled) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return;
        e.preventDefault();
        this.send({
          type: "key",
          event,
          key: e.key,
          code: e.code,
          keyCode: e.keyCode,
          repeat: e.repeat,
          modifiers: modifiers(e),
          text:
            event === "keyDown" &&
            e.key.length === 1 &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey
              ? e.key
              : undefined,
        });
      });
    c.onpaste = (e) => {
      if (this.disabled) return;
      e.preventDefault();
      this.send({
        type: "text",
        text: e.clipboardData.getData("text/plain").slice(0, 8000),
      });
    };
    c.onblur = () => {
      this.points.clear();
      this.send({ type: "release" });
    };
  }
  pause(disabled) {
    this.disabled = disabled;
    this.host.classList.toggle("input-paused", disabled);
    if (disabled) this.send({ type: "release" });
  }
  destroy() {
    this.closed = true;
    clearTimeout(this.timer);
    this.observer.disconnect();
    this.ws?.close();
    this.next = null;
  }
}
