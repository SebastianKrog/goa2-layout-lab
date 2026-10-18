// Interactive views retain their own emulated Chromium context and storage.
import { WebSocketServer, WebSocket } from "ws";
import { PROFILES } from "./config.mjs";

const bounded = (n, min, max) => {
  if (!Number.isFinite(n) || n < min || n > max)
    throw Error("Invalid input coordinate");
  return n;
};
export class ViewStreams {
  constructor(server, comparison, busy) {
    this.comparison = comparison;
    this.busy = busy;
    this.sessions = new Map();
    this.paused = false;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url, "http://localhost");
      const origin = req.headers.origin;
      const host = req.headers.host;
      if (
        url.pathname !== "/api/stream" ||
        !origin ||
        ![`http://${host}`].includes(origin)
      ) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      try {
        const index = Number(url.searchParams.get("index"));
        if (!Number.isInteger(index) || index < 0 || index > 2)
          throw Error("Invalid view");
        const win = comparison.window(index);
        if (
          win.page.isClosed() ||
          win.clone.game_id !== url.searchParams.get("game")
        )
          throw Error("View replaced");
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          ws.on("error", () => {});
          void this.attach(ws, win).catch((e) => {
            if (ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ error: e.message }));
            ws.close(1011);
          });
        });
      } catch {
        socket.end("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n");
      }
    });
  }
  async attach(ws, win) {
    let promise = this.sessions.get(win);
    if (!promise) {
      promise = this.create(win);
      this.sessions.set(win, promise);
      promise.catch(() => this.sessions.delete(win));
    }
    const s = await promise;
    if (ws.readyState !== WebSocket.OPEN) return;
    s.clients.add(ws);
    ws.send(
      JSON.stringify({
        viewport: PROFILES[win.config.profile].viewport,
        touch: PROFILES[win.config.profile].isMobile,
      }),
    );
    if (s.frame) ws.send(s.frame);
    const input = this.input(s);
    s.inputs.set(ws, input);
    const messages = [];
    let processing = null;
    const drain = async () => {
      while (messages.length) {
        const message = messages.shift();
        if (win.page.isClosed()) break;
        if ((this.busy() || this.paused) && message.type !== "release")
          continue;
        try {
          await input(message);
          if (message.id !== undefined && ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ ack: message.id }));
        } catch (e) {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ error: e.message }));
        }
      }
    };
    ws.on("message", (bytes, binary) => {
      if (binary) return;
      let message;
      try {
        message = JSON.parse(bytes.toString());
        if (!message || typeof message !== "object") throw Error();
      } catch {
        ws.close(1008, "Invalid input");
        return;
      }
      const previous = messages.at(-1);
      const move = ["mouseMoved", "touchMove"].includes(message.event);
      if (
        move &&
        previous?.type === message.type &&
        previous.event === message.event &&
        previous.id === undefined &&
        message.id === undefined
      )
        messages[messages.length - 1] = message;
      else if (messages.length < 64) messages.push(message);
      else {
        ws.close(1008, "Input queue full");
        return;
      }
      if (!processing)
        processing = drain().finally(() => {
          processing = null;
        });
    });
    ws.on("close", () => {
      messages.length = 0;
      s.clients.delete(ws);
      s.inputs.delete(ws);
      void (processing || Promise.resolve())
        .then(() => input({ type: "release" }))
        .catch(() => {});
      if (!s.clients.size) void this.stop(s);
    });
    if (!this.paused && !this.busy()) await this.start(s);
  }
  async create(win) {
    const cdp = await win.context.newCDPSession(win.page);
    const s = {
      cdp,
      win,
      clients: new Set(),
      running: false,
      frame: null,
      last: 0,
      frameTimer: null,
      inputs: new Map(),
    };
    cdp.on("Page.screencastFrame", (event) => {
      s.frame = Buffer.from(event.data, "base64");
      const publish = () => {
        s.frameTimer = null;
        if (!this.paused && s.running) {
          s.last = Date.now();
          for (const client of s.clients)
            if (
              client.readyState === WebSocket.OPEN &&
              client.bufferedAmount < 512 * 1024
            )
              client.send(s.frame);
        }
        void cdp
          .send("Page.screencastFrameAck", { sessionId: event.sessionId })
          .catch(() => {});
      };
      s.frameTimer = setTimeout(
        publish,
        Math.max(0, 66 - (Date.now() - s.last)),
      );
    });
    win.page.once("close", () => {
      clearInterval(s.frameTimer);
      for (const client of s.clients) client.close(1012, "View replaced");
      this.sessions.delete(win);
    });
    return s;
  }
  async start(s) {
    if (s.running || !s.clients.size || s.win.page.isClosed()) return;
    s.running = true;
    try {
      const viewport = PROFILES[s.win.config.profile].viewport;
      await s.cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 82,
        maxWidth: viewport.width,
        maxHeight: viewport.height,
        everyNthFrame: 1,
        maxFramesInFlight: 1,
        sendLastFrame: true,
      });
    } catch (e) {
      s.running = false;
      throw e;
    }
  }
  async stop(s) {
    if (!s.running) return;
    s.running = false;
    clearTimeout(s.frameTimer);
    s.frameTimer = null;
    await s.cdp.send("Page.stopScreencast").catch(() => {});
  }
  async pause() {
    this.paused = true;
    await Promise.all(
      [...this.sessions.values()].map(async (p) => {
        try {
          const s = await p;
          await Promise.all(
            [...s.inputs.values()].map((input) =>
              input({ type: "release" }).catch(() => {}),
            ),
          );
          await this.stop(s);
        } catch {}
      }),
    );
  }
  async resume() {
    this.paused = false;
    await Promise.all(
      [...this.sessions.values()].map(async (p) => {
        try {
          await this.start(await p);
        } catch {}
      }),
    );
  }
  async close() {
    await this.pause();
    for (const client of this.wss.clients) client.close(1001);
    this.wss.close();
  }
  input(s) {
    const { cdp, win } = s,
      viewport = PROFILES[win.config.profile].viewport;
    let buttons = 0;
    const keys = new Map();
    const point = (m) => ({
      x: bounded(m.x, 0, viewport.width),
      y: bounded(m.y, 0, viewport.height),
    });
    return async (m) => {
      const modifiers = Number.isInteger(m.modifiers) ? m.modifiers & 15 : 0;
      if (m.type === "mouse") {
        if (
          ![
            "mousePressed",
            "mouseReleased",
            "mouseMoved",
            "mouseWheel",
          ].includes(m.event)
        )
          throw Error("Invalid mouse event");
        if (!["left", "right", "middle", "none"].includes(m.button))
          throw Error("Invalid mouse button");
        buttons = Number.isInteger(m.buttons) ? m.buttons & 7 : 0;
        await cdp.send("Input.dispatchMouseEvent", {
          type: m.event,
          ...point(m),
          button: m.button,
          buttons,
          modifiers,
          clickCount: Math.min(3, Math.max(0, Number(m.clicks) || 0)),
          ...(m.event === "mouseWheel"
            ? {
                deltaX: bounded(m.dx, -10000, 10000),
                deltaY: bounded(m.dy, -10000, 10000),
              }
            : {}),
        });
      } else if (m.type === "touch") {
        if (
          !["touchStart", "touchMove", "touchEnd", "touchCancel"].includes(
            m.event,
          ) ||
          !Array.isArray(m.points) ||
          m.points.length > 10
        )
          throw Error("Invalid touch event");
        const points = m.points.map((p) => ({
          ...point(p),
          id: bounded(p.id, 0, 2 ** 31 - 1),
          radiusX: 1,
          radiusY: 1,
          force: 1,
        }));
        await cdp.send("Input.dispatchTouchEvent", {
          type: m.event,
          touchPoints: points,
          modifiers,
        });
      } else if (m.type === "key") {
        if (
          !["keyDown", "keyUp"].includes(m.event) ||
          typeof m.key !== "string" ||
          m.key.length > 40 ||
          typeof m.code !== "string" ||
          m.code.length > 40
        )
          throw Error("Invalid key event");
        const code = Number.isInteger(m.keyCode) ? m.keyCode & 255 : 0;
        if (m.event === "keyDown")
          keys.set(m.code, {
            key: m.key,
            code: m.code,
            windowsVirtualKeyCode: code,
          });
        else keys.delete(m.code);
        await cdp.send("Input.dispatchKeyEvent", {
          type: m.event,
          key: m.key,
          code: m.code,
          windowsVirtualKeyCode: code,
          modifiers,
          autoRepeat: !!m.repeat,
          ...(m.event === "keyDown" &&
          typeof m.text === "string" &&
          m.text.length <= 4
            ? { text: m.text, unmodifiedText: m.text }
            : {}),
        });
      } else if (m.type === "text") {
        if (typeof m.text !== "string" || m.text.length > 8000)
          throw Error("Invalid text");
        await cdp.send("Input.insertText", { text: m.text });
      } else if (m.type === "release") {
        await cdp
          .send("Input.dispatchTouchEvent", {
            type: "touchCancel",
            touchPoints: [],
          })
          .catch(() => {});
        for (const button of ["left", "right", "middle"])
          if (buttons & { left: 1, right: 2, middle: 4 }[button])
            await cdp
              .send("Input.dispatchMouseEvent", {
                type: "mouseReleased",
                x: 0,
                y: 0,
                button,
                buttons: 0,
              })
              .catch(() => {});
        buttons = 0;
        for (const key of keys.values())
          await cdp
            .send("Input.dispatchKeyEvent", { type: "keyUp", ...key })
            .catch(() => {});
        keys.clear();
      } else throw Error("Unknown input event");
    };
  }
}
