import { evidenceTarget } from "./evidence-state.mjs";
import { makeLayout, layoutSlots } from "./layouts.mjs";
import { ReviewDefinitions } from "./review-definitions.mjs";
import {
  reviewEntry,
  inspectionOptions,
  presentationFor,
} from "./inspection.mjs";
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
    {
      root = path.join(DATA, "reports", "reviews"),
      guard = () => {},
      situationMappings = {},
      performedBy = "human",
    } = {},
  ) {
    this.performedBy = performedBy;
    this.situationMappings = situationMappings;
    this.comparison = comparison;
    this.devices = devices;
    this.root = root;
    this.guard = guard;
    this.current = null;
    this.loading = false;
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
          performedBy: r.performedBy || "human",
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
    this.records.set(r.id, r);
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
      performedBy: r.performedBy || "human",
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
  async unlinkReports(urls) {
    const removed = new Set(urls),
      listing = await this.list();
    for (const { id } of listing.runs) {
      const run = await this.saved(id),
        reports = run.reports.filter((report) => !removed.has(report.url));
      if (reports.length !== run.reports.length) {
        run.reports = reports;
        this.records.set(id, run);
        await this.persist(run);
      }
    }
  }
  async manage({ action, id }, state) {
    const listing = await this.list(),
      flags = await state.read();
    let selected;
    if (action === "archive-all")
      selected = listing.reviews.filter(
        (group) =>
          !flags.archivedReviews.includes(group.id) &&
          !group.runs.some((run) => run.status === "active"),
      );
    else if (action === "delete-archive")
      selected = listing.reviews.filter((group) =>
        flags.archivedReviews.includes(group.id),
      );
    else {
      this.validId(id);
      selected = listing.reviews.filter((group) => group.id === id);
      if (!selected.length) throw Error("Review not found.");
    }
    if (
      selected.some((group) =>
        group.runs.some((run) => run.status === "active"),
      )
    )
      throw Error("End the active Review before archiving or deleting it.");
    if (["archive", "archive-all", "restore"].includes(action)) {
      await state.change((value) => {
        const ids = new Set(value.archivedReviews);
        for (const group of selected)
          action === "restore" ? ids.delete(group.id) : ids.add(group.id);
        value.archivedReviews = [...ids];
      });
    } else if (["delete", "delete-archive"].includes(action)) {
      this.guard();
      await this.writes;
      const targets = [];
      for (const group of selected) {
        for (const run of group.runs)
          targets.push({
            path: await evidenceTarget(this.root, run.id),
            runId: run.id,
          });
        try {
          targets.push({
            path: await evidenceTarget(this.definitions.root, group.id),
          });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      for (const target of targets) {
        await fs.rm(target.path, { recursive: true, force: true });
        if (target.runId) {
          this.records.delete(target.runId);
          if (this.current?.id === target.runId) this.current = null;
        }
      }
      const ids = new Set(selected.map((group) => group.id)),
        runs = selected.flatMap((group) => group.runs.map((run) => run.id));
      await state.change((value) => {
        value.archivedReviews = value.archivedReviews.filter(
          (id) => !ids.has(id),
        );
        value.archivedReports = value.archivedReports.filter(
          (id) => !runs.some((run) => id.startsWith("reviews/" + run + "/")),
        );
      });
    } else throw Error("Choose an archive, restore or delete action.");
    return { ok: true, count: selected.length };
  }
  async detail(id) {
    const r = await this.saved(id);
    return {
      ...this.summary(r),
      entries: r.entries.map(({ situation, entryId, ...entry }, index) => ({
        ...inspectionOptions(entry),
        index,
        entryId,
        situationId: situation.id,
        name: situation.name,
        summary: situation.summary || {},
      })),
    };
  }
  async rerun({
    id, entries, name, slots, inputs = "frozen", performedBy = this.performedBy,
  }) {
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
      if (
        seen.has(key) &&
        !entry.presentation &&
        !entry.presentationsByInterface &&
        !entry.viewPresentations
      )
        throw Error(
          "Give repeated Situations distinct Presentation instructions.",
        );
      seen.add(key);
    }
    return this.start({
      name: name ?? previous.name,
      performedBy,
      slots: slots || layoutSlots(previous.layout),
      synchronization: previous.layout.synchronization,
      queue: selected.map((entry) =>
        Object.hasOwn(entry, "fromIndex")
          ? {
              ...(inputs === "frozen"
                ? { from: { reviewId: id, index: entry.fromIndex } }
                : {}),
              id:
                inputs === "library"
                  ? this.situationMappings[
                      previous.entries[entry.fromIndex].situation.id
                    ] || previous.entries[entry.fromIndex].situation.id
                  : previous.entries[entry.fromIndex].situation.id,
              entryId:
                selected.filter((e) => e.fromIndex === entry.fromIndex).length >
                1
                  ? undefined
                  : previous.entries[entry.fromIndex].entryId || undefined,
              ...inspectionOptions(previous.entries[entry.fromIndex]),
              ...inspectionOptions(entry),
            }
          : { id: entry.situationId, ...inspectionOptions(entry) },
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
      performedBy: r.performedBy || "human",
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
            entries: r.entries.map(({ situation, ...entry }) => ({
              ...entry,
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
          `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(r.name)}</title><style>body{font:16px system-ui;max-width:1000px;margin:24px auto;padding:0 16px}li{margin:12px 0}a{overflow-wrap:anywhere}</style><h1>${e(r.name)}</h1>${r.performedBy === "agent" ? "<p><strong>Agentic review</strong></p>" : ""}<p>${r.entries.length} situations · ${r.reports.length} reports</p><p><a href="review.json">Review data</a></p><ol>${r.entries
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
  plan(situation, config, index, entry = {}) {
    const resolved = resolveView(
      { ...config, bots: {}, autoSwitch: false },
      situation,
      presentationFor(entry, config, index),
    );
    const [slot] = slotsForSituation([resolved.config], situation);
    return { config: slot, presentation: resolved.intended };
  }
  async start({
    ids,
    entries: requestedEntries,
    name,
    slots,
    synchronization = this.comparison.sync.mode,
    queue,
    parentRunId,
    previous,
    edited = false,
    inputs = "frozen",
    performedBy = this.performedBy,
  }) {
    this.guard();
    if (this.current?.active)
      throw Error("End the current review before starting another.");
    if (!["human", "agent"].includes(performedBy))
      throw Error("Review performer must be human or agent.");
    if (requestedEntries) {
      if (!Array.isArray(requestedEntries))
        throw Error("Review entries must be a list.");
      queue = requestedEntries.map((entry) => {
        const normalized = reviewEntry(entry);
        return {
          ...normalized,
          id: normalized.situationId,
          entryId: normalized.id,
        };
      });
    }
    if (queue) ids = queue.map((entry) => entry.id);
    if (queue) {
      const keys = queue.map((e) => e.entryId).filter(Boolean);
      if (new Set(keys).size !== keys.length)
        throw Error("Review entry IDs must be unique.");
    }
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 200 ||
      (!queue && new Set(ids).size !== ids.length) ||
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
      slots ||
        (this.comparison.windows.length
          ? this.comparison.windows.map((w) => w.config)
          : [
              {
                source: "live",
                profile: "desktop",
                render: "2d",
                uiMode: "desktop",
                seat: "spectator",
              },
            ]),
    );
    const identifier = randomBytes(12).toString("hex");
    let createdDefinition = null;
    try {
      const entries = [];
      for (const [index, id] of ids.entries())
        entries.push({
          ...reviewEntry({
            situationId: id,
            ...inspectionOptions(queue?.[index] || {}),
            id: queue?.[index]?.entryId,
          }),
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
      entries.forEach((entry, index) => {
        entry.entryId = definition.entries[index].id;
        entry.id = entry.entryId;
      });
      const record = {
        schema: 2,
        kind: "review-run",
        performedBy,
        reviewId: definition.id,
        reviewRevision: definition.revision,
        parentRunId: parentRunId || null,
        inputs,
        layout: makeLayout(
          title.slice(0, 80),
          configs,
          synchronization,
          identifier,
        ),
        sources: {
          references: this.comparison.services?.references || null,
          comparator: this.comparison.services?.comparator || null,
          runtime: this.comparison.services?.mode || null,
        },
        id: identifier,
        name: title,
        createdAt: new Date().toISOString(),
        visited: [],
        active: true,
        index: 0,
        entries,
        reports: [],
      };
      record.sources =
        (await this.comparison.services?.provenance?.()) || record.sources;
      await this.load(record, 0, async (opened) => {
        record.visited = [0];
        if (await this.definitions.commit(definition))
          createdDefinition = definition;
        await this.persist(record);
      });
      return this.status();
    } catch (error) {
      if (createdDefinition)
        await this.definitions.discardNew(createdDefinition);
      // This ID was generated for this attempt; never remove an existing Run.
      const root = path.resolve(this.root);
      const failedRun = path.resolve(root, identifier);
      if (
        path.dirname(failedRun) !== root ||
        !/^[a-f0-9]{24}$/.test(identifier)
      )
        throw new Error("Refusing to remove an invalid Run directory", {
          cause: error,
        });
      await fs.rm(failedRun, { recursive: true, force: true });
      throw error;
    }
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
    const plan = this.plan(s, body.slot, undefined, r.entries[r.index]);
    const presentation = presentationFor(r.entries[r.index], plan.config);
    // The seat is already configured. Pass sparse changes, not resolved defaults.
    delete presentation.viewpoint;
    return {
      ...body,
      situationId: s.id,
      slot: plan.config,
      presentation,
      reviewId: r.id,
      reviewSnapshot: s.review_snapshot,
      bots: {},
    };
  }
  async load(record, index, beforeCommit = null) {
    const c = this.comparison,
      s = record.entries[index].situation;
    const configs = layoutSlots(record.layout);
    let opened = [],
      devicePlans = [],
      committed = false;
    this.loading = true;
    try {
      const staged = await Promise.allSettled(
        configs.map((config, i) => {
          const p = this.plan(s, config, i, record.entries[index]);
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
        (config) => this.plan(s, config, undefined, record.entries[index]),
        record.id,
      );
      const group = `review:${record.id}:${index}`;
      for (const w of opened) w.syncGroup = group;
      const commitSync = await c.sync.prepareMode(
        record.layout.synchronization,
        [
          ...opened,
          ...devicePlans.map((p) => ({
            config: p.config,
            clone: p.clone,
            syncGroup: group,
          })),
        ],
        { bridges: true },
      );
      this.guard();
      if (beforeCommit) await beforeCommit(opened);
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
      for (const p of devicePlans) p.session.syncGroup = group;
      commitSync();
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
