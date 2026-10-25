// Exact fixture comparison. Approved changes are explicit, never a global tolerance.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
const root = process.argv[2];
assert.ok(
  root,
  "Pass the directory produced by mobile-r2-renderers.mjs --dpr=2",
);
const native = JSON.parse(
  await fs.readFile(path.join(root, "native.json"), "utf8"),
);
assert.equal(native.dpr, 2);
const rows = [];
for (const fixture of native.metadata) {
  const key = fixture.key;
  const a = PNG.sync.read(
      await fs.readFile(path.join(root, "native-" + key + ".png")),
    ),
    b = PNG.sync.read(
      await fs.readFile(path.join(root, "reference-" + key + ".png")),
    );
  const hidden = key.startsWith("masked-"),
    invalidUltimate = ["ultimate-micro", "ultimate-board"].includes(key),
    caps = key.endsWith("-extended") && key !== "ultimate-extended" && !hidden;
  if (hidden) {
    assert.ok(
      !/Private hidden identity|data-card-active=|data-tier-lines=/.test(
        fixture.html,
      ),
      key,
    );
    rows.push({
      key,
      result:
        "privacy fixture; neutral mask intentionally differs from helpers for visible cards",
      native: [a.width, a.height],
      reference: [b.width, b.height],
    });
    continue;
  }
  if (invalidUltimate) {
    rows.push({
      key,
      result:
        "not a legal passive-Ultimate history location; safe native U fallback only",
    });
    continue;
  }
  assert.equal(a.width, b.width, key);
  assert.equal(a.height, b.height, key);
  let changed = 0,
    central = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data.subarray(i, i + 4).equals(b.data.subarray(i, i + 4))) continue;
    changed++;
    const x = (i / 4) % a.width;
    if (x >= 40 && x < 224) central++;
  }
  if (caps) {
    assert.equal(central, 0, key + ": central Micro geometry changed");
    rows.push({
      key,
      result: "approved attached-cap border; central Micro is exact",
      changed,
      central,
    });
  } else {
    assert.equal(changed, 0, key + ": unexplained pixel difference");
    rows.push({ key, result: "exact", changed });
  }
}
const report = {
  dpr: 2,
  threshold: 0,
  total: rows.length,
  exact: rows.filter((r) => r.result === "exact").length,
  capBorders: rows.filter((r) => r.central === 0).length,
  privacy: rows.filter((r) => r.result.startsWith("privacy")).length,
  invalidHistory: rows.filter((r) => r.result.startsWith("not a legal")).length,
  rows,
};
await fs.writeFile(
  path.join(root, "pixel-comparison.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    total: report.total,
    exact: report.exact,
    capBorders: report.capBorders,
    privacy: report.privacy,
    invalidHistory: report.invalidHistory,
    unexplainedPixels: 0,
  }),
);
