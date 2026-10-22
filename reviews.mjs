import { makeLayout, layoutSlots } from "./layouts.mjs";
import { ReviewDefinitions } from "./review-definitions.mjs";
import { resolveView } from "./presentation-model.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DATA, slotsForSituation, validateSlots } from "./config.mjs";
import { escapeHTML } from "./report.mjs";

// A review owns its queue and evidence, never changes the saved Situations.
export class Reviews {
  constructor(
    comparison,
    devices,
    { root = path.join(DATA, "reports", "reviews"), guard = () => {} } = {},
  ) {
    this.comparison = comparison;
    this.devices = devices;
    this.root = root;
    this.guard = guard;
    this.current = null;
    this.records = new Map();
    this.writes = Promise.resolve();
    this.definitions = new ReviewDefinitions(path.join(root, "_definitions"));
  }
  status() {
    const r = this.current;
    return r
      ? {
          id: r.id,
          runId: r.id,
          reviewId: r.reviewId,
          reviewRevision: r.reviewRevision,
          entryId: r.entries[r.index]?.entryId || `${r.id}:${r.index}`,
          name: r.name,
          active: r.active,
          index: r.index,
          total: r.entries.length,
          situationId: r.entries[r.index]?.situation.id,
          situationName: r.entries[r.index]?.situation.name,
          previous: r.active && r.index > 0,
          next: r.active && r.index < r.entries.length - 1,
          url: `/reports/reviews/${r.id}/index.html`,
          reports: r.reports.length,
        }
      : null;
  }
  validId(id) {
    if (typeof id !== "string" || !/^[a-f0-9]{24}$/.test(id))
      throw Error("Invalid review identifier.");
    return id;
  }
  async saved(id) {
    this.validId(id);
    await this.writes;
    const r =
      this.current?.id === id
        ? this.current
        : JSON.parse(
            await fs.readFile(path.join(this.root, id, "review.json"), "utf8"),
          );
    if (
      r.schema !== 2 ||
      r.kind !== "review-run" ||
      !r.reviewId ||
      !Number.isSafeInteger(r.reviewRevision) ||
      r.id !== id ||
      !Array.isArray(r.entries) ||
      !r.entries.length ||
      !Number.isInteger(r.index) ||
      r.index < 0 ||
      r.index >= r.entries.length ||
      r.entries.some(
        (e) => !e?.situation || typeof e.situation.id !== "string",
      ) ||
      !Array.isArray(r.reports)
    )
      throw Error("Invalid saved review.");
    return r;
  }
  summary(r) {
    const live = this.current?.id === r.id && this.current.active;
    const kinds = {};
    for (const report of r.reports)
      kinds[report.kind || "report"] =
        (kinds[report.kind || "report"] || 0) + 1;
    return {
      id: r.id,
      runId: r.id,
      reviewId: r.reviewId,
      reviewRevision: r.reviewRevision,
      name: r.name,
      createdAt: r.createdAt,
      endedAt: r.endedAt || null,
      status: live ? "active" : r.active ? "interrupted" : "ended",
      total: r.entries.length,
      position: r.index + 1,
      visited: Array.isArray(r.visited) ? new Set(r.visited).size : null,
      reports: r.reports.length,
      reportedSituations: new Set(r.reports.map((p) => p.index)).size,
      reportKinds: kinds,
      views: r.layout.views.length,
      parentRunId: r.parentRunId || null,
      url: `/reports/reviews/${r.id}/index.html`,
    };
  }
  async list() {
    await this.writes;
    let dirs;
    try {
      dirs = await fs.readdir(this.root, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT")
        return { runs: [], reviews: [], warnings: [] };
      throw error;
    }
    const reviews = [],
      warnings = [];
    for (const dir of dirs.filter(
      (d) => d.isDirectory() && /^[a-f0-9]{24}$/.test(d.name),
    )) {
      try {
        reviews.push(this.summary(await this.saved(dir.name)));
      } catch (error) {
        if (error.code !== "ENOENT")
          warnings.push(`Could not read review ${dir.name}.`);
      }
    }
    reviews.sort(
      (a, b) =>
        (b.createdAt || "").localeCompare(a.createdAt || "") ||
        b.id.localeCompare(a.id),
    );
    const groups = [];
    for (const review of reviews) {
      let group = groups.find((g) => g.id === review.reviewId);
      if (!group) {
        group = { id: review.reviewId, name: review.name, runs: [] };
        groups.push(group);
      }
      group.runs.push(review);
    }
    return { runs: reviews, reviews: groups, warnings };
  }
  async detail(id) {
    const r = await this.saved(id);
    return {
      ...this.summary(r),
      entries: r.entries.map(({ situation, entryId }, index) => ({
        index,
        entryId,
        situationId: situation.id,
        name: situation.name,
        summary: situation.summary || {},
      })),
    };
  }
  async rerun({ id, entries, name, slots, inputs = "frozen" }) {
    this.guard();
    if (this.current?.active)
      throw Error("End the current review before starting another.");
    if (!["frozen", "library"].includes(inputs))
      throw Error("Choose frozen snapshots or current library Situations.");
    const previous = await this.saved(id);
    const selected =
      entries ?? previous.entries.map((_, index) => ({ fromIndex: index }));
    if (!Array.isArray(selected) || !selected.length || selected.length > 200)
      throw Error("Select 1–200 situations for this review.");
    const seen = new Set();
    for (const entry of selected) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        throw Error("Invalid review queue entry.");
      const from = Object.hasOwn(entry, "fromIndex");
      if (
        from
          ? Object.hasOwn(entry, "situationId") ||
            !Number.isInteger(entry.fromIndex) ||
            entry.fromIndex < 0 ||
            entry.fromIndex >= previous.entries.length
          : typeof entry.situationId !== "string" ||
            !/^[A-Za-z0-9]{1,40}$/.test(entry.situationId)
      )
        throw Error("Invalid review queue entry.");
      const key = from
        ? `saved:${entry.fromIndex}`
        : `library:${entry.situationId}`;
      if (seen.has(key)) throw Error("Select each situation once.");
      seen.add(key);
    }
    return this.start({
      name: name ?? previous.name,
      slots: slots || layoutSlots(previous.layout),
      queue: selected.map((entry) =>
        Object.hasOwn(entry, "fromIndex")
          ? {
              ...(inputs === "frozen"
                ? { from: { reviewId: id, index: entry.fromIndex } }
                : {}),
              id: previous.entries[entry.fromIndex].situation.id,
              entryId: previous.entries[entry.fromIndex].entryId || undefined,
            }
          : { id: entry.situationId },
      ),
      parentRunId: id,
      previous,
      edited:
        entries !== undefined || (name !== undefined && name !== previous.name),
      inputs,
    });
  }
  context() {
    const r = this.current;
    if (!r?.active) return null;
    return {
      id: r.id,
      runId: r.id,
      reviewId: r.reviewId,
      reviewRevision: r.reviewRevision,
      entryId: r.entries[r.index].entryId || `${r.id}:${r.index}`,
      name: r.name,
      index: r.index,
      situationId: r.entries[r.index].situation.id,
    };
  }
  reportContext() {
    const context = this.context();
    return context
      ? {
          ...context,
          root: path.join(this.root, context.id, "reports"),
          prefix: `reviews/${context.id}/reports`,
        }
      : null;
  }
  async persist(r) {
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        const dir = path.join(this.root, r.id);
        await fs.mkdir(dir, { recursive: true });
        const snapshot = JSON.stringify(
          {
            ...r,
            entries: r.entries.map(({ situation, entryId }) => ({
              entryId,
              situation: { ...situation, checkpoint: undefined },
            })),
          },
          null,
          2,
        );
        const temp = path.join(
          dir,
          `.review-${randomBytes(6).toString("hex")}.tmp`,
        );
        await fs.writeFile(temp, snapshot);
        await fs.rename(temp, path.join(dir, "review.json"));
        const e = escapeHTML;
        await fs.writeFile(
          path.join(dir, "index.html"),
          `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(r.name)}</title><style>body{font:16px system-ui;max-width:1000px;margin:24px auto;padding:0 16px}li{margin:12px 0}a{overflow-wrap:anywhere}</style><h1>${e(r.name)}</h1><p>${r.entries.length} situations · ${r.reports.length} reports</p><p><a href="review.json">Review data</a></p><ol>${r.entries
            .map(
              (entry, index) =>
                `<li>${e(entry.situation.name)} ${entry.situation.review_snapshot ? `<a href="situations/${String(index).padStart(3, "0")}.json">Situation snapshot</a>` : ""}<ul>${r.reports
                  .filter((p) => p.index === index)
                  .map(
                    (p) =>
                      `<li><a href="${e(p.url.replace("/reports/reviews/" + r.id + "/", ""))}">${e(p.label || p.kind)}</a></li>`,
                  )
                  .join("")}</ul></li>`,
            )
            .join("")}</ol>`,
        );
      });
    return this.writes;
  }
  plan(situation, config) {
    const resolved = resolveView(
      { ...config, bots: {}, autoSwitch: false },
      situation,
    );
    const [slot] = slotsForSituation([resolved.config], situation);
    return { config: slot, presentation: resolved.intended };
  }
  async start({
    ids,
    name,
    slots,
    queue,
    parentRunId,
    previous,
    edited = false,
    inputs = "frozen",
  }) {
    this.guard();
    if (this.current?.active)
      throw Error("End the current review before starting another.");
    if (queue) ids = queue.map((entry) => entry.id);
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 200 ||
      new Set(ids).size !== ids.length ||
      ids.some(
        (id) => typeof id !== "string" || !/^[A-Za-z0-9]{1,40}$/.test(id),
      )
    )
      throw Error("Select 1–200 different situations.");
    const title = String(
      name || "Review " + new Date().toLocaleString("en-GB"),
    ).trim();
    if (!title || title.length > 100)
      throw Error("Use a review name up to 100 characters.");
    const configs = validateSlots(
      this.comparison.windows.length
        ? this.comparison.windows.map((w) => w.config)
        : slots || [
            {
              source: "live",
              profile: "desktop",
              render: "2d",
              uiMode: "desktop",
              seat: "spectator",
            },
          ],
    );
    const identifier = randomBytes(12).toString("hex");
    const entries = [];
    for (const [index, id] of ids.entries())
      entries.push({
        entryId: queue?.[index]?.entryId || randomBytes(12).toString("hex"),
        situation: await this.comparison.api("/review/snapshot", {
          id,
          ...(queue?.[index]?.from ? { from: queue[index].from } : {}),
          reviewId: identifier,
          index: entries.length,
        }),
      });
    const definition = await this.definitions.prepare({
      previous,
      name: title,
      entries,
      edited,
    });
    entries.forEach(
      (entry, index) => (entry.entryId = definition.entries[index].id),
    );
    const record = {
      schema: 2,
      kind: "review-run",
      reviewId: definition.id,
      reviewRevision: definition.revision,
      parentRunId: parentRunId || null,
      inputs,
      layout: makeLayout(title.slice(0, 80), configs, "none", identifier),
      sources: {
        references: this.comparison.services?.references || null,
        comparator: this.comparison.services?.comparator || null,
        runtime: this.comparison.services?.mode || null,
      },
      id: identifier,
      name: title,
      createdAt: new Date().toISOString(),
      parentRunId: parentRunId || null,
      visited: [],
      active: true,
      index: 0,
      entries,
      reports: [],
    };
    await this.load(record, 0);
    record.layout = makeLayout(
      title.slice(0, 80),
      this.comparison.windows.map((win) => win.config),
      "none",
      identifier,
    );
    record.sources =
      (await this.comparison.services?.provenance?.()) || record.sources;
    await this.definitions.commit(definition);
    this.current = record;
    this.records.set(record.id, record);
    await this.persist(record);
    return this.status();
  }
  async step({ id, index, direction }) {
    this.guard();
    const r = this.current;
    if (!r?.active || id !== r.id)
      throw Error("This review is no longer active.");
    if (index !== r.index)
      throw Error("The review already moved. Wait for the current situation.");
    if (![-1, 1].includes(direction)) throw Error("Choose Previous or Next.");
    const next = r.index + direction;
    if (next < 0 || next >= r.entries.length)
      throw Error("No more situations in that direction.");
    await this.load(r, next);
    r.index = next;
    await this.persist(r);
    return this.status();
  }
  async end() {
    this.guard();
    if (this.current) {
      this.current.active = false;
      this.current.endedAt = new Date().toISOString();
      await this.persist(this.current);
    }
    return this.status();
  }
  deviceBody(body) {
    const r = this.current;
    if (!r?.active) return body;
    const s = r.entries[r.index].situation;
    const plan = this.plan(s, body.slot);
    return {
      ...body,
      situationId: s.id,
      slot: plan.config,
      presentation: plan.presentation,
      reviewId: r.id,
      reviewSnapshot: s.review_snapshot,
      bots: {},
    };
  }
  async load(record, index) {
    const c = this.comparison,
      s = record.entries[index].situation;
    const configs = c.windows.length
      ? c.windows.map((w) => w.config)
      : layoutSlots(record.layout);
    let opened = [],
      devicePlans = [],
      committed = false;
    this.loading = true;
    try {
      const staged = await Promise.allSettled(
        configs.map((config, i) => {
          const p = this.plan(s, config, i);
          return c.open(p.config, p.presentation, null, i, s);
        }),
      );
      opened = staged
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);
      const failed = staged.find((r) => r.status === "rejected");
      if (failed) throw failed.reason;
      devicePlans = await this.devices.prepareReview(
        s,
        (config) => this.plan(s, config),
        record.id,
      );
      this.guard();
      await c.sync.setMode("none");
      this.guard();
      const old = c.windows;
      c.windows = opened;
      c.situationId = s.id;
      c.heroIds = Object.values(s.checkpoint.state.teams).flatMap((t) =>
        t.heroes.map((h) => h.id),
      );
      record.index = index;
      if (!record.visited) record.visited = [];
      if (!record.visited.includes(index)) record.visited.push(index);
      this.current = record;
      this.records.set(record.id, record);
      this.devices.commitReview(devicePlans);
      committed = true;
      await Promise.allSettled(old.map((w) => c.closeWindow(w)));
      await this.devices.retireReview(devicePlans);
    } catch (error) {
      if (!committed) {
        await Promise.allSettled(opened.map((w) => c.closeWindow(w)));
        await this.devices.retireReview(
          devicePlans.map((p) => ({
            ...p,
            oldClone: p.clone,
            oldBots: p.bots,
          })),
        );
      }
      throw error;
    } finally {
      this.loading = false;
    }
  }
  async record(context, report) {
    if (!context) return;
    const r = this.records.get(context.id);
    if (!r) throw Error("Review collection is unavailable.");
    if (!report.url.startsWith(`/reports/reviews/${r.id}/reports/`))
      throw Error("Report is outside its review collection.");
    if (!r.reports.some((p) => p.url === report.url))
      r.reports.push({
        ...report,
        index: context.index,
        situationId: context.situationId,
        entryId:
          context.entryId ||
          r.entries[context.index]?.entryId ||
          `${r.id}:${context.index}`,
        createdAt: new Date().toISOString(),
      });
    await this.persist(r);
  }
}
