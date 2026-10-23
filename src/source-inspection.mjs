import { capturePresentation } from "./presentation.mjs";
import { presentationEvidence } from "./presentation-model.mjs";
import { reviewAttribution } from "./report.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { DATA } from "./config.mjs";

export function inspectionOptions(body, count) {
  const { indexes, mode = "full", selector = "" } = body;
  if (
    !Array.isArray(indexes) ||
    indexes.length !== 2 ||
    new Set(indexes).size !== 2 ||
    indexes.some((i) => !Number.isInteger(i) || i < 0 || i >= count)
  )
    throw Error("Choose exactly two different open views.");
  if (!["full", "active", "element"].includes(mode))
    throw Error("Unknown extraction mode.");
  if (typeof selector !== "string" || selector.length > 2000)
    throw Error("Use a CSS selector up to 2000 characters.");
  if (mode === "element" && !selector.trim())
    throw Error("Enter a CSS selector for element extraction.");
  return {
    indexes,
    mode,
    selector: mode === "element" ? selector.trim() : null,
  };
}

// Serialized into the inspected page. No DOM changes or game actions.
function readDocument({ selector, mode, maxElements }) {
  const all = [...document.querySelectorAll("*")];
  let roots;
  try {
    roots = selector
      ? [...document.querySelectorAll(selector)]
      : [document.documentElement];
  } catch {
    throw Error("Invalid CSS selector: " + selector);
  }
  if (!roots.length)
    throw Error("Selector did not match any elements: " + selector);
  const paths = new Map();
  function elementPath(e) {
    if (paths.has(e)) return paths.get(e);
    const parent = e.parentElement;
    const siblings = parent
      ? [...parent.children].filter((s) => s.localName === e.localName)
      : [e];
    const result =
      (parent ? elementPath(parent) + " > " : "") +
      CSS.escape(e.localName) +
      ":nth-of-type(" +
      (siblings.indexOf(e) + 1) +
      ")";
    paths.set(e, result);
    return result;
  }
  function properties(style) {
    return Object.fromEntries(
      [...style].sort().map((p) => [p, style.getPropertyValue(p)]),
    );
  }
  const elements = [];
  for (const [index, e] of all.entries()) {
    if (!roots.some((root) => root.contains(e))) continue;
    if (maxElements && elements.length >= maxElements) continue;
    const computed = properties(getComputedStyle(e));
    const pseudo = {};
    for (const name of ["::before", "::after", "::marker"]) {
      const style = getComputedStyle(e, name);
      if (
        (name === "::marker" && computed.display === "list-item") ||
        (name !== "::marker" && !["none", "normal", ""].includes(style.content))
      )
        pseudo[name] = properties(style);
    }
    const b = e.getBoundingClientRect();
    elements.push({
      index,
      path: elementPath(e),
      tag: e.localName,
      bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      computed,
      pseudo,
    });
  }
  const warnings = [];
  if (maxElements && all.filter(e => roots.some(root => root.contains(e))).length > maxElements) warnings.push(`Partial style export: limited to ${maxElements} elements. HTML and image are retained.`);
  if (document.querySelector("iframe,frame"))
    warnings.push("Child-frame documents are not traversed.");
  if (all.some((e) => e.shadowRoot))
    warnings.push("Shadow-root HTML and styles are not traversed.");
  return {
    capturedAt: new Date().toISOString(),
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    elementCount: all.length,
    matches: roots.map((e) => ({
      path: elementPath(e),
      html: mode === "element" ? e.outerHTML : null,
    })),
    html:
      mode === "full"
        ? (document.doctype
            ? new XMLSerializer().serializeToString(document.doctype) + "\n"
            : "") + document.documentElement.outerHTML
        : null,
    elements,
    warnings,
  };
}

