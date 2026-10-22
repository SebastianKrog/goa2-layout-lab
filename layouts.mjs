import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { validateSlots } from "./config.mjs";

export function makeLayout(
  name,
  configs,
  synchronization = "none",
  id = randomBytes(12).toString("hex"),
) {
  if (!name?.trim() || name.length > 80)
    throw Error("Use a Layout name up to 80 characters.");
  if (!["none", "api", "api-clicks"].includes(synchronization))
    throw Error("Unknown synchronization mode.");
  const views = validateSlots(configs).map(({ uiMode, seat, ...config }) => ({
    ...config,
    uiMode,
    presentationDefaults: {
      schema: 2,
      viewpoint: seat,
      sessionState: {},
      userState: {},
      ...config.presentationDefaults,
    },
  }));
  return {
    schema: 2,
    kind: "layout",
    id,
    name: name.trim(),
    views,
    synchronization,
  };
}
export function layoutSlots(record) {
  if (
    record.schema !== 2 ||
    record.kind !== "layout" ||
    !Array.isArray(record.views)
  )
    throw Error("Invalid Layout record.");
  return validateSlots(
    record.views.map(({ uiMode, ...view }) => ({
      ...view,
      uiMode,
      seat:
        view.overrides?.viewpoint ||
        view.presentationDefaults?.viewpoint ||
        "spectator",
    })),
  );
}
export class Layouts {
  constructor(data, shared) {
    this.data = data;
    this.shared = shared;
    this.records = [];
  }
  async init(presets) {
    this.records = Object.entries(presets).map(([name, views]) =>
      makeLayout(name, views, "none", "builtin-" + name),
    );
    for (const root of [this.shared, path.join(this.data, "layouts")]) {
      let names;
      try {
        names = await fs.readdir(root);
      } catch (e) {
        if (e.code === "ENOENT") continue;
        throw e;
      }
      for (const name of names.filter((n) => n.endsWith(".json")))
        this.records.push(
          JSON.parse(await fs.readFile(path.join(root, name), "utf8")),
        );
    }
    this.saved = [];
    const file = path.join(this.data, "layouts.json");
    try {
      this.saved = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    this.records.push(...this.saved);
    this.records = this.records.filter(
      (record, i, all) =>
        all.findLastIndex((r) => r.name === record.name) === i,
    );
    for (const record of this.records) layoutSlots(record);
    return this;
  }
  slotsByName() {
    return Object.fromEntries(
      this.records.map((record) => [record.name, layoutSlots(record)]),
    );
  }
  find(id) {
    const value = this.records.find((r) => r.id === id || r.name === id);
    if (!value) throw Error("Layout not found.");
    return value;
  }
  async save(name, configs, synchronization) {
    name = name?.trim();
    const value = makeLayout(
      name,
      configs,
      synchronization,
      this.records.find((r) => r.name === name && !r.id.startsWith("builtin-"))
        ?.id || undefined,
    );
    const next = [...this.records.filter((r) => r.name !== name), value];
    const saved = [...this.saved.filter((r) => r.name !== name), value];
    const file = path.join(this.data, "layouts.json");
    await fs.mkdir(this.data, { recursive: true });
    const temp = file + "." + randomBytes(5).toString("hex") + ".tmp";
    await fs.writeFile(temp, JSON.stringify(saved, null, 2));
    await fs.rename(temp, file);
    this.records = next;
    this.saved = saved;
    return value;
  }
}
