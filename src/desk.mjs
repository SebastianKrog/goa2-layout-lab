import { Layouts, layoutSlots } from "./layouts.mjs";
import { toPresentation } from "./presentation-model.mjs";
import { Reviews } from "./reviews.mjs";
import http from "node:http";
import { ElementReports } from "./element-reports.mjs";
import { DeviceServer } from "./device-server.mjs";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  DATA,
  TOOL,
  ROOT,
  PORTS,
  PRESETS,
  PROFILES,
  validateSlots,
  STARTUP,
  BACKEND,
  PATCH,
} from "./config.mjs";
import { Services, available, git, resolveComparator } from "./services.mjs";
import { Comparison } from "./browser.mjs";
import { captureReport } from "./report.mjs";
import { extractSources } from "./source-inspection.mjs";
import { ViewStreams } from "./streams.mjs";
import { openURL } from "./runtime.mjs";
import { loadStartupSituation } from "./startup.mjs";

export async function startDesk({
  flags = new Set(process.argv.slice(2)),
} = {}) {
  await available(PORTS.desk);
  const token = randomBytes(32).toString("hex");
  const services = new Services(token);
  await services.init();
  const api = async (route, body, method = "POST") => {
    const response = await fetch(
      `http://127.0.0.1:${PORTS.backend}/__lab${route}`,
      {
        method,
        headers: { "x-lab-token": token, "content-type": "application/json" },
        signal: AbortSignal.timeout(120_000),
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    const value = await response
      .json()
      .catch(() => ({ detail: "Backend returned an invalid response" }));
    if (!response.ok)
      throw new Error(
        typeof value.detail === "string"
          ? value.detail
          : JSON.stringify(value.detail),
      );
    return value;
  };
  const devices = new DeviceServer(services, api);
  if (!["embedded", "browser", "windows"].includes(STARTUP.display))
    throw new Error("Choose --display=embedded, browser or windows.");
  const comparison = new Comparison(services, api, {
    userData: flags.has("--verification")
      ? path.join(DATA, "runtime", `verification-desktop-${process.platform}`)
      : undefined,
    native: STARTUP.display === "embedded" && !flags.has("--headless"),
    headless: flags.has("--headless") || STARTUP.display === "browser",
  });
  let queue = Promise.resolve(),
    busy = false,
    lastError = null,
    closing = false;
  let reviews;
  const elementReports = new ElementReports(comparison, {
    schedule: (fn) => {
      const work = queue.then(async () => {
        busy = true;
        try {
          await comparison.sync.queue;
          await streams.pause();
          await fn();
        } finally {
          busy = false;
          await streams.resume();
        }
      });
      queue = work.catch((error) => {
        lastError = error.message;
      });
      return work;
    },
  });
  comparison.reporter = elementReports;
  reviews = new Reviews(comparison, devices, {
    guard: () => {
      if (elementReports.draft || elementReports.active)
        throw Error(
          "Finish or discard the element report before changing review situations.",
        );
      if ([...devices.sessions.values()].some((s) => s.reportPending))
        throw Error(
          "Finish or discard the report on the device before changing review situations.",
        );
    },
  });
  elementReports.reportContext = () => reviews.reportContext();
  elementReports.onReport = (context, report) =>
    reviews.record(context, report);
  devices.review = reviews;
  devices.navigateReview = (body) => {
    const work = queue.then(async () => {
      busy = true;
      lastError = null;
      try {
        await comparison.sync.queue;
        await streams.pause();
        return await reviews.step(body);
      } catch (error) {
        lastError = error.message;
        throw error;
      } finally {
        busy = false;
        await streams.resume();
      }
    });
    queue = work.catch(() => {});
    return work;
  };
  let following = false;
  const followTimer = setInterval(() => {
    if (
      elementReports.active ||
      elementReports.draft?.stage === "capturing" ||
      following ||
      busy ||
      closing ||
      !comparison.windows.some((w) => w.config.autoSwitch)
    )
      return;
    following = true;
    const work = queue.then(async () => {
      if (
        closing ||
        elementReports.active ||
        elementReports.draft?.stage === "capturing"
      )
        return;
      await comparison.sync.queue;
      if (elementReports.active || elementReports.draft?.stage === "capturing")
        return;
      await comparison.followDecisions(async (index, seat) => {
        busy = true;
        try {
          await streams.pause();
          await comparison.switchSeat(index, seat);
        } finally {
          busy = false;
          await streams.resume();
        }
      });
    });
    queue = work.catch((error) => {
      lastError = error.message;
    });
    void queue.finally(() => {
      following = false;
    });
  }, 750);
  followTimer.unref();
  comparison.sync.busy = () => busy || closing;
  let presets = { ...PRESETS };
  const presentationFile = path.join(DATA, "presentation-templates.json");
  const presentations = existsSync(presentationFile)
    ? JSON.parse(await fs.readFile(presentationFile, "utf8"))
    : [];
  const layouts = await new Layouts(
    DATA,
    path.join(TOOL, "library/layouts"),
  ).init(presets);
  presets = layouts.slotsByName();
  if (!presets[STARTUP.preset])
    throw new Error(`Unknown startup preset: ${STARTUP.preset}`);
  let closePromise;
  function close() {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      clearInterval(followTimer);
      console.log("Stopping layout-lab windows and owned services...");
      await devices.close().catch(console.error);
      await streams.close().catch(console.error);
      await comparison.close().catch(console.error);
      await services.close().catch(console.error);
      if (server.listening)
        await new Promise((resolve) => server.close(resolve));
    })();
    return closePromise;
  }
  process.on("SIGINT", () => void close());
  process.on("SIGTERM", () => void close());

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORTS.desk}`);
    const send = (value, status = 200) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const origin = req.headers.origin;
      if (
        origin &&
        ![
          `http://localhost:${PORTS.desk}`,
          `http://127.0.0.1:${PORTS.desk}`,
        ].includes(origin)
      )
        return send({ error: "Use the local comparison desk origin." }, 403);
      if (req.method === "GET" && url.pathname === "/api/element-report/status")
        return send(elementReports.status());
      if (req.method === "GET" && url.pathname === "/api/reviews") {
        const { reviews: definitions, warnings } = await reviews.list();
        return send({ reviews: definitions, warnings });
      }
      if (req.method === "GET" && url.pathname === "/api/review-runs") {
        const { runs, warnings } = await reviews.list();
        return send({ runs, warnings });
      }
      if (req.method === "GET" && url.pathname === "/api/review-runs/current")
        return send(reviews.status());
      if (req.method === "GET" && url.pathname.startsWith("/api/review-runs/"))
        return send(
          await reviews.detail(
            decodeURIComponent(url.pathname.slice("/api/review-runs/".length)),
          ),
        );
      if (req.method === "GET" && url.pathname === "/api/device/options")
        return send(
          await devices.options(
            url.searchParams.get("situationId"),
            reviews.current?.active
              ? reviews.current.entries[reviews.current.index].situation
              : null,
          ),
        );
      if (req.method === "GET" && url.pathname === "/api/device/views")
        return send(devices.status());
      if (req.method === "GET" && url.pathname === "/api/status")
        return send({
          ...comparison.status(),
          reviewRun: reviews.status(),
          busy,
          lastError,
          headless: !!comparison.options.headless,
          verification: flags.has("--verification"),
        });
      if (req.method === "GET" && url.pathname === "/api/views") {
        const { capturePresentation } = await import("./presentation.mjs");
        return send(
          await Promise.all(
            comparison.windows.map(async (w, index) => ({
              index,
              config: w.config,
              gameId: w.clone.game_id,
              presentation: await capturePresentation(w.page, w.config.render),
              state: await api(`/games/${w.clone.game_id}`, undefined, "GET"),
              scriptActive: await w.page.evaluate(() =>
                document.documentElement.hasAttribute("data-m2-active"),
              ),
              wallTime: await w.page.evaluate(() => Date.now()),
              hmrUpdates: await w.page.evaluate(
                () => window.__GOA2_LAB_HMR_UPDATES__ || 0,
              ),
              clock: await w.page.evaluate(
                () => window.__GOA2_LAB_STATE__?.view?.clock,
              ),
            })),
          ),
        );
      }
      if (req.method === "GET" && url.pathname === "/api/preview") {
        const index = Number(url.searchParams.get("index"));
        if (!Number.isInteger(index) || index < 0)
          throw new Error("Choose a comparison view.");
        const page = comparison.window(index).page;
        if (page.isClosed())
          return send(
            { error: "This window is closed. Reopen it from Edit view." },
            410,
          );
        const bytes = await page.screenshot({
          type: "jpeg",
          quality: 55,
          timeout: 8000,
        });
        res.writeHead(200, {
          "content-type": "image/jpeg",
          "cache-control": "no-store",
        });
        return res.end(bytes);
      }
      if (req.method === "GET" && url.pathname === "/api/catalog") {
        const situations = await api(
          "/situations?metadata=true",
          undefined,
          "GET",
        );
        const commits = git([
          "log",
          STARTUP.comparatorRef,
          "-n",
          "50",
          "--format=%H %s",
        ])
          .split("\n")
          .map((line) => ({ sha: line.slice(0, 40), subject: line.slice(41) }));
        return send({
          situations,
          decisionStates: await api("/decision-states", undefined, "GET"),
          presets,
          layouts: layouts.records,
          presentations,
          profiles: PROFILES,
          commits,
          root: ROOT,
          settings: {
            ...STARTUP,
            frontend: ROOT,
            backend: BACKEND,
            patch: PATCH,
          },
        });
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return send({ error: "JSON requests only." }, 415);
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32 * 1024 * 1024)
            throw new Error("Import exceeds 32 MiB.");
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        if (url.pathname === "/api/element-report/comment")
          return send(elementReports.setComment(body.id, body.comment));
        if (url.pathname === "/api/shutdown") {
          setTimeout(() => void close(), 100);
          return send({ ok: true });
        }
        const perform = async () => {
          busy = true;
          lastError = null;
          try {
            await comparison.sync.queue;
            await streams.pause();
            if (
              reviews.status()?.active &&
              [
                "/api/load",
                "/api/clear",
                "/api/views/add",
                "/api/views/remove",
                "/api/configure",
                "/api/live",
                "/api/reset",
                "/api/presentation/apply",
                "/api/refresh",
              ].includes(url.pathname)
            )
              throw Error(
                "End the review before changing view setup or loading another situation.",
              );
            switch (url.pathname) {
              case "/api/element-report/mode":
                return await elementReports.setEnabled(body.enabled === true);
              case "/api/element-report/send":
                return await elementReports.send(body.id, body.comment);
              case "/api/element-report/discard":
                return await elementReports.discard(body.id);
              case "/api/review-runs/rerun":
                return await reviews.rerun(body);
              case "/api/review-runs/start":
                return await reviews.start(body);
              case "/api/review-runs/step":
                return await reviews.step(body);
              case "/api/review-runs/end":
                return await reviews.end();
              case "/api/device-open":
                return await devices.open(reviews.deviceBody(body));
              case "/api/device-stop":
                return devices.stop(body.id);
              case "/api/load": {
                const situation = await api(
                  `/situations/${encodeURIComponent(body.situationId || "")}`,
                  undefined,
                  "GET",
                );
                if (!situation) throw new Error("Choose a saved situation.");
                const chosenLayout = body.layoutId
                  ? layouts.find(body.layoutId)
                  : null;
                const slots = chosenLayout
                  ? layoutSlots(chosenLayout)
                  : body.slots;
                await comparison.load(situation.id, slots, {}, situation);
                if (chosenLayout)
                  await comparison.sync.setMode(chosenLayout.synchronization);
                return comparison.status();
              }
              case "/api/views/add":
                return await comparison.addView(body);
              case "/api/views/remove":
                return await comparison.removeView(body.index);
              case "/api/synchronize":
                return await comparison.sync.setMode(body.mode);
              case "/api/cheats":
                return await comparison.sync.setCheats(body.show);
              case "/api/live": {
                const affected = comparison.windows
                  .map((w, i) =>
                    w.config.source === "comparator" ||
                    w.config.source === "live"
                      ? i
                      : -1,
                  )
                  .filter((i) => i >= 0);
                for (const i of affected)
                  await comparison.configure(i, {
                    source: body.enabled ? "live" : "comparator",
                  });
                return comparison.status();
              }
              case "/api/reset":
                return await comparison.reset(body.index);
              case "/api/configure": {
                const indexes =
                  body.index === undefined
                    ? comparison.windows.map((_, i) => i)
                    : [body.index];
                for (const i of indexes)
                  await comparison.configure(
                    i,
                    body.update,
                    body.restore !== false,
                  );
                return comparison.status();
              }
              case "/api/presentation/save": {
                const name = String(body.name || "").trim();
                if (!name || name.length > 80)
                  throw new Error(
                    "Enter a presentation name (up to 80 characters).",
                  );
                const win = comparison.window(body.index ?? 0);
                const { capturePresentation } = await import(
                  "./presentation.mjs"
                );
                const item = {
                  id: randomBytes(12).toString("hex"),
                  name,
                  render: win.config.render,
                  schema: 2,
                  state: toPresentation(
                    await capturePresentation(win.page, win.config.render),
                    win.config.seat,
                  ),
                };
                presentations.push(item);
                await fs.writeFile(
                  presentationFile,
                  JSON.stringify(presentations, null, 2),
                );
                return item;
              }
              case "/api/presentation/apply": {
                const win = comparison.window(body.index);
                const item = presentations.find((p) => p.id === body.id);
                if (!item) throw new Error("Presentation not found.");
                if (item.render !== win.config.render)
                  throw new Error(
                    "Choose a presentation with the same renderer.",
                  );
                return await comparison.applyPresentation(
                  body.index,
                  item.state,
                );
              }
              case "/api/save":
                return await comparison.save(
                  body.index ?? 0,
                  body.name,
                  body.kind,
                );
              case "/api/situation/compose":
                return await api("/situations/compose", body);
              case "/api/starter":
                return await api("/starter", body);
              case "/api/organize":
                return await api("/organize", body);
              case "/api/import":
                return await api("/import", body);
              case "/api/camera":
                return await comparison.cameraCopy(body.from, body.indexes);
              case "/api/pane":
                return await comparison.pane(body.index, body.pane);
              case "/api/hero":
                return await comparison.hero(body.index, body.heroId);
              case "/api/focus":
                await comparison.window(body.index).page.bringToFront();
                return { ok: true };
              case "/api/extract": {
                const collection = reviews.reportContext();
                const report = await extractSources(
                  comparison,
                  body,
                  collection?.root,
                  collection,
                );
                await reviews.record(collection, {
                  ...report,
                  kind: "html-css",
                });
                return report;
              }
              case "/api/capture": {
                const collection = reviews.reportContext();
                const report = await captureReport(comparison, body.indexes, {
                  crop: body.crop,
                  collection,
                });
                await reviews.record(collection, {
                  ...report,
                  kind: "capture",
                });
                return report;
              }
              case "/api/refresh": {
                const next = resolveComparator(
                  body.ref || STARTUP.comparatorRef,
                );
                const affected = comparison.windows
                  .map((w, i) => (w.config.source === "comparator" ? i : -1))
                  .filter((i) => i >= 0);
                // Close dependent contexts before restarting only this frontend;
                // their game clones and other sources remain intact.
                const views = new Map();
                const { capturePresentation } = await import(
                  "./presentation.mjs"
                );
                for (const i of affected) {
                  const w = comparison.window(i);
                  views.set(
                    i,
                    w.page.isClosed()
                      ? w.views[w.config.render]
                      : await capturePresentation(w.page, w.config.render),
                  );
                  w.views[w.config.render] = views.get(i);
                  await w.context.close().catch(() => {});
                }
                await services.stop("comparator");
                services.comparator = next;
                for (const i of affected) {
                  const w = comparison.window(i);
                  comparison.windows[i] = await comparison.open(
                    w.config,
                    views.get(i),
                    w.clone,
                    i,
                    w.situation,
                  );
                  comparison.windows[i].initialPresentation =
                    w.initialPresentation;
                }
                return comparison.status();
              }
              case "/api/references": {
                throw new Error(
                  "Frozen references are startup settings. Set GOA2_LAB_BASE_REF / GOA2_LAB_SCRIPT_REF and restart the launcher.",
                );
              }
              case "/api/clear":
                await comparison.clear();
                return comparison.status();
              case "/api/layout/save": {
                if (
                  !/^[\w -]{1,80}$/.test(body.name) ||
                  ["__proto__", "constructor", "prototype"].includes(body.name)
                )
                  throw new Error(
                    "Use a short Layout name with letters, numbers, spaces or dashes.",
                  );
                const saved = await layouts.save(
                  body.name,
                  body.slots,
                  body.synchronization ?? comparison.sync.mode,
                );
                presets = layouts.slotsByName();
                return { layout: saved, layouts: layouts.records, presets };
              }
              default:
                throw new Error("Unknown comparison action.");
            }
          } catch (error) {
            lastError = error.message;
            throw error;
          } finally {
            busy = false;
            await streams.resume();
          }
        };
        const action = queue.then(perform);
        queue = action.catch(() => {});
        return send(await action);
      }
      if (req.method === "GET") {
        let filename;
        if (url.pathname === "/")
          filename = path.join(TOOL, "public/index.html");
        else if (url.pathname === "/native.mjs")
          filename = path.join(TOOL, "public/native.mjs");
        else if (url.pathname === "/live.mjs")
          filename = path.join(TOOL, "public/live.mjs");
        else if (url.pathname === "/element-report-panel.mjs")
          filename = path.join(TOOL, "public/element-report-panel.mjs");
        else if (url.pathname === "/reviews-panel.mjs")
          filename = path.join(TOOL, "public/reviews-panel.mjs");
        else if (url.pathname === "/device-panel.mjs")
          filename = path.join(TOOL, "public/device-panel.mjs");
        else if (url.pathname === "/desk.mjs")
          filename = path.join(TOOL, "public/desk.mjs");
        else if (url.pathname === "/desk.css")
          filename = path.join(TOOL, "public/desk.css");
        else if (url.pathname.startsWith("/reports/")) {
          filename = path.resolve(DATA, `.${decodeURIComponent(url.pathname)}`);
          if (!filename.startsWith(path.join(DATA, "reports") + path.sep))
            throw new Error("Invalid report path.");
        } else if (url.pathname.startsWith("/export/")) {
          const id = url.pathname.slice("/export/".length);
          const situation = await api(
            `/situations/${encodeURIComponent(id)}`,
            undefined,
            "GET",
          );
          if (!situation) return send({ error: "Situation not found" }, 404);
          res.setHeader(
            "content-disposition",
            `attachment; filename="goa2-situation-${situation.id}.json"`,
          );
          return send(situation);
        } else return send({ error: "Not found" }, 404);
        const content = await fs.readFile(filename);
        res.writeHead(200, {
          "content-type": filename.endsWith(".txt")
            ? "text/plain; charset=utf-8"
            : filename.endsWith(".png")
              ? "image/png"
              : filename.endsWith(".mjs")
                ? "text/javascript"
                : filename.endsWith(".css")
                  ? "text/css"
                  : filename.endsWith(".json")
                    ? "application/json"
                    : "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        return res.end(content);
      }
      send({ error: "Not found" }, 404);
    } catch (error) {
      send({ error: error.message }, 422);
    }
  });
  const streams = new ViewStreams(server, comparison, () => busy || closing);
  try {
    console.log("Starting isolated comparison backend...");
    // Settle both before cleanup, including a late browser launch when backend
    // startup fails. Otherwise it could escape the owning desk's shutdown.
    const started = await Promise.allSettled([
      services.backend(),
      comparison.launch(),
    ]);
    const failed = started.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    // An empty desk needs no checkpoints. Fetch them only for explicit autoload.
    const situations =
      STARTUP.situationId && !flags.has("--no-auto-load")
        ? await api("/situations", undefined, "GET")
        : [];
    await new Promise((resolve) =>
      server.listen(PORTS.desk, "127.0.0.1", resolve),
    );
    console.log(`Comparison desk: http://localhost:${PORTS.desk}`);
    if (comparison.desktop) {
      await comparison.desktop.open(
        `http://localhost:${PORTS.desk}`,
        !flags.has("--no-open"),
      );
      comparison.desktop.app.on("close", () => void close());
    } else if (!flags.has("--no-open"))
      openURL(`http://localhost:${PORTS.desk}`);
    if (STARTUP.situationId && !flags.has("--no-auto-load")) {
      busy = true;
      try {
        await loadStartupSituation({
          situationId: STARTUP.situationId,
          situations,
          comparison,
          presets,
          preset: STARTUP.preset,
        });
      } catch (error) {
        lastError = error.message;
        console.error(error);
      } finally {
        busy = false;
        await streams.resume();
      }
    }
  } catch (error) {
    await close();
    throw error;
  }
  return { comparison, services, server, devices, reviews, close };
}