// CDP repeats entire inherited rule trees for each descendant. Intern recurring
// structures while retaining all protocol data in a view-local definition table.
export function matchedPool() {
  const definitions = {},
    hashes = new Map(),
    seen = new Map();
  function compact(value) {
    if (
      value === null ||
      (typeof value !== "object" && typeof value !== "string")
    )
      return value;
    if (typeof value === "string" && value.length < 254) return value;
    // Repeated ancestor subtrees are common. Hash before descending so a cache
    // hit avoids walking/serializing every declaration again for each child.
    const raw = JSON.stringify(value);
    const rawKey =
      raw.length >= 256 ? createHash("sha256").update(raw).digest("hex") : null;
    if (rawKey && seen.has(rawKey)) return seen.get(rawKey);
    let normalized;
    if (Array.isArray(value)) normalized = value.map(compact);
    else if (typeof value === "object")
      normalized = Object.fromEntries(
        Object.entries(value).map(([key, v]) => [key, compact(v)]),
      );
    else normalized = value;
    const json = JSON.stringify(normalized);
    if (json.length < 256) {
      if (rawKey) seen.set(rawKey, normalized);
      return normalized;
    }
    const hash = createHash("sha256").update(json).digest("hex");
    let id = hashes.get(hash);
    if (!id) {
      id = "matched-" + (hashes.size + 1);
      hashes.set(hash, id);
      definitions[id] = normalized;
    }
    const reference = { $ref: id };
    if (rawKey) seen.set(rawKey, reference);
    return reference;
  }
  return { compact, definitions };
}

export function expandMatched(value, definitions) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof value.$ref === "string"
  ) {
    if (!(value.$ref in definitions))
      throw Error("Missing matched-style definition: " + value.$ref);
    return expandMatched(definitions[value.$ref], definitions);
  }
  if (Array.isArray(value))
    return value.map((v) => expandMatched(v, definitions));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, expandMatched(v, definitions)]),
    );
  return value;
}

export async function inspectPage(page, options) {
  const { isCancelled, ...queryOptions } = options;
  const session = await page.context().newCDPSession(page);
  const headers = new Map();
  session.on("CSS.styleSheetAdded", ({ header }) =>
    headers.set(header.styleSheetId, header),
  );
  try {
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument", { depth: 0 });
    const { nodeIds } = await session.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: "*",
    });
    const snapshot = await page.evaluate(readDocument, queryOptions);
    const check = await session.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: "*",
    });
    if (
      nodeIds.length !== snapshot.elementCount ||
      JSON.stringify(nodeIds) !== JSON.stringify(check.nodeIds)
    )
      throw Error(
        "Document changed during extraction. Stop interacting and retry.",
      );
    const pool = matchedPool();
    let next = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (next < snapshot.elements.length) {
          if (isCancelled?.()) throw Error("Element capture cancelled.");
          const element = snapshot.elements[next++];
          const matched = await session.send("CSS.getMatchedStylesForNode", {
            nodeId: nodeIds[element.index],
          });
          // CDP node IDs are session-local; paths are the durable element identity.
          delete matched.nodeId;
          element.matched = pool.compact(matched);
        }
      }),
    );
    const sheets = [];
    for (const [id, header] of headers) {
      try {
        const { text } = options.includeStylesheetText === false ? { text: undefined } : await session.send("CSS.getStyleSheetText", {
          styleSheetId: id,
        });
        sheets.push({
          id,
          url: header.sourceURL,
          origin: header.origin,
          disabled: header.disabled,
          inline: header.isInline,
          startLine: header.startLine,
          text,
        });
      } catch (e) {
        snapshot.warnings.push(
          "Stylesheet unavailable: " +
            (header.sourceURL || id) +
            ": " +
            e.message,
        );
      }
    }
    // A second DOM read detects structural changes while rules were collected.
    const after = await session.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: "*",
    });
    if (JSON.stringify(after.nodeIds) !== JSON.stringify(nodeIds))
      throw Error(
        "Document changed during extraction. Retry with stable views.",
      );
    return {
      ...snapshot,
      stylesheets: sheets,
      matchedDefinitions: pool.definitions,
    };
  } finally {
    await session.detach();
  }
}

export function computedCSS(snapshot) {
  const blocks = [];
  for (const e of snapshot.elements) {
    for (const [pseudo, values] of [
      ["", e.computed],
      ...Object.entries(e.pseudo),
    ])
      blocks.push(
        e.path +
          pseudo +
          " {\n" +
          Object.entries(values)
            .map(([k, v]) => "  " + k + ": " + v + ";")
            .join("\n") +
          "\n}",
      );
  }
  return (
    "/* Resolved computed values at capture time; diagnostic snapshot, not authored CSS. */\n" +
    blocks.join("\n\n") +
    "\n"
  );
}

