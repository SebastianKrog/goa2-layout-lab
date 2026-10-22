import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

export class ReviewDefinitions {
  constructor(root) {
    this.root = root;
  }
  path(id, revision) {
    if (
      !/^[a-f0-9]{24}$/.test(id) ||
      !Number.isSafeInteger(revision) ||
      revision < 1
    )
      throw Error("Invalid Review revision.");
    return path.join(this.root, id, `${revision}.json`);
  }
  async prepare({ previous, name, entries, edited = false }) {
    const id = previous ? previous.reviewId : randomBytes(12).toString("hex");
    let revision = previous?.reviewRevision || 1;
    if (edited) {
      let files = [];
      try {
        files = await fs.readdir(path.join(this.root, id));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      revision =
        Math.max(
          revision,
          ...files
            .filter((n) => /^[1-9][0-9]*\.json$/.test(n))
            .map((n) => Number(n.slice(0, -5))),
        ) + 1;
    }
    const definition = {
      schema: 2,
      kind: "review",
      id,
      revision,
      name,
      entries: entries.map((entry, index) => ({
        id: entry.entryId || randomBytes(12).toString("hex"),
        situationId: entry.situation.id,
      })),
    };
    const file = this.path(id, revision);
    try {
      const saved = JSON.parse(await fs.readFile(file, "utf8"));
      if (!edited && previous) return saved;
      throw Error("Review revision already exists.");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    return definition;
  }
  async commit(definition) {
    const file = this.path(definition.id, definition.revision);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const payload = JSON.stringify(definition, null, 2);
    const temporary = file + "." + randomBytes(6).toString("hex") + ".tmp";
    await fs.writeFile(temporary, payload, { flag: "wx" });
    let created = false;
    try {
      try {
        await fs.link(temporary, file);
        created = true;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if ((await fs.readFile(file, "utf8")) !== payload)
          throw Error("Review revision is immutable.");
      }
    } finally {
      await fs.unlink(temporary);
    }
    return created;
  }
  async discardNew(definition) {
    const file = this.path(definition.id, definition.revision);
    if (
      (await fs.readFile(file, "utf8")) === JSON.stringify(definition, null, 2)
    )
      await fs.unlink(file);
  }
}
