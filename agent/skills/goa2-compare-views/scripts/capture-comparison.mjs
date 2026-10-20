#!/usr/bin/env node
// Uses only Node built-ins and the running layout lab's public HTTP API.
import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const args = process.argv.slice(2),
    options = {};
  if (args.includes("--help")) {
    console.log(
      "Capture/export a prepared GoA2 comparison. Leaves the desk running.\n" +
        "node capture-comparison.mjs --origin http://127.0.0.1:3200 --out <new-directory>\n" +
        "  [--indexes 0,1,2] [--base-sha <40-hex>] [--compare-sha <40-hex>]\n" +
        "  [--script-sha <40-hex>] [--allow-diverged]\n" +
        "  [--selector <css>] [--match unique|nth|union|individual|combine] [--occurrence <one-based-number>]",
    );
    return;
  }
  const names = new Set([
    "--origin",
    "--out",
    "--indexes",
    "--base-sha",
    "--compare-sha",
    "--script-sha",
    "--selector",
    "--match",
    "--occurrence",
  ]);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--allow-diverged") {
      options.allowDiverged = true;
      continue;
    }
    if (!names.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--"))
      throw Error("Unknown/incomplete argument: " + args[i]);
    options[args[i].slice(2)] = args[++i];
  }
  if (!options.out) throw Error("--out must name a new export directory.");
  const origin = new URL(options.origin || "http://127.0.0.1:3200");
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw Error("--origin must be the local desk HTTP origin.");
  for (const key of ["base-sha", "compare-sha", "script-sha"])
    if (options[key] && !/^[a-f0-9]{40}$/i.test(options[key]))
      throw Error(key + " must be an exact 40-character Git SHA.");
  const out = path.resolve(options.out);
  try {
    await fs.stat(out);
    throw Error("Export directory already exists: " + out);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  async function request(route, body) {
    const r = await fetch(new URL(route, origin), {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(600000),
    });
    const value = await r.json();
    if (!r.ok)
      throw Error(value.error || value.detail || JSON.stringify(value));
    return value;
  }
  function checkRefs(status) {
    for (const [key, actual] of [
      ["base-sha", status.references?.base],
      ["compare-sha", status.comparator],
      ["script-sha", status.script?.revision],
    ])
      if (options[key] && options[key].toLowerCase() !== actual?.toLowerCase())
        throw Error(key + " mismatch: loaded " + actual);
  }
  const status = await request("/api/status");
  if (status.busy) throw Error("Desk is busy; wait for the current operation.");
  checkRefs(status);
  let indexes =
    options.indexes === undefined
      ? status.windows.map((_, i) => i)
      : options.indexes
          .split(",")
          .map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));
  if (
    ![2, 3].includes(indexes.length) ||
    new Set(indexes).size !== indexes.length ||
    indexes.some((i) => !Number.isInteger(i) || i < 0 || !status.windows[i])
  )
    throw Error("Select two or three distinct zero-based window indexes.");
  const views = await request("/api/views");
  for (const i of indexes) {
    const w = status.windows[i],
      v = views.find((v) => v.index === i);
    if (w.closed || w.warnings?.length || w.errors?.length || w.assets?.length)
      throw Error(
        "View " +
          i +
          " is closed or reports restore/render/asset problems: " +
          JSON.stringify(w),
      );
    if (w.config.source === "live")
      throw Error(
        "Live working tree is enabled; select committed Comparator for commit-to-commit evidence.",
      );
    if (w.config.source === "target" && !v?.scriptActive)
      throw Error(
        "Userscript target is inactive in view " +
          i +
          "; use a supported phone/2D viewport.",
      );
  }
  if (
    !options.allowDiverged &&
    new Set(indexes.map((i) => views.find((v) => v.index === i)?.state.hash))
      .size !== 1
  )
    throw Error(
      "Games diverged; reset/load the same situation, or use --allow-diverged for an intentional comparison.",
    );
  if (!options.selector && (options.match || options.occurrence))
    throw Error("Crop --match/--occurrence requires --selector.");
  const crop = options.selector
    ? {
        selector: options.selector,
        match: options.match || "unique",
        ...(options.occurrence
          ? { occurrence: Number(options.occurrence) }
          : {}),
      }
    : null;
  const report = await request("/api/capture", {
    indexes,
    ...(crop ? { crop } : {}),
  });
  if (
    !/^[A-Za-z0-9._-]+$/.test(report.id) ||
    report.url !== "/reports/" + report.id + "/index.html"
  )
    throw Error("Unexpected report URL.");
  const prefix = "/reports/" + report.id + "/";
  const metadata = await request(prefix + "report.json");
  checkRefs(metadata);
  if (!options.allowDiverged && metadata.diverged)
    throw Error(
      "Games diverged during capture; inspect " + new URL(report.url, origin),
    );
  if (metadata.captures.some((c) => c.source === "live" || c.dirty))
    throw Error(
      "Report includes a live working tree; immutable commit evidence required.",
    );
  const files = [
    "index.html",
    "report.json",
    "side-by-side.png",
    ...metadata.captures.map((c) => c.file),
    ...metadata.captures.flatMap((c) => (c.parts || []).map((p) => p.file)),
    ...metadata.pairs.filter((p) => p.available).map((p) => p.file),
  ];
  if (
    files.some(
      (f) =>
        !/^(index\.html|report\.json|side-by-side\.png|window-\d+(?:-match-\d+)?\.png|diff-\d+-\d+\.png)$/.test(
          f,
        ),
    )
  )
    throw Error("Unexpected report filename.");
  await fs.mkdir(out, { recursive: true });
  for (const file of new Set(files)) {
    const r = await fetch(new URL(prefix + file, origin), {
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw Error("Export failed for " + file + ": HTTP " + r.status);
    await fs.writeFile(
      path.join(out, file),
      Buffer.from(await r.arrayBuffer()),
    );
  }
  console.log(
    JSON.stringify(
      {
        reportId: report.id,
        reportUrl: new URL(report.url, origin).href,
        directory: out,
        viewer: path.join(out, "index.html"),
        combined: path.join(out, "side-by-side.png"),
        metadata: path.join(out, "report.json"),
        base: metadata.references.base,
        comparator: metadata.comparator,
        script: metadata.script?.revision || null,
        diverged: metadata.diverged,
        pairs: metadata.pairs.map((p) => ({
          a: p.a,
          b: p.b,
          available: p.available,
          reason: p.reason,
          ratio: p.ratio,
          differentViewpoints: p.differentViewpoints,
          file: p.file ? path.join(out, p.file) : null,
        })),
      },
      null,
      2,
    ),
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
