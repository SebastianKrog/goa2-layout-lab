import { PNG } from "pngjs";

export function normalizeCrop(value) {
  if (value == null) return null;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.selector !== "string" ||
    !value.selector.trim() ||
    value.selector.length > 2000
  )
    throw Error("Element crop needs a CSS selector (up to 2000 characters).");
  const match = value.match ?? "unique";
  if (!["unique", "nth", "union", "individual", "combine"].includes(match))
    throw Error(
      "Crop match must be unique, nth, union, individual or combine.",
    );
  if (match !== "nth" && value.occurrence !== undefined)
    throw Error("Crop occurrence is only valid with the nth match policy.");
  const occurrence = value.occurrence ?? 1;
  if (match === "nth" && (!Number.isInteger(occurrence) || occurrence < 1))
    throw Error("Crop occurrence must be a positive, one-based integer.");
  return {
    selector: value.selector.trim(),
    match,
    ...(match === "nth" ? { occurrence } : {}),
  };
}

// Main-document light DOM only, deliberately matching the HTML/CSS inspector.
export async function resolveCrop(page, options) {
  if (!options) return null;
  return page.evaluate(({ selector, match, occurrence }) => {
    let matches;
    try {
      matches = [...document.querySelectorAll(selector)];
    } catch {
      throw Error("Invalid crop CSS selector: " + selector);
    }
    const visible = [];
    for (const [domIndex, element] of matches.entries()) {
      if (
        !element.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
        })
      )
        continue;
      const rect = element.getBoundingClientRect();
      let left = Math.max(0, rect.left),
        top = Math.max(0, rect.top);
      let right = Math.min(innerWidth, rect.right),
        bottom = Math.min(innerHeight, rect.bottom);
      for (let p = element.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p),
          box = p.getBoundingClientRect();
        if (
          style.display === "none" ||
          Number(style.opacity) === 0 ||
          style.contentVisibility === "hidden"
        ) {
          right = left;
          break;
        }
        // clientWidth/Height exclude borders and scrollbar gutters from the clip.
        const sx = p.offsetWidth ? box.width / p.offsetWidth : 1;
        const sy = p.offsetHeight ? box.height / p.offsetHeight : 1;
        if (/(hidden|auto|scroll|clip)/.test(style.overflowX)) {
          left = Math.max(left, box.left + p.clientLeft * sx);
          right = Math.min(
            right,
            box.left + (p.clientLeft + p.clientWidth) * sx,
          );
        }
        if (/(hidden|auto|scroll|clip)/.test(style.overflowY)) {
          top = Math.max(top, box.top + p.clientTop * sy);
          bottom = Math.min(
            bottom,
            box.top + (p.clientTop + p.clientHeight) * sy,
          );
        }
      }
      if (right <= left || bottom <= top) continue;
      visible.push({
        domIndex,
        occurrence: visible.length + 1,
        tag: element.localName,
        id: element.id,
        bounds: { x: left, y: top, width: right - left, height: bottom - top },
      });
    }
    if (!visible.length)
      throw Error(
        `Crop selector "${selector}" has no visible matches in the viewport (${matches.length} DOM matches). Open the panel or scroll it into view first.`,
      );
    if (match === "unique" && visible.length !== 1)
      throw Error(
        `Crop selector "${selector}" has ${visible.length} visible matches. Refine the selector, choose an occurrence, or choose all visible matches.`,
      );
    if (match === "nth" && occurrence > visible.length)
      throw Error(
        `Crop occurrence ${occurrence} is unavailable for "${selector}"; only ${visible.length} visible matches.`,
      );
    const selected = ["union", "individual", "combine"].includes(match)
      ? visible
      : [visible[match === "nth" ? occurrence - 1 : 0]];
    const x = Math.min(...selected.map((v) => v.bounds.x)),
      y = Math.min(...selected.map((v) => v.bounds.y));
    const right = Math.max(...selected.map((v) => v.bounds.x + v.bounds.width));
    const bottom = Math.max(
      ...selected.map((v) => v.bounds.y + v.bounds.height),
    );
    return {
      selector,
      match,
      ...(match === "nth" ? { occurrence } : {}),
      totalMatches: matches.length,
      visibleMatches: visible.length,
      selected,
      bounds: { x, y, width: right - x, height: bottom - y },
      viewport: { width: innerWidth, height: innerHeight },
    };
  }, options);
}

function cropBox(image, crop) {
  if (!crop) return { image, crop: null };
  const scaleX = image.width / crop.viewport.width,
    scaleY = image.height / crop.viewport.height;
  const x = Math.max(0, Math.floor(crop.bounds.x * scaleX)),
    y = Math.max(0, Math.floor(crop.bounds.y * scaleY));
  const right = Math.min(
    image.width,
    Math.ceil((crop.bounds.x + crop.bounds.width) * scaleX),
  );
  const bottom = Math.min(
    image.height,
    Math.ceil((crop.bounds.y + crop.bounds.height) * scaleY),
  );
  if (right <= x || bottom <= y)
    throw Error("Element crop has no screenshot pixels.");
  const output = new PNG({ width: right - x, height: bottom - y });
  PNG.bitblt(image, output, x, y, output.width, output.height, 0, 0);
  return {
    image: output,
    crop: {
      ...crop,
      pixels: { x, y, width: output.width, height: output.height },
      scaleX,
      scaleY,
    },
  };
}

// Compose only the individual crops, in DOM order, without viewport gaps.
export function cropImage(image, crop) {
  if (!crop || !["individual", "combine"].includes(crop.match))
    return cropBox(image, crop);
  const parts = crop.selected.map((selected) =>
    cropBox(image, {
      ...crop,
      selected: [selected],
      bounds: selected.bounds,
    }),
  );
  const width = parts.reduce((n, p) => n + p.image.width, 0);
  const height = Math.max(...parts.map((p) => p.image.height));
  const combined = new PNG({ width, height, fill: true });
  let x = 0;
  const tiles = parts.map((part) => {
    PNG.bitblt(
      part.image,
      combined,
      0,
      0,
      part.image.width,
      part.image.height,
      x,
      0,
    );
    const tile = {
      occurrence: part.crop.selected[0].occurrence,
      source: part.crop.pixels,
      output: { x, y: 0, width: part.image.width, height: part.image.height },
    };
    x += part.image.width;
    return tile;
  });
  return {
    image: combined,
    parts,
    crop: {
      ...crop,
      composition: "horizontal-dom-order",
      tiles,
      scaleX: parts[0].crop.scaleX,
      scaleY: parts[0].crop.scaleY,
    },
  };
}
