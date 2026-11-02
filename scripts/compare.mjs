import fs from "node:fs/promises";
import path from "node:path";
const args = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const i = s.indexOf("=");
    return [s.slice(2, i < 0 ? undefined : i), i < 0 ? true : s.slice(i + 1)];
  }),
);
if (args.help) {
  console.log(
    'node scripts/compare.mjs --situation=ID --layout="Desktop · Main vs working tree" [--pane=hand] [--viewpoint=hero_arien] [--presentation=FILE] [--capture] [--origin=http://127.0.0.1:3200]',
  );
  process.exit(0);
}
const origin = new URL(args.origin || "http://127.0.0.1:3200");
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
  !["http:", "https:"].includes(origin.protocol)
)
  throw Error("Use a local lab origin.");
async function request(route, body) {
  const r = await fetch(
    new URL("/api/" + route, origin),
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await r.json();
  if (!r.ok) throw Error(result.error || "Lab request failed");
  return result;
}
const catalog = await request("catalog");
const situation = catalog.situations.find(
  (s) => s.id === args.situation || s.name === args.situation,
);
if (!situation) throw Error("Choose --situation=<library ID or name>.");
const layout = args.layout
  ? catalog.layouts.find((l) => l.id === args.layout || l.name === args.layout)
  : null;
if (args.layout && !layout) throw Error("Layout not found.");
const options = args.presentation
  ? JSON.parse(await fs.readFile(path.resolve(args.presentation), "utf8"))
  : {};
if (args.viewpoint) options.viewpoint = args.viewpoint;
if (args.pane)
  options.presentation = {
    schema: 2,
    ...options.presentation,
    sessionState: {
      ...options.presentation?.sessionState,
      ...(args.pane ? { pane: args.pane } : {}),
    },
  };
const result = await request("load", {
  ...options,
  situationId: situation.id,
  ...(layout ? { layoutId: layout.id } : {}),
});
const report = args.capture ? await request("capture", {}) : null;
console.log(
  JSON.stringify(
    {
      situationId: situation.id,
      layout: layout?.name || "Current Views",
      views: result.windows?.length,
      report,
    },
    null,
    2,
  ),
);
