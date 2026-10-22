import { presentationEvidence } from "./presentation-model.mjs";
import {
  resolveView,
  adapterPresentation,
  USER_STATE_KEYS,
  SESSION_STORAGE_PREFIXES,
  toPresentation,
} from "./presentation-model.mjs";
import { deviceImageBundle } from "./device-screenshot.mjs";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { readPresentation } from "./presentation.mjs";
import { validateSlots, slotsForSituation, gameURL, TOOL } from "./config.mjs";
import { instrumentScript } from "./instrument.mjs";
import QRCode from "qrcode";

export function deviceHosts() {
  if (process.env.GOA2_LAB_DEVICE_HOST)
    return [process.env.GOA2_LAB_DEVICE_HOST];
  const hosts = Object.entries(os.networkInterfaces()).flatMap(
    ([name, addresses]) =>
      /wsl|vethernet|virtual|docker|tailscale/i.test(name)
        ? []
        : addresses
            .filter(
              (a) =>
                a.family === "IPv4" &&
                !a.internal &&
                /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address),
            )
            .map((a) => a.address),
  );
  return [...new Set(hosts)].sort(
    (a, b) =>
      Number(b.startsWith("192.168.")) - Number(a.startsWith("192.168.")),
  );
}

export class DeviceServer {
  constructor(
    services,
    api,
    {
      port = Number(process.env.GOA2_LAB_DEVICE_PORT || 3300),
      hosts = deviceHosts,
    } = {},
  ) {
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw Error("Invalid device port.");
    this.services = services;
    this.api = api;
    this.port = port;
    this.hosts = hosts;
    this.sessions = new Map();
    this.pending = new Set();
    this.sockets = new Set();
  }
  async listen() {
    if (this.server) return;
    const server = http.createServer((req, res) => void this.handle(req, res));
    server.on("upgrade", (req, socket, head) =>
      this.upgrade(req, socket, head),
    );
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, "0.0.0.0", resolve);
    });
    this.server = server;
    this.port = server.address().port;
  }
  async options(situationId, savedSituation = null) {
    const situation =
      savedSituation ||
      (await this.api(
        `/situations/${encodeURIComponent(situationId)}`,
        undefined,
        "GET",
      ));
    const health = await this.api("/health", undefined, "GET");
    return {
      botKinds: health.bot_kinds || [],
      seats: [
        ...Object.values(situation.checkpoint.state.teams).flatMap((t) =>
          t.heroes.map((h) => ({
            id: h.id,
            name: situation.checkpoint.hero_names?.[h.id] || h.name || h.id,
            team: t.color || h.team || "",
          })),
        ),
        { id: "spectator", name: "Spectator" },
      ],
    };
  }
  async open(body) {
    if (this.sessions.size >= 8)
      throw Error("Stop a device view before opening another (maximum eight).");
    const situation = await this.api(
      body.reviewSnapshot
        ? `/review/snapshot?${new URLSearchParams(body.reviewSnapshot)}`
        : `/situations/${encodeURIComponent(body.situationId)}`,
      undefined,
      "GET",
    );
    const [slot] = validateSlots([body.slot, body.slot]);
    const resolvedView = resolveView(slot, situation, body.presentation);
    const [config] = slotsForSituation([resolvedView.config], situation);
    const bots = body.bots ?? {};
    const heroes = Object.values(situation.checkpoint.state.teams).flatMap(
      (t) => t.heroes.map((h) => h.id),
    );
    if (
      !bots ||
      typeof bots !== "object" ||
      Array.isArray(bots) ||
      Object.entries(bots).some(
        ([id, kind]) =>
          !heroes.includes(id) ||
          id === config.seat ||
          !["random", "heuristic", "ismcts"].includes(kind),
      ) ||
      (Object.keys(bots).length && !heroes.includes(config.seat))
    )
      throw Error("Choose Random, Simple or ISMCTS for other heroes only.");
    const presentation = resolvedView.presentation;
    const port = await this.services.frontend(config.source);
    const targetScript =
      config.source === "target"
        ? instrumentScript((await this.services.script()).content)
        : null;
    await this.listen();
    const clone = await this.api("/clone", {
      situation_id: situation.id,
      ...(body.reviewSnapshot ? { review_snapshot: body.reviewSnapshot } : {}),
      human_seat: config.seat,
      bots,
    });
    const secret = randomBytes(32).toString("hex");
    const session = {
      secret,
      id: randomBytes(8).toString("hex"),
      reviewId: body.reviewId || null,
      revision: 0,
      reportPending: false,
      situationId: situation.id,
      name: situation.name,
      config,
      presentation,
      intendedPresentation: resolvedView.intended,
      bots,
      roster: Object.values(situation.checkpoint.state.teams).flatMap((t) =>
        t.heroes.map((h) => ({
          id: h.id,
          name: situation.checkpoint.hero_names?.[h.id] || h.name || h.id,
        })),
      ),
      clone,
      port,
      targetScript,
      oldPaths: new Set(),
      captures: new Set(),
      sockets: new Set(),
    };
    this.sessions.set(secret, session);
    session.qr = await QRCode.toDataURL(this.describe(session).urls[0], {
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M",
    });
    return this.describe(session);
  }
  async prepareReview(situation, plan, reviewId) {
    const prepared = [];
    try {
      for (const session of this.sessions.values()) {
        const next = plan(session.config);
        const bots = Object.fromEntries(
          Object.entries(next.config.bots || session.bots || {}).filter(
            ([id]) =>
              id !== next.config.seat &&
              Object.values(situation.checkpoint.state.teams).some((t) =>
                t.heroes.some((h) => h.id === id),
              ),
          ),
        );
        const clone = await this.api("/clone", {
          situation_id: situation.id,
          ...(situation.review_snapshot
            ? { review_snapshot: situation.review_snapshot }
            : { situation }),
          human_seat: next.config.seat,
          bots,
        });
        prepared.push({
          session,
          clone,
          config: next.config,
          presentation: next.presentation,
          bots,
          situation,
          reviewId,
          oldClone: session.clone,
          oldBots: session.bots,
        });
      }
      return prepared;
    } catch (error) {
      await this.retireReview(
        prepared.map((p) => ({ ...p, oldClone: p.clone, oldBots: p.bots })),
      );
      throw error;
    }
  }
  commitReview(plans) {
    for (const p of plans) {
      const s = p.session;
      s.oldPaths.add(`/game/${s.clone.game_id}`);
      Object.assign(s, {
        clone: p.clone,
        config: p.config,
        presentation: adapterPresentation(p.presentation, p.config.render),
        intendedPresentation: p.presentation,
        bots: p.bots,
        situationId: p.situation.id,
        name: p.situation.name,
        reviewId: p.reviewId,
        revision: s.revision + 1,
        reportPending: false,
      });
      s.roster = Object.values(p.situation.checkpoint.state.teams).flatMap(
        (t) =>
          t.heroes.map((h) => ({
            id: h.id,
            name: p.situation.checkpoint.hero_names?.[h.id] || h.name || h.id,
          })),
      );
      for (const socket of s.sockets) socket.destroy();
    }
  }
  async retireReview(plans) {
    await Promise.allSettled(
      plans.map(async (p) => {
        if (Object.keys(p.oldBots || {}).length)
          await this.api("/device/stop", { game_id: p.oldClone.game_id });
        await this.api(`/games/${p.oldClone.game_id}`, undefined, "DELETE");
      }),
    );
  }
  reviewStatus(session) {
    const review = this.review?.status();
    const game = new URL(gameURL(this.port, session.clone, session.config));
    return {
      reviewRun:
        review?.active && session.reviewId === review.id ? review : null,
      revision: session.revision,
      url: game.pathname + game.search,
    };
  }
  describe(session) {
    const urls = (this.hosts().length ? this.hosts() : ["localhost"]).map(
      (host) => `http://${host}:${this.port}/device/${session.secret}`,
    );
    return {
      id: session.id,
      name: session.name,
      config: session.config,
      bots: session.bots,
      roster: session.roster,
      urls,
      qr: session.qr,
      reviewId: session.reviewId,
      localURL: `http://localhost:${this.port}/device/${session.secret}`,
    };
  }
  status() {
    return [...this.sessions.values()].map((s) => this.describe(s));
  }
  async stop(id) {
    const session = [...this.sessions.values()].find((s) => s.id === id);
    if (!session) throw Error("Device view not found.");
    this.sessions.delete(session.secret);
    for (const socket of session.sockets) socket.destroy();
    if (Object.keys(session.bots).length)
      await this.api("/device/stop", { game_id: session.clone.game_id });
    return { ok: true };
  }
  session(req) {
    const match = /(?:^|;\s*)goa2_device=([a-f0-9]{64})(?:;|$)/.exec(
      req.headers.cookie || "",
    );
    return match ? this.sessions.get(match[1]) : null;
  }
  allowed(session, pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    if (decoded.includes("\\") || decoded.split("/").includes(".."))
      return false;
    if (
      /(^|\/)(\.git|\.env[^/]*|\.dev\.vars[^/]*)(\/|$)/.test(decoded) ||
      /(^|\/)\.layout-lab(?:\/(?!cache(?:\/|$))|$)/.test(decoded)
    )
      return false;
    if (decoded === "/api" || decoded.startsWith("/api/")) {
      const game = `/api/games/${session.clone.game_id}`;
      return (
        decoded === game ||
        decoded.startsWith(game + "/") ||
        /^\/api\/(heroes|maps)(\/|$)/.test(decoded)
      );
    }
    if (decoded.startsWith("/game/"))
      return decoded === `/game/${session.clone.game_id}`;
    return !decoded.startsWith("/__lab/");
  }
  async handle(req, res) {
    const send = (status, value, type = "application/json") => {
      res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
      });
      res.end(type === "application/json" ? JSON.stringify(value) : value);
    };
    try {
      const url = new URL(req.url, "http://device.local");
      const entry = /^\/device\/([a-f0-9]{64})$/.exec(url.pathname);
      if (req.method === "GET" && entry) {
        const session = this.sessions.get(entry[1]);
        if (!session)
          return send(410, {
            error:
              "This device link has stopped. Open a new view in the layout lab.",
          });
        res.writeHead(302, {
          Location:
            new URL(gameURL(this.port, session.clone, session.config))
              .pathname +
            new URL(gameURL(this.port, session.clone, session.config)).search,
          "Set-Cookie": `goa2_device=${session.secret}; HttpOnly; SameSite=Lax; Path=/`,
          "Referrer-Policy": "no-referrer",
          "Cache-Control": "no-store",
        });
        return res.end();
      }
      const session = this.session(req);
      if (!session)
        return send(403, {
          error: "Open the device link from the layout lab first.",
        });
      if (req.method === "GET" && session.oldPaths.has(url.pathname)) {
        res.writeHead(302, {
          Location: this.reviewStatus(session).url,
          "Cache-Control": "no-store",
        });
        return res.end();
      }
      if (url.pathname === "/__device/review" && req.method === "GET")
        return send(200, this.reviewStatus(session));
      if (!this.allowed(session, url.pathname))
        return send(403, { error: "This link only permits its own game." });
      if (url.pathname === "/__device/bootstrap.js") {
        // HTTP LAN origins lack randomUUID, while getRandomValues remains available.
        const config = JSON.stringify({
          config: session.config,
          presentation: session.presentation,
          revision: session.revision,
          intendedPresentation: session.intendedPresentation,
          storageScope: session.id,
          userStateKeys: [...USER_STATE_KEYS],
          sessionStoragePrefixes: SESSION_STORAGE_PREFIXES,
        }).replaceAll("<", "\\u003c");
        return send(
          200,
          `window.__GOA2_DEVICE__=${config};\n` +
            (await fs.readFile(
              path.join(TOOL, "public/device-bootstrap.js"),
              "utf8",
            )),
          "text/javascript",
        );
      }
      if (url.pathname === "/__device/presentation.js")
        return send(
          200,
          `export const capturePresentation=${readPresentation.toString()};`,
          "text/javascript",
        );
      if (url.pathname === "/__device/target.js")
        return send(200, session.targetScript || "", "text/javascript");
      if (req.method === "GET" && url.pathname === "/__device/html-to-image.js")
        return send(200, await deviceImageBundle(), "text/javascript");
      const files = {
        "/__device/report.js": "public/device-report.mjs",
        "/__device/presentation-plan.js": "presentation-plan.mjs",
        "/__device/html-to-image.js":
          "node_modules/html-to-image/dist/html-to-image.js",
      };
      if (files[url.pathname] && req.method === "GET")
        return send(
          200,
          await fs.readFile(path.join(TOOL, files[url.pathname]), "utf8"),
          "text/javascript",
        );
      if (url.pathname.startsWith("/__device/")) {
        if (
          req.method !== "POST" ||
          req.headers.origin !== `http://${req.headers.host}` ||
          !req.headers["content-type"]?.startsWith("application/json")
        )
          return send(403, { error: "Use the device page to report." });
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 14 * 1024 * 1024)
            return send(413, { error: "Screenshot exceeds 10 MiB." });
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (url.pathname === "/__device/review-step") {
          await this.navigateReview(body);
          return send(200, this.reviewStatus(session));
        }
        if (url.pathname === "/__device/report-discard") {
          session.reportPending = false;
          return send(200, { ok: true });
        }
        if (url.pathname === "/__device/capture") {
          if (this.review?.loading)
            throw Error(
              "The review is changing situations. Wait before reporting.",
            );
          session.reportPending = true;
          const review = this.review?.context();
          const comparisonSlot = {
            ...session.config,
            source:
              session.config.source === "live"
                ? "comparator"
                : session.config.source,
          };
          const captured = await this.api("/device/capture", {
            game_id: session.clone.game_id,
            presentation: body.presentation,
            viewport: body.viewport,
            provenance: {
              review: review?.id === session.reviewId ? review : null,
              source_situation: session.situationId,
              sourceEvidence: (await this.services.provenance?.()) || null,
              presentationResolution: presentationEvidence(
                session.config,
                session.intendedPresentation,
                body.presentation,
                body.restoreWarnings || [],
              ),
              bots: session.bots,
              slots: [session.config, comparisonSlot],
              frontend_revision:
                session.config.source === "live"
                  ? "live working tree"
                  : session.config.source === "comparator"
                    ? this.services.comparator
                    : this.services.references.base,
            },
          });
          session.captures.add(captured.id);
          return send(200, captured);
        }
        if (
          url.pathname === "/__device/report" &&
          session.captures.has(body.id)
        ) {
          const result = await this.api("/device/report", {
            id: body.id,
            game_id: session.clone.game_id,
            comment: body.comment,
            screenshot: body.screenshot,
          });
          const review = this.review?.context();
          if (review?.id === session.reviewId)
            await this.review.record(review, {
              id: result.id,
              url: result.report,
              kind: "device",
              label: body.comment?.slice(0, 160),
            });
          session.reportPending = false;
          return send(200, result);
        }
        return send(409, {
          error: "Capture expired. Close and capture again.",
        });
      }
      return await this.proxy(req, res, session);
    } catch (error) {
      if (!res.headersSent) send(422, { error: error.message });
      else res.destroy();
    }
  }
  async proxy(req, res, session) {
    if (req.method === "GET") {
      const asset = await this.services.assetFor?.(
        session.config.source,
        new URL(req.url, "http://device.local").pathname,
      );
      if (asset) {
        res.writeHead(200, {
          "content-type": asset.contentType,
          "content-length": asset.body.length,
          "cache-control": "no-cache",
        });
        res.end(asset.body);
        return;
      }
    }
    const headers = {
      ...req.headers,
      host: `127.0.0.1:${session.port}`,
      "accept-encoding": "identity",
    };
    delete headers.cookie;
    const proxy = http.request(
      {
        hostname: "127.0.0.1",
        port: session.port,
        path: req.url,
        method: req.method,
        headers,
      },
      (upstream) => {
        const outgoing = {
          ...upstream.headers,
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        };
        delete outgoing["set-cookie"];
        if (upstream.headers["content-type"]?.includes("text/html")) {
          delete outgoing["content-length"];
          delete outgoing.etag;
          const chunks = [];
          upstream.on("data", (chunk) => chunks.push(chunk));
          upstream.on("end", () => {
            const html = Buffer.concat(chunks)
              .toString()
              .replace(
                /<head[^>]*>/i,
                (match) =>
                  `${match}<script src="/__device/bootstrap.js"></script><script src="/__device/html-to-image.js"></script><script type="module" src="/__device/report.js"></script>`,
              );
            res.writeHead(upstream.statusCode, outgoing);
            res.end(html);
          });
        } else {
          res.writeHead(upstream.statusCode, outgoing);
          upstream.pipe(res);
        }
      },
    );
    proxy.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end("The lab frontend is unavailable.");
    });
    req.pipe(proxy);
  }
  upgrade(req, socket, head) {
    const session = this.session(req);
    if (
      !session ||
      !this.allowed(
        session,
        new URL(req.url, "http://device.local").pathname,
      ) ||
      req.headers.origin !== `http://${req.headers.host}`
    )
      return socket.destroy();
    const headers = { ...req.headers, host: `127.0.0.1:${session.port}` };
    delete headers.cookie;
    const request = http.request({
      hostname: "127.0.0.1",
      port: session.port,
      path: req.url,
      headers,
    });
    session.sockets.add(socket);
    socket.on("close", () => session.sockets.delete(socket));
    request.on("upgrade", (response, upstream, upstreamHead) => {
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\r\n")}\r\n\r\n`,
      );
      if (head.length) upstream.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      upstream.pipe(socket);
      socket.pipe(upstream);
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      socket.on("close", () => upstream.destroy());
    });
    request.on("response", () => socket.destroy());
    request.on("error", () => socket.destroy());
    request.end();
  }
  async close() {
    await Promise.allSettled(
      [...this.sessions.values()].map((s) => this.stop(s.id)),
    );
    for (const socket of this.sockets) socket.destroy();
    if (this.server) await new Promise((resolve) => this.server.close(resolve));
  }
}
