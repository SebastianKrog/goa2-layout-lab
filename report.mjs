import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { DATA } from "./config.mjs";
import { capturePresentation } from "./presentation.mjs";
import { delay, git } from "./services.mjs";
import { normalizeCrop, resolveCrop, cropImage } from "./element-crop.mjs";

export const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function imageDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height)
    return {
      available: false,
      reason: "Different image dimensions; originals retained.",
    };
  const png = new PNG({ width: a.width, height: a.height });
  const pixels = pixelmatch(a.data, b.data, png.data, a.width, a.height, {
    threshold: 0.1,
  });
  return { available: true, pixels, ratio: pixels / (a.width * a.height), png };
}
export function strip(images) {
  const width = images.reduce((n, p) => n + p.width, 0),
    height = Math.max(...images.map((p) => p.height));
  const png = new PNG({ width, height, fill: true });
  let offset = 0;
  for (const image of images) {
    PNG.bitblt(image, png, 0, 0, image.width, image.height, offset, 0);
    offset += image.width;
  }
  return png;
}
export async function stableScreenshot(win, cropOptions = null) {
  await win.page.evaluate(() => document.fonts.ready);
  await win.page.waitForLoadState("networkidle", { timeout: 60_000 });
  // Native card canvases paint after lazy imports/fonts/backgrounds resolve.
  // A transparent canvas can be pixel-stable while still loading.
  await win.page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-card-paint-state="loading"]')].every(
        (element) => {
          if (!element.checkVisibility()) return true;
          const box = element.getBoundingClientRect();
          return (
            box.bottom <= 0 ||
            box.top >= innerHeight ||
            box.right <= 0 ||
            box.left >= innerWidth
          );
        },
      ),
    null,
    { timeout: 60_000 },
  );
  const brokenImages = await win.page.evaluate(async () => {
    const visible = (image) => {
      if (!image.checkVisibility()) return false;
      let r = image.getBoundingClientRect();
      let left = Math.max(0, r.left),
        right = Math.min(innerWidth, r.right);
      let top = Math.max(0, r.top),
        bottom = Math.min(innerHeight, r.bottom);
      for (let p = image.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p);
        r = p.getBoundingClientRect();
        if (/(hidden|auto|scroll|clip)/.test(style.overflowX)) {
          left = Math.max(left, r.left);
          right = Math.min(right, r.right);
        }
        if (/(hidden|auto|scroll|clip)/.test(style.overflowY)) {
          top = Math.max(top, r.top);
          bottom = Math.min(bottom, r.bottom);
        }
      }
      return right > left && bottom > top;
    };
    const images = [...document.images].filter(visible);
    await Promise.all(images.map((i) => i.decode().catch(() => {})));
    return [
      ...images.filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src),
      ...[...document.querySelectorAll('[data-card-paint-state="failed"]')]
        .filter(visible)
        .map(
          (element) =>
            `Card paint failed: ${element.getAttribute("aria-label")}`,
        ),
    ];
  });
  if (win.errors.length || win.assets.length || brokenImages.length) {
    throw new Error(
      `Incomplete ${win.config.source} view: ${[...win.errors, ...win.assets, ...brokenImages].slice(0, 8).join("; ")}`,
    );
  }
  let previous;
  for (let tries = 0; tries < 15; tries++) {
    const before = await resolveCrop(win.page, cropOptions);
    let bytes = await win.page.screenshot({
      animations: "disabled",
      caret: "hide",
      timeout: win.page.__labNative ? 120_000 : 30_000,
    });
    const after = await resolveCrop(win.page, cropOptions);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      previous = null;
      await delay(350);
      continue;
    }
    const { image, crop, parts = [] } = cropImage(PNG.sync.read(bytes), after);
    if (crop) bytes = PNG.sync.write(image);
    if (previous && JSON.stringify(previous.crop) === JSON.stringify(crop)) {
      const diff = imageDiff(previous.image, image);
      if (diff.available && diff.ratio < 0.0001)
        return { bytes, image, crop, parts };
    }
    previous = { bytes, image, crop };
    await delay(350);
  }
  throw new Error(
    `The ${win.config.source} screenshot did not settle. Check camera motion, rendering and animations.`,
  );
}
export async function captureReport(comparison, indexes, options = {}) {
  const cropOptions = normalizeCrop(options.crop);
  indexes ||= comparison.windows.map((_, i) => i);
  if (indexes.length < 2)
    throw new Error("Select at least two comparison windows.");
  if (cropOptions) {
    // Validate every view before writing artifacts; a missing/ambiguous match in
    // any selected view is an error, never a skipped or guessed comparison.
    await Promise.all(
      indexes.map(async (i) => {
        try {
          return await resolveCrop(comparison.window(i).page, cropOptions);
        } catch (e) {
          throw Error(`View ${i + 1}: ${e.message}`);
        }
      }),
    );
  }
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const dir = path.join(DATA, "reports", id);
  await fs.mkdir(dir, { recursive: true });
  const metadata = {
    id,
    capturedAt: new Date().toISOString(),
    ...comparison.status(),
    captures: [],
    pairs: [],
    crop: cropOptions,
  };
  const images = [];
  for (const index of indexes) {
    const win = comparison.window(index);
    await comparison.ready(win);
    const state = await comparison.api(
      `/games/${win.clone.game_id}`,
      undefined,
      "GET",
    );
    const shot = await stableScreenshot(win, cropOptions);
    const after = await comparison.api(
      `/games/${win.clone.game_id}`,
      undefined,
      "GET",
    );
    if (state.hash !== after.hash)
      throw new Error(
        "A game changed during capture. Stop interacting and capture again.",
      );
    const presentation = await capturePresentation(win.page, win.config.render);
    const individual = cropOptions?.match === "individual";
    const partFiles = [];
    for (const part of shot.parts || []) {
      const occurrence = part.crop.selected[0].occurrence;
      const file = `window-${index + 1}-match-${occurrence}.png`;
      await fs.writeFile(path.join(dir, file), PNG.sync.write(part.image));
      partFiles.push({
        file,
        occurrence,
        width: part.image.width,
        height: part.image.height,
        crop: part.crop,
      });
    }
    const captures = individual ? shot.parts : [shot];
    for (const capture of captures) {
      const occurrence = individual
        ? capture.crop.selected[0].occurrence
        : null;
      const file = individual
        ? `window-${index + 1}-match-${occurrence}.png`
        : `window-${index + 1}.png`;
      const bytes = capture.bytes || PNG.sync.write(capture.image);
      if (!individual) await fs.writeFile(path.join(dir, file), bytes);
      metadata.captures.push({
        index,
        file,
        ...win.config,
        state,
        presentation,
        occurrence,
        parts: individual ? [] : partFiles,
        width: capture.image.width,
        height: capture.image.height,
        crop: capture.crop,
        checksum: createHash("sha256").update(bytes).digest("hex"),
        dirty:
          win.config.source === "live"
            ? git(["status", "--porcelain", "--untracked-files=normal"])
                .length > 0
            : false,
      });
      images.push(capture.image);
    }
  }
  metadata.diverged =
    new Set(metadata.captures.map((c) => c.state.hash)).size > 1;
  for (let i = 0; i < images.length; i++)
    for (let j = i + 1; j < images.length; j++) {
      const a = metadata.captures[i],
        b = metadata.captures[j];
      // Individual images compare corresponding visible DOM occurrences across
      // views, never different elements within the same view.
      if (a.index === b.index || a.occurrence !== b.occurrence) continue;
      const countsDiffer =
        cropOptions?.match === "combine" && a.parts.length !== b.parts.length;
      const result = countsDiffer
        ? {
            available: false,
            reason:
              "Different match counts; compare individual crops or refine the selector.",
          }
        : imageDiff(images[i], images[j]);
      const file = result.available ? `diff-${i}-${j}.png` : null;
      if (result.png)
        await fs.writeFile(path.join(dir, file), PNG.sync.write(result.png));
      metadata.pairs.push({
        a: i,
        b: j,
        file,
        available: result.available,
        reason: result.reason,
        pixels: result.pixels,
        ratio: result.ratio,
        differentViewpoints:
          metadata.captures[i].seat !== metadata.captures[j].seat ||
          JSON.stringify(metadata.captures[i].presentation.camera) !==
            JSON.stringify(metadata.captures[j].presentation.camera),
      });
    }
  await fs.writeFile(
    path.join(dir, "side-by-side.png"),
    PNG.sync.write(strip(images)),
  );
  await fs.writeFile(
    path.join(dir, "report.json"),
    JSON.stringify(metadata, null, 2),
  );
  await fs.writeFile(path.join(dir, "index.html"), reportHTML(metadata));
  return { id, url: `/reports/${id}/index.html`, diverged: metadata.diverged };
}
export function reportHTML(meta) {
  const safe = JSON.stringify(meta).replaceAll("<", "\\u003c");
  return `<!doctype html><meta charset="utf-8"><title>GoA2 comparison</title>
  <style>body{font:15px system-ui;background:#111827;color:#eee;margin:24px}a{color:#7dd3fc}section{display:flex;gap:16px;overflow:auto;align-items:flex-start}figure{margin:0;flex:1;min-width:260px}figure img{display:block;width:100%;height:auto}pre{white-space:pre-wrap}#overlay{position:relative;width:max-content;max-width:100%;overflow:auto}#overlay img{display:block;max-width:90vw}#over{position:absolute;inset:0;width:100%}select,input{margin:10px}strong{color:#fbbf24}</style>
  <h1>GoA2 comparison</h1><p>${escapeHTML(meta.capturedAt)} Â· situation ${escapeHTML(meta.situationId)}</p>
  <p>Base ${escapeHTML(meta.references.base)}<br>Comparator ${escapeHTML(meta.comparator)}<br>Script ${escapeHTML(meta.script?.revision || "not loaded")}</p>
  ${meta.crop ? `<p>Element crop: <code>${escapeHTML(meta.crop.selector)}</code> · ${escapeHTML(meta.crop.match)}${meta.crop.match === "nth" ? ` · occurrence ${meta.crop.occurrence}` : ""}. Visible viewport pixels only; surrounding/overlapping content remains. Individual/Combine crops are ordered by visible DOM occurrence; Combine places them in a horizontal strip without resizing or the original gaps. Each view is cropped independently; unequal image dimensions cannot be diffed.</p>` : ""}
  ${meta.diverged ? "<strong>Different game states: these windows advanced independently.</strong>" : "<p>Equivalent game states.</p>"}
  <section>${meta.captures.map((c) => `<figure style="max-width:${c.width}px"><figcaption>${escapeHTML(c.label || c.source)} Â· ${escapeHTML(c.source)} Â· ${escapeHTML(c.render)} Â· ${escapeHTML(c.profile)} Â· ${escapeHTML(c.seat)}${c.dirty ? " Â· uncommitted edits" : ""}${c.crop ? ` · ${c.crop.visibleMatches} visible matches; ${c.crop.selected.length} selected${c.occurrence ? ` · occurrence ${c.occurrence}` : ""}` : ""}</figcaption>${(meta.windows?.[c.index]?.warnings || []).map((w) => `<p><strong>${escapeHTML(w)}</strong></p>`).join("")}<a href="${c.file}"><img src="${c.file}" width="${c.width}" height="${c.height}"></a>${c.parts?.length ? `<p>Individual crops: ${c.parts.map((p) => `<a href="${p.file}">${p.occurrence}</a>`).join(" · ")}</p>` : ""}</figure>`).join("")}</section>
  <h2>Pair comparison</h2><select id="pair"></select><label>Overlay opacity <input id="opacity" type="range" min="0" max="100" value="50"></label><p id="note"></p>
  <div id="overlay"><img id="under"><img id="over"></div><h3>Pixel difference</h3><img id="diff" style="max-width:90vw"><p><a href="side-by-side.png">Full size strip</a> Â· <a href="report.json">Reproduction metadata</a></p>
  <script>const meta=${safe};const pair=document.querySelector('#pair');meta.pairs.forEach((p,i)=>{const o=document.createElement('option');o.value=i;o.textContent=meta.captures[p.a].source+' â†” '+meta.captures[p.b].source+' ('+(p.a+1)+' / '+(p.b+1)+')'+(meta.captures[p.a].occurrence?' · match '+meta.captures[p.a].occurrence:'');pair.append(o)});function update(){const p=meta.pairs[pair.value];document.querySelector('#note').textContent=!p.available?p.reason:(p.differentViewpoints?'Different player seats/cameras. ':'')+(p.ratio*100).toFixed(2)+'% pixels differ; informational, not a pass/fail check.';document.querySelector('#overlay').hidden=!p.available;document.querySelector('#diff').hidden=!p.available;if(p.available){document.querySelector('#under').src=meta.captures[p.a].file;document.querySelector('#over').src=meta.captures[p.b].file;document.querySelector('#diff').src=p.file}}pair.onchange=update;document.querySelector('#opacity').oninput=e=>document.querySelector('#over').style.opacity=e.target.value/100;document.querySelector('#over').style.opacity='.5';update();</script>`;
}
