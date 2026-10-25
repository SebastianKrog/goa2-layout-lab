import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../src/config.mjs";
import { instrument } from "../src/instrument.mjs";
test("R2 card wrapper exposes lab staging and safe-inspection metadata without changing its activation handler", async () => {
  const id = path.join(ROOT, "src/components/mobile/MobileCardInteraction.tsx");
  const original = await fs.readFile(id, "utf8");
  const code = instrument(original, id);
  assert.match(code, /data-lab-card=\{card.id\}/);
  assert.match(code, /data-lab-selected=\{props\["aria-pressed"\]/);
  assert.match(code, /data-lab-inspect-card=\{!onStage/);
  assert.ok(code.includes("onStage?.();"));
  assert.ok(code.includes("onInspect();"));
  const listId = path.join(ROOT, "src/components/mobile/MobileCardList.tsx");
  assert.match(
    instrument(await fs.readFile(listId, "utf8"), listId),
    /data-lab-inspect-card=\{card.id\} className=\{styles.inspectShortcut\}/,
  );
});
