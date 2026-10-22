// Real desk UI with isolated API fixtures: no game servers or user sessions touched.
import fs from "node:fs/promises";
import path from "node:path";
import { TOOL, PRESETS, PROFILES, STARTUP, REFERENCES } from "../../config.mjs";

export async function deskFixture(context, { views = 0, files = {} } = {}) {
  const situations = [];
  for (const file of (
    await fs.readdir(path.join(TOOL, "situations"), { recursive: true })
  )
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const s = JSON.parse(
      await fs.readFile(path.join(TOOL, "situations", file), "utf8"),
    );
    situations.push({
      ...s,
      origin: "library",
      group: path.dirname(file).replaceAll("\\", "/").replace(/^\.$/, ""),
    });
  }
  situations.push({
    ...situations[0],
    id: "draftfixture",
    name: "Draft — selected card with inspection open",
    origin: "local",
    group: "drafts",
  });
  const catalog = {
    situations,
    presets: PRESETS,
    profiles: PROFILES,
    layouts: [],
    presentations: [
      {
        id: "template",
        name: "Hand open",
        render: "2d",
        state: { schema: 2, sessionState: { pane: "hand" }, userState: {} },
      },
    ],
    decisionStates: [{ id: "a".repeat(64), name: "Planning" }],
    commits: [],
    settings: {
      ...STARTUP,
      frontend: "../goa2-frontend",
      backend: "../goa2-backend-bots",
      patch: "../goa2-mobile-2d-patch",
      baseRef: REFERENCES.base,
      scriptRef: REFERENCES.script,
    },
  };
  const state = {
    windows: Array.from({ length: views }, (_, i) => ({
      index: i,
      config: {
        ...PRESETS.Current[0],
        source: i ? "comparator" : "live",
        profile: "portrait",
        uiMode: "mobile",
        seat: "hero_arien",
      },
      gameId: "fixture" + i,
      seats: ["hero_arien", "hero_hanu", "hero_brogan", "hero_tigerclaw"],
      situationId: situations[0].id,
      warnings: [],
      errors: [],
      assets: [],
    })),
    busy: false,
    services: [],
    situationId: views ? situations[0].id : null,
    display: "browser",
    runtime: { mode: "wsl", platform: "win32", arch: "x64" },
    references: REFERENCES,
    comparator: "abcdef0123456789",
    synchronization: { mode: "none", cheats: false, pending: 0, skipped: 0 },
  };
  const runs = [0, 1, 2].map((n) => ({
    id: String(n + 1).repeat(24),
    reviewId: (n < 2 ? "a" : "b").repeat(24),
    reviewRevision: 1,
    name: n < 2 ? "Mobile layout sweep" : "Planning controls",
    createdAt: `2026-10-${22 - n}T10:20:00Z`,
    status: n === 1 ? "interrupted" : "ended",
    total: 12,
    visited: 8,
    position: 8,
    reports: 3,
    reportedSituations: 2,
    views: 2,
    reportKinds: { element: 2, device: 1 },
    parentRunId: n === 0 ? "2".repeat(24) : null,
    url: "/reports/fixture/index.html",
  }));
  const requests = [];
  await context.addInitScript(() => {
    window.WebSocket = class {
      static OPEN = 1;
      readyState = 1;
      send() {}
      close() {
        this.readyState = 3;
      }
    };
  });
  await context.route("http://desk.test/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (u.pathname.startsWith("/api/")) {
      let value = {};
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        requests.push({ path: u.pathname, body });
        if (u.pathname === "/api/synchronize")
          state.synchronization.mode = body.mode;
        if (u.pathname === "/api/cheats")
          state.synchronization.cheats = body.show;
        if (u.pathname === "/api/configure")
          Object.assign(state.windows[body.index || 0].config, body.update);
        if (u.pathname === "/api/clear") state.windows = [];
        value = state;
      } else if (u.pathname === "/api/catalog") value = catalog;
      else if (u.pathname === "/api/status") value = state;
      else if (u.pathname === "/api/reviews")
        value = {
          reviews: [{ runs: runs.slice(0, 2) }, { runs: runs.slice(2) }],
          warnings: [],
        };
      else if (u.pathname.startsWith("/api/review-runs/"))
        value = {
          ...runs.find((r) => r.id === u.pathname.split("/").pop()),
          entries: situations
            .slice(0, 4)
            .map((s, index) => ({ index, situationId: s.id, name: s.name })),
        };
      else if (u.pathname === "/api/device/options")
        value = {
          botKinds: ["random", "heuristic", "ismcts"],
          seats: [
            ...(state.windows[0]?.seats || [
              "hero_arien",
              "hero_hanu",
              "hero_brogan",
              "hero_tigerclaw",
            ]),
            "spectator",
          ].map((id) => ({ id, name: id.replace("hero_", "") })),
        };
      else if (u.pathname === "/api/device/views") value = [];
      else if (u.pathname === "/api/element-report/status")
        value = { enabled: false, drafts: [] };
      return route.fulfill({ json: value });
    }
    const file = path.resolve(
      TOOL,
      "public",
      u.pathname === "/" ? "index.html" : "." + u.pathname,
    );
    if (!file.startsWith(path.resolve(TOOL, "public") + path.sep))
      return route.abort();
    return route.fulfill({
      body: files[path.basename(file)] ?? (await fs.readFile(file)),
      contentType: file.endsWith(".mjs")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    });
  });
  return { state, catalog, requests };
}
