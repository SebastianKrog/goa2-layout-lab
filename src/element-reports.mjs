import { presentationEvidence } from "./presentation-model.mjs";
import { reviewAttribution } from "./report.mjs";
import { toPresentation } from "./presentation-model.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { PNG } from "pngjs";
import { DATA, ROOT, BACKEND, TOOL } from "./config.mjs";
import { git } from "./services.mjs";
import {
  inspectPage,
  computedCSS,
  expandMatched,
} from "./source-inspection.mjs";
import { resolveCrop, cropImage } from "./element-crop.mjs";
import { capturePresentation } from "./presentation.mjs";
import { escapeHTML } from "./report.mjs";
import { installElementPicker } from "../public/element-picker.mjs";

function authoredCSS(snapshot) {
  const rules = new Set();
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.selectorList && value.style) {
      const declarations =
        value.style.cssText ||
        (value.style.cssProperties || [])
          .filter((p) => !p.disabled && p.parsedOk !== false)
          .map(
            (p) => `${p.name}: ${p.value}${p.important ? " !important" : ""};`,
          )
          .join("\n  ");
      rules.add(`${value.selectorList.text} {\n  ${declarations}\n}`);
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  }
  for (const element of snapshot.elements)
    visit(expandMatched(element.matched, snapshot.matchedDefinitions));
  return (
    "/* Matched authored rules, including inherited/overridden rules. See styles.json for conditions and cascade metadata. */\n" +
    [...rules].join("\n\n")
  );
}
function reportHTML(report) {
  const e = escapeHTML;
  return `<!doctype html><meta charset="utf-8"><title>Layout lab element report</title><style>body{font:15px system-ui;background:#f6f8fa;color:#15251e;margin:24px}header{max-width:1100px}pre{white-space:pre-wrap;overflow-wrap:anywhere}main{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}article{background:white;border:1px solid #ccd6d0;border-radius:10px;padding:16px;min-width:240px;flex:1;max-width:900px}img{max-width:100%;height:auto;border:1px solid #ddd}a{color:#065eb8}.warning{color:#9b3e00}</style><header><h1>Element report</h1><pre>${e(report.comment)}</pre><p>Captured ${e(report.capturedAt)}. Source situation: ${e(report.situationId)}. Selected view: ${report.selectedIndex + 1}.</p><p><a href="report.json">Report metadata</a>${report.savedSituation ? ` | Saved situation ${e(report.savedSituation.id)}` : ""}</p>${report.diverged ? '<p class="warning">Views contain different game states. Each view has its own checkpoint.</p>' : ""}</header><main>${report.views
    .map(
      (v) =>
        `<article><h2>View ${v.index + 1}: ${e(v.config.label || v.config.source)}</h2><p>${e(v.config.seat)} | ${e(v.config.uiMode)} / ${e(v.config.render)} / ${e(v.config.profile)}</p><pre>${e(JSON.stringify(v.revision, null, 2))}</pre>${v.error ? `<p class="warning">${e(v.error)}</p>` : ""}${(v.warnings || []).map((w) => `<p class="warning">${e(w)}</p>`).join("")}<p>${Object.entries(
          v.files || {},
        )
          .map(([label, file]) => `<a href="${e(file)}">${e(label)}</a>`)
          .join(
            " | ",
          )}</p>${v.files?.image ? `<img src="${e(v.files.image)}" alt="Selected div in view ${v.index + 1}">` : ""}<pre>${e(v.selector || "No equivalent div captured")}</pre></article>`,
    )
    .join("")}</main>`;
}
export class ElementReports {
  constructor(
    comparison,
    {
      root = path.join(DATA, "reports"),
      schedule = (fn) => fn(),
      reportContext = () => null,
      onReport = async () => {},
    } = {},
  ) {
    this.comparison = comparison;
    this.root = root;
    this.reportContext = reportContext;
    this.onReport = onReport;
    this.schedule = schedule;
    this.active = false;
    this.draft = null;
    this.lastReport = null;
  }
  status() {
    const d = this.draft;
    return {
      active: this.active,
      draft: d
        ? {
            id: d.id,
            stage: d.stage,
            progress: d.progress,
            selectedIndex: d.selectedIndex,
            comment: d.comment,
            error: d.error,
            views: (d.views || []).map(({ index, error, selector }) => ({
              index,
              error,
              selector,
            })),
          }
        : null,
      lastReport: this.lastReport,
    };
  }
  async attach(win) {
    await win.page.exposeBinding("__labElementPick", (_, message) => {
      if (!this.active || !this.comparison.windows.includes(win)) return;
      if (message.kind === "cancel") return this.setEnabled(false);
      if (message.kind === "select")
        return this.select(win, message.descriptor);
    });
    await win.page.addInitScript(installElementPicker, this.active);
  }
  async setEnabled(enabled) {
    if (enabled && this.draft)
      throw Error("Finish or discard the current report first.");
    if (enabled && !this.comparison.windows.some((w) => !w.page.isClosed()))
      throw Error("Load a view before reporting.");
    this.active = !!enabled;
    const updates = await Promise.allSettled(
      this.comparison.windows
        .filter((w) => !w.page.isClosed())
        .map((w) =>
          w.page.evaluate(
            (on) => window.__GOA2_ELEMENT_PICKER__?.setActive(on),
            this.active,
          ),
        ),
    );
    if (enabled && updates.some((r) => r.status === "rejected")) {
      await this.setEnabled(false);
      throw Error(
        "Could not activate the picker in every open view. Retry once the views are ready.",
      );
    }
    return this.status();
  }
  async select(win, descriptor) {
    if (!this.active || this.draft) return;
    if (
      !(/^[a-z][a-z0-9-]{0,40}$/.test(descriptor?.tag ?? "")) ||
      typeof descriptor.path !== "string" ||
      descriptor.path.length > 2000 ||
      !Array.isArray(descriptor.selectors) ||
      descriptor.selectors.length > 30 ||
      descriptor.selectors.some((s) => typeof s !== "string" || s.length > 2000)
    )
      throw Error("Invalid element selection.");
    const id = "element-" + randomUUID();
    const draft = (this.draft = {
      id,
      collection: this.reportContext(),
      selectedAt: new Date().toISOString(),
      selectedIndex: this.comparison.windows.indexOf(win),
      descriptor,
      stage: "capturing",
      comment: "",
      views: [],
    });
    const windows = [...this.comparison.windows];
    // Disable every overlay before any screenshots or CSS extraction.
    try {
      await this.setEnabled(false);
      draft.capturePromise = this.schedule(async () => {
        if (!draft.cancelled) await this.capture(draft, windows);
      });
      await draft.capturePromise;
    } catch (error) {
      draft.error = error.message;
    } finally {
      draft.stage = draft.cancelled ? "cancelled" : "ready";
    }
  }
  async capture(draft, windows) {
    draft.root = draft.collection?.root || this.root;
    draft.dir = path.join(draft.root, ".pending-" + draft.id);
    await fs.mkdir(draft.dir, { recursive: true });
    const status = this.comparison.status();
    const revision = (args, cwd) => {
      try {
        return git(args, cwd);
      } catch {
        return null;
      }
    };
    draft.progress = "Collecting source evidence";
    const started = performance.now();
    draft.timings = {};
    draft.sourceEvidence =
      (await this.comparison.services?.provenance?.()) || null;
    draft.timings.provenanceMs = Math.round(performance.now() - started);
    draft.capturedAt = new Date().toISOString();
    draft.situationId = this.comparison.situationId;
    draft.references = {
      base: status.references?.base,
      comparator: status.comparator,
      script: status.script,
      backend: revision(["rev-parse", "HEAD"], BACKEND),
      lab: revision(["rev-parse", "HEAD"], TOOL),
    };
    const live = {
      commit: revision(["rev-parse", "HEAD"], ROOT),
      status: revision(["status", "--porcelain"], ROOT),
      mutable: true,
    };
    const configs = windows.map((w) => structuredClone(w.config));
    const captureView = async (win, index) => {
      const prefix = `view-${index + 1}`;
      const view = {
        index,
        config: configs[index],
        warnings: [
          ...(win.warnings || []),
          ...(win.errors || []),
          ...(win.assets || []),
        ],
        files: {},
        revision:
          win.config.source === "live"
            ? live
            : {
                commit:
                  win.config.source === "comparator"
                    ? status.comparator
                    : status.references?.base,
                ...(win.config.source === "target"
                  ? { userscript: status.script }
                  : {}),
              },
      };
      draft.views[index] = view;
      const save = async (key, suffix, value) => {
        const file = prefix + suffix;
        await fs.writeFile(path.join(draft.dir, file), value);
        view.files[key] = file;
      };
      const viewStarted = performance.now();
      let phaseStart = viewStarted;
      view.timings = {};
      const timed = (name) => { view.timings[name] = Math.round(performance.now() - phaseStart); phaseStart = performance.now(); };
      try {
        if (draft.cancelled) return;
        if (win.page.isClosed())
          throw Error("This view was closed at capture time.");
        const checkpoint = await this.comparison.api(
          `/games/${win.clone.game_id}/checkpoint`,
          undefined,
          "GET",
        );
        view.stateHash = checkpoint.hash;
        view.situation = checkpoint.situation;
        if (win.config.source === "target")
          view.scriptActive = await win.page.evaluate(() =>
            document.documentElement.hasAttribute("data-m2-active"),
          );
        const presentation = await capturePresentation(
          win.page,
          win.config.render,
        );
        view.situation.presentation = toPresentation(
          presentation,
          win.config.seat,
        );
        view.presentationResolution = presentationEvidence(
          win.config,
          win.intendedPresentation,
          presentation,
          win.warnings || [],
        );
        view.situation.provenance = {
          kind: "element-report",
          review: reviewAttribution(draft.collection),
          report: [draft.collection?.prefix, draft.id]
            .filter(Boolean)
            .join("/"),
          source_situation: win.situation?.id || draft.situationId,
          source_slot: index,
          slots: [configs[index]],
          references: draft.references,
        };
        await save(
          "situation",
          ".situation.json",
          checkpoint.checkpoint_json
            ? JSON.stringify({
                ...view.situation,
                checkpoint: undefined,
              }).slice(0, -1) +
                ',"checkpoint":' +
                checkpoint.checkpoint_json +
                "}"
            : JSON.stringify(view.situation),
        );
        await save(
          "presentation",
          ".presentation.json",
          JSON.stringify(presentation),
        );
        timed("checkpointAndPresentationMs");
        draft.progress = `Matching view ${index + 1}`;
        const match = await win.page.evaluate(
          ({ descriptor, source }) =>
            window.__GOA2_ELEMENT_PICKER__.resolve(descriptor, source),
          {
            descriptor: draft.descriptor,
            source: index === draft.selectedIndex,
          },
        );
        if (match.error) throw Error(match.error);
        view.selector = match.selector;
        view.match = match.match;
        const crop = await resolveCrop(win.page, {
          selector: match.selector,
          match: "unique",
        });
        view.crop = crop;
        timed("matchingMs");
        draft.progress = `Capturing image in view ${index + 1}`;
        const bytes = await win.page.screenshot({
          animations: "disabled",
          caret: "hide",
          timeout: 120000,
        });
        const afterCrop = await resolveCrop(win.page, {
          selector: match.selector,
          match: "unique",
        });
        if (JSON.stringify(crop.bounds) !== JSON.stringify(afterCrop.bounds))
          view.warnings.push("The div moved during screenshot capture.");
        const image = PNG.sync.write(
          cropImage(PNG.sync.read(bytes), crop).image,
        );
        await save("image", ".png", image);
        view.imageHash = createHash("sha256").update(image).digest("hex");
        timed("screenshotMs");
        draft.progress = `Extracting styles in view ${index + 1}`;
        const snapshot = await inspectPage(win.page, {
          mode: "element",
          selector: match.selector,
          includeStylesheetText: false,
          maxElements: 1200,
          isCancelled: () => !!draft.cancelled,
        });
        view.warnings.push(...snapshot.warnings);
        snapshot.labWallTime = snapshot.capturedAt;
        snapshot.capturedAt = new Date().toISOString();
        await save(
          "html",
          ".html.txt",
          snapshot.matches.map((m) => m.html).join("\n"),
        );
        await save("computedCSS", ".computed.css", computedCSS(snapshot));
        await save("matchedCSS", ".matched.css", authoredCSS(snapshot));
        // Keep matched conditions/cascade/definitions, not unrelated stylesheet bodies.
        snapshot.stylesheets = snapshot.stylesheets.map(
          ({ text, ...header }) => header,
        );
        await save("styles", ".styles.json", JSON.stringify(snapshot));
        timed("styleExportMs");
        const after = await this.comparison.api(
          `/games/${win.clone.game_id}`,
          undefined,
          "GET",
        );
        if (after.hash !== checkpoint.hash)
          view.warnings.push(
            "The game advanced during capture; screenshot, styles and checkpoint are sampled separately.",
          );
      } catch (error) {
        view.error = error.message;
      } finally {
        view.captureMs = Math.round(performance.now() - viewStarted);
      }
    };
    // Native capture temporarily changes surface placement; keep it serialized.
    if (this.comparison.desktop)
      for (const [i, win] of windows.entries()) await captureView(win, i);
    else await Promise.all(windows.map(captureView));
  }
  setComment(id, comment) {
    if (!this.draft || this.draft.id !== id)
      throw Error("This report draft is no longer active.");
    if (typeof comment !== "string" || comment.length > 10000)
      throw Error("Use a comment of at most 10000 characters.");
    this.draft.comment = comment;
    return this.status();
  }
  async send(id, comment) {
    if (this.lastReport?.id === id) return this.lastReport;
    this.setComment(id, comment);
    if (!comment.trim()) throw Error("Write a comment before sending.");
    const draft = this.draft;
    if (draft.stage !== "ready")
      throw Error("The capture is still being prepared.");
    if (draft.saving) return draft.saving;
    draft.saving = this.finish(draft).catch((error) => {
      draft.saving = null;
      throw error;
    });
    return draft.saving;
  }
  async finish(draft) {
    if (!draft.dir)
      throw Error(
        draft.error || "Capture unavailable. Discard and select again.",
      );
    const primary =
      draft.views[draft.selectedIndex]?.situation ||
      draft.views.find((v) => v.situation)?.situation;
    const report = {
      schema: 1,
      review: reviewAttribution(draft.collection),
      id: draft.id,
      comment: draft.comment.trim(),
      selectedAt: draft.selectedAt,
      capturedAt: draft.capturedAt,
      situationId: draft.situationId,
      selectedIndex: draft.selectedIndex,
      selectedDiv: draft.descriptor,
      selectedElement: draft.descriptor,
      references: draft.references,
      sourceEvidence: draft.sourceEvidence,
      timings: draft.timings,
      captureError: draft.error,
      diverged:
        new Set(draft.views.filter((v) => v.stateHash).map((v) => v.stateHash))
          .size > 1,
      views: draft.views.map(({ situation, ...rest }) => rest),
    };
    if (primary) {
      primary.provenance.comment = report.comment;
      if (!draft.savedSituation)
        draft.savedSituation = await this.comparison.api("/import", {
          name: "Element report: " + report.comment.slice(0, 100),
          content: primary.decisionStateId
            ? { ...primary, checkpoint: undefined }
            : primary,
        });
      report.savedSituation = {
        id: draft.savedSituation.id,
        name: draft.savedSituation.name,
      };
    }
    await fs.writeFile(
      path.join(draft.dir, "report.json"),
      JSON.stringify(report, null, 2),
    );
    await fs.writeFile(path.join(draft.dir, "index.html"), reportHTML(report));
    const sourceDir = path.resolve(draft.dir),
      targetDir = path.resolve(draft.root || this.root, draft.id);
    if (
      path.dirname(sourceDir) !== path.resolve(draft.root || this.root) ||
      path.dirname(targetDir) !== path.resolve(draft.root || this.root) ||
      path.basename(sourceDir) !== ".pending-" + draft.id ||
      !/^element-[a-f0-9-]{36}$/.test(draft.id)
    )
      throw Error("Invalid report directory.");
    await fs.rename(sourceDir, targetDir);
    this.lastReport = {
      id: draft.id,
      url: `/reports/${[draft.collection?.prefix, draft.id].filter(Boolean).join("/")}/index.html`,
      situationId: draft.savedSituation?.id,
    };
    await this.onReport(draft.collection, {
      ...this.lastReport,
      kind: "element",
      label: report.comment.slice(0, 160),
    });
    this.draft = null;
    return this.lastReport;
  }
  async discard(id) {
    if (this.draft?.id !== id)
      throw Error("This report draft is no longer active.");
    if (this.draft.stage === "capturing") {
      const draft = this.draft;
      draft.cancelled = true;
      await draft.capturePromise?.catch(() => {});
    }
    if (this.draft.dir) {
      const target = path.resolve(this.draft.dir);
      if (
        path.dirname(target) !== path.resolve(this.draft.root || this.root) ||
        path.basename(target) !== ".pending-" + id
      )
        throw Error("Invalid draft directory.");
      await fs.rm(target, { recursive: true, force: true });
    }
    this.draft = null;
    return this.status();
  }
}
