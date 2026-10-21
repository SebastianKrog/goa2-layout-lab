import fs from "node:fs/promises";
import path from "node:path";
import { TOOL } from "./config.mjs";

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
  return source.replace(
    entry,
    `var __goa2CloneBudget=0;function ${name}(${args}){if(++__goa2CloneBudget%8===0)return new Promise(function(done){setTimeout(done,0)}).then(function(){return __goa2Clone(${args})});return __goa2Clone(${args})}function __goa2Clone(${args}){`,
  );
}