export function computedChanges(a, b) {
  const left = new Map(a.elements.map((e) => [e.path, e]));
  const right = new Map(b.elements.map((e) => [e.path, e]));
  const changes = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const x = left.get(key),
      y = right.get(key);
    if (!x || !y) {
      changes.push({ path: key, status: x ? "left-only" : "right-only" });
      continue;
    }
    const values = {};
    for (const pseudo of new Set([
      "",
      ...Object.keys(x.pseudo),
      ...Object.keys(y.pseudo),
    ])) {
      const p = pseudo ? x.pseudo[pseudo] || {} : x.computed;
      const q = pseudo ? y.pseudo[pseudo] || {} : y.computed;
      const delta = Object.fromEntries(
        [...new Set([...Object.keys(p), ...Object.keys(q)])]
          .filter((k) => p[k] !== q[k])
          .map((k) => [k, { left: p[k] ?? null, right: q[k] ?? null }]),
      );
      if (Object.keys(delta).length) values[pseudo || "element"] = delta;
    }
    if (Object.keys(values).length)
      changes.push({ path: key, status: "changed", values });
  }
  return {
    alignment:
      "Structural CSS paths, not semantic component matching. Different layouts may have unrelated paths.",
    changes,
  };
}

export function inspectionHTML(report) {
  const json = JSON.stringify(report).replaceAll("<", "\\u003c");
  return String.raw`<!doctype html><meta charset="utf-8"><title>HTML and CSS comparison</title>
<style>body{font:15px system-ui;margin:24px;background:#f5f5f3;color:#18202b}select,button{font:inherit;padding:8px}main{display:grid;grid-template-columns:1fr 1fr;gap:16px}section{min-width:0}pre{background:white;border:1px solid #ccc;padding:16px;overflow:auto;max-height:75vh;white-space:pre;font:12px/1.5 monospace}a{color:#164fa0}#notes{white-space:pre-wrap}h2{font-size:17px}</style>
<h1>HTML and CSS comparison</h1><p>Read-only snapshot. Scripts and markup are displayed as text. Computed values include inherited and overridden results; matched rules retain cascade/media details and are not all winning declarations.</p>
<label>Show <select id="mode"><option value="html">HTML</option><option value="stylesheets">Loaded CSS</option><option value="computed">Computed CSS</option><option value="matched">Matched rules and inheritance</option><option value="definitions">Matched rule definitions</option></select></label>
<a href="comparison.json">Full extraction JSON</a> · <a href="changes.json">Computed changes</a>
<p id="notes"></p><main><section><h2 id="leftTitle"></h2><pre id="left"></pre></section><section><h2 id="rightTitle"></h2><pre id="right"></pre></section></main>
<script type="application/json" id="data">${json}</script><script>
const data=JSON.parse(document.getElementById('data').textContent);
const $=id=>document.getElementById(id);
const renderComputed=${computedCSS.toString()};
$('notes').textContent='Situation: '+(data.situationId||'unsaved')+'; mode: '+data.mode+(data.selector?'; selector: '+data.selector:'')+'\nBase: '+(data.references?.base||'unknown')+'\nComparator: '+(data.comparator||'unknown')+'\nUserscript: '+(data.script?.revision||'not loaded')+'\n'+(data.diverged?'Views have different game states.\n':'')+data.views.flatMap(v=>[...(v.snapshot.warnings||[]),...(v.warnings||[]),...(v.errors||[]),...(v.assets||[]),...(v.mutable?['Live working tree; mutable source.']:[]),...(v.config.source==='target'&&!v.scriptActive?['Userscript target is inactive.']:[])].map(w=>'View '+(v.index+1)+': '+w)).join('\n');
function render(){data.views.forEach((v,i)=>{const side=i?'right':'left';const s=v.snapshot;$(side+'Title').textContent='View '+(v.index+1)+' · '+v.config.source+' · '+v.config.seat+' · '+s.viewport.width+'×'+s.viewport.height;
const mode=$('mode').value;
$(side).textContent=mode==='html'?(s.html||s.matches.map(m=>m.html||'HTML not included in active-only extraction.').join('\n\n')):mode==='stylesheets'?s.stylesheets.map(s=>'/* '+s.url+' ['+s.id+'] */\n'+s.text).join('\n\n'):mode==='computed'?(v.computedCSS||renderComputed(s)):mode==='definitions'?JSON.stringify(s.matchedDefinitions,null,2):JSON.stringify({note:'Resolve $ref via Matched rule definitions or comparison.json matchedDefinitions.',elements:s.elements.map(e=>({path:e.path,matched:e.matched}))},null,2);});}
$('mode').onchange=render;render();</script>`;
}

