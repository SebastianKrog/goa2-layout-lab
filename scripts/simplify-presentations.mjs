import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { sessionChange } from "../src/session-changes.mjs";
const root = path.resolve(import.meta.dirname, "..");
const definitions = [
  ["Open Hand", { pane: "hand" }],
  ["Open Heroes", { pane: "heroes" }],
  ["Open Deck", { pane: "deck" }],
  ["Open Log", { pane: "log" }],
  ["Select Gold card", { selectedCard: { role: "gold" } }],
  [
    "Inspect Tier 2 upgrade A",
    { inspectedCard: { role: "upgrade", tier: 2, branch: "A" } },
  ],
  [
    "Inspect Tier 2 upgrade B",
    { inspectedCard: { role: "upgrade", tier: 2, branch: "B" } },
  ],
  ["View public spells", { publicSpells: true }],
];
const file = path.join(root, "library/presentations.json");
const backup = path.join(
  root,
  ".layout-lab/migrations",
  "session-changes-" + randomBytes(8).toString("hex"),
);
await fs.mkdir(backup, { recursive: true });
await fs.copyFile(file, path.join(backup, "presentations.json"));
const values = definitions.map(([name, change]) => {
  const state = sessionChange(change, { reusable: true });
  return {
    schema: 2,
    id: createHash("sha256")
      .update(JSON.stringify(state))
      .digest("hex")
      .slice(0, 24),
    name,
    state,
  };
});
await fs.writeFile(file, JSON.stringify(values, null, 2) + "\n");
console.log(
  `Saved ${values.length} reusable session changes; original presets backed up in ${backup}`,
);
