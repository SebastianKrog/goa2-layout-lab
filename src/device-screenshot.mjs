import fs from "node:fs/promises";
import path from "node:path";
import { TOOL } from "./config.mjs";

// Preserve used region geometry and scrolled content when foreignObject is serialized.
export function preserveDeviceClone(native, cloned, clones) {
  if (!(native instanceof HTMLElement) || !(cloned instanceof HTMLElement)) return cloned;
  clones.set(native, cloned);
  if (native.matches('[data-mobile-region], [data-mobile-boxes], [data-mobile-pane]:not([data-mobile-pane] [data-mobile-pane])')) {
    const rect = native.getBoundingClientRect();
    Object.assign(cloned.style, {boxSizing:'border-box', width:rect.width+'px', height:rect.height+'px', minHeight:rect.height+'px', maxHeight:rect.height+'px', flex:'none'});
  }
  if (native.scrollTop || native.scrollLeft) {
    const shift = parent => {
      for (const child of parent.children) {
        if (getComputedStyle(child).display === 'contents') { shift(child); continue; }
        const copy = clones.get(child);
        if (!(copy instanceof HTMLElement)) continue;
        const transform = copy.style.transform;
        copy.style.transform = `translate(${-native.scrollLeft}px, ${-native.scrollTop}px)${transform && transform !== 'none' ? ' '+transform : ''}`;
      }
    };
    shift(native);
  }
  return cloned;
}

export async function deviceImageBundle() {
  const source = await fs.readFile(
    path.join(TOOL, "node_modules/html-to-image/dist/html-to-image.js"),
    "utf8",
  );
  // Keep the shipped renderer's CSS behavior. Add a scheduling boundary to its
  // recursive clone function, without editing node_modules or frontend files.
  const clone = source.match(
    /function ([\w$]+)\(([\w$]+),([\w$]+),([\w$]+)\)\{[\s\S]{0,160}?\4\|\|!\3\.filter\|\|\3\.filter\(\2\)/,
  );
  if (!clone)
    throw Error(
      "Device screenshot adapter needs updating for this html-to-image version.",
    );
  const [, name, first, second, third] = clone;
  const args = `${first},${second},${third}`;
  const entry = `function ${name}(${args}){`;
  const fontRounding = /if\("font-size"===[\w$]+&&[\w$]+\.endsWith\("px"\)\)\{[^}]+\}/;
  if (!fontRounding.test(source)) throw Error("Device screenshot font adapter needs updating.");
  const renderer = source.replace(fontRounding, "");
  return renderer.replace(
    entry,
    `var __goa2CloneBudget=0;var __goa2PreserveClone=${preserveDeviceClone.toString()};function ${name}(${args}){var run=()=>__goa2Clone(${args});return (++__goa2CloneBudget%8===0?new Promise(done=>setTimeout(done,0)).then(run):run()).then(copy=>__goa2PreserveClone(${first},copy,${second}.__goa2Clones||(${second}.__goa2Clones=new WeakMap)))}function __goa2Clone(${args}){`,
  );
}