export async function extractSources(
  comparison,
  body,
  reportsRoot = path.join(DATA, "reports"),
  collection = null,
) {
  const options = inspectionOptions(body, comparison.windows.length);
  const before = await Promise.all(
    options.indexes.map((i) => {
      const w = comparison.window(i);
      return comparison.api(`/games/${w.clone.game_id}`, undefined, "GET");
    }),
  );
  const attempts = await Promise.allSettled(
    options.indexes.map(async (index, offset) => {
      const win = comparison.window(index);
      if (win.page.isClosed())
        throw Error("View " + (index + 1) + " is closed.");
      const snapshot = await inspectPage(win.page, options);
      const after = await comparison.api(
        `/games/${win.clone.game_id}`,
        undefined,
        "GET",
      );
      if (before[offset].hash !== after.hash)
        throw Error(
          "Game changed during extraction. Stop interacting and retry.",
        );
      return {
        index,
        config: win.config,
        stateHash: after.hash,
        presentationResolution: presentationEvidence(
          win.config,
          win.intendedPresentation,
          await capturePresentation(win.page, win.config.render),
          win.warnings || [],
        ),
        warnings: win.warnings,
        errors: win.errors,
        assets: win.assets || [],
        snapshot,
        mutable: win.config.source === "live",
        scriptActive: await win.page.evaluate(() =>
          document.documentElement.hasAttribute("data-m2-active"),
        ),
        computedCSS: computedCSS(snapshot),
      };
    }),
  );
  const failed = attempts.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
  const views = attempts.map((r) => r.value);
  const id = "source-" + randomUUID();
  const report = {
    schema: 3,
    review: reviewAttribution(collection),
    id,
    capturedAt: new Date().toISOString(),
    sourceEvidence: (await comparison.services?.provenance?.()) || null,
    mode: options.mode,
    selector: options.selector,
    situationId: comparison.situationId,
    references: comparison.status().references,
    comparator: comparison.status().comparator,
    script: comparison.status().script,
    diverged: views.some((view) => view.stateHash !== views[0].stateHash),
    views,
  };
  const dir = path.join(reportsRoot, id);
  await fs.mkdir(dir, { recursive: true });
  for (const view of views) {
    const prefix = `view-${view.index + 1}`;
    const html =
      view.snapshot.html ||
      view.snapshot.matches
        .map((m) => m.html)
        .filter(Boolean)
        .join("\n\n");
    if (options.mode !== "active")
      await fs.writeFile(path.join(dir, prefix + ".html.txt"), html);
    await fs.writeFile(
      path.join(dir, prefix + ".computed.css"),
      view.computedCSS,
    );
    view.computedCSSFile = prefix + ".computed.css";
    // Values already exist in snapshot.elements and the standalone CSS file.
    // The offline viewer reconstructs CSS on demand instead of embedding a
    // second complete property dump in both comparison.json and index.html.
    delete view.computedCSS;
    await fs.writeFile(
      path.join(dir, prefix + ".active.json"),
      JSON.stringify({
        schema: 2,
        elements: view.snapshot.elements,
        matchedDefinitions: view.snapshot.matchedDefinitions,
      }),
    );
    if (options.mode === "full") {
      for (const [i, sheet] of view.snapshot.stylesheets.entries()) {
        sheet.file = prefix + ".sheet-" + (i + 1) + ".css";
        await fs.writeFile(path.join(dir, sheet.file), sheet.text);
      }
    }
  }
  report.files = [
    "index.html",
    "comparison.json",
    "changes.json",
    ...(await fs.readdir(dir)),
  ];
  await fs.writeFile(path.join(dir, "comparison.json"), JSON.stringify(report));
  await fs.writeFile(
    path.join(dir, "changes.json"),
    JSON.stringify(computedChanges(...views.map((v) => v.snapshot))),
  );
  await fs.writeFile(path.join(dir, "index.html"), inspectionHTML(report));
  return {
    id,
    url: `/reports/${[collection?.prefix, id].filter(Boolean).join("/")}/index.html`,
    diverged: report.diverged,
  };
}
