import { EvidenceState, evidenceTarget } from "./evidence-state.mjs";
// Read completed evidence only. Never traverse checkpoints or parse large CSS exports.
import fs from "node:fs/promises";
import path from "node:path";
const kinds = {
  device: "Device report",
  element: "Element report",
  capture: "Capture",
  "html-css": "HTML & CSS",
};
export class Reports {
  constructor(root, state = new EvidenceState(path.join(root, "_state.json"))) {
    this.state = state;
    this.root = path.resolve(root);
    this.cache = new Map();
  }
  async manage({ action, id }, runs, reviewManager) {
    const { reports } = await this.list(runs);
    let selected =
      action === "archive-all"
        ? reports.filter((report) => !report.archived)
        : action === "delete-archive"
          ? reports.filter((report) => report.archived)
          : reports.filter((report) => report.id === id);
    if (!selected.length && !["archive-all", "delete-archive"].includes(action))
      throw Error("Report not found.");
    if (["archive", "archive-all", "restore"].includes(action)) {
      await this.state.change((value) => {
        const ids = new Set(value.archivedReports);
        for (const report of selected)
          action === "restore" ? ids.delete(report.id) : ids.add(report.id);
        value.archivedReports = [...ids];
      });
    } else if (["delete", "delete-archive"].includes(action)) {
      const targets = await Promise.all(
        selected.map((report) => evidenceTarget(this.root, report.id)),
      );
      const removed = [];
      try {
        for (let i = 0; i < targets.length; i++) {
          await fs.rm(targets[i], { recursive: true, force: true });
          removed.push(selected[i]);
        }
      } finally {
        if (removed.length) {
          await reviewManager?.unlinkReports(
            removed.map((report) => report.url),
          );
          const ids = new Set(removed.map((report) => report.id));
          await this.state.change(
            (value) =>
              (value.archivedReports = value.archivedReports.filter(
                (id) => !ids.has(id),
              )),
          );
        }
      }
    } else throw Error("Choose an archive, restore or delete action.");
    return { ok: true, count: selected.length };
  }
  async list(runs = []) {
    const flags = await this.state.read();
    const links = new Map();
    for (const run of runs)
      for (const report of run.reports || [])
        links.set(report.url, {
          ...report,
          review: {
            id: run.id,
            name: run.name,
            createdAt: run.createdAt,
            url: `/reports/reviews/${run.id}/index.html`,
          },
          situationName: run.entries?.[report.index]?.situation?.name,
        });
    const reports = [],
      warnings = [],
      present = new Set();
    const scan = async (directory, depth = 0) => {
      if (depth > 8) return;
      let files;
      try {
        files = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error.code !== "ENOENT")
          warnings.push("Some report folders could not be read.");
        return;
      }
      const metadata =
        files.find((file) => file.isFile() && file.name === "report.json") ||
        files.find((file) => file.isFile() && file.name === "comparison.json");
      if (
        metadata &&
        files.some((file) => file.isFile() && file.name === "index.html")
      ) {
        const filename = path.join(directory, metadata.name),
          relative = path
            .relative(this.root, directory)
            .split(path.sep)
            .join("/");
        const url =
          "/reports/" +
          relative.split("/").map(encodeURIComponent).join("/") +
          "/index.html";
        const linked = links.get(url);
        present.add(filename);
        try {
          const stat = await fs.stat(filename),
            stamp = `${stat.mtimeMs}:${stat.size}:${stat.ctimeMs}`;
          let cached = this.cache.get(filename);
          if (!cached || cached.stamp !== stamp) {
            let value = {};
            // Older large exports remain openable; their review index supplies labels.
            if (
              files.some(
                (file) => file.isFile() && file.name === "_report-index.json",
              ) ||
              stat.size <=
                (metadata.name === "comparison.json"
                  ? 256 * 1024
                  : 8 * 1024 * 1024)
            )
              value = JSON.parse(
                await fs.readFile(
                  files.some(
                    (file) =>
                      file.isFile() && file.name === "_report-index.json",
                  )
                    ? path.join(directory, "_report-index.json")
                    : filename,
                  "utf8",
                ),
              );
            const kind =
              metadata.name === "comparison.json"
                ? "html-css"
                : relative.split("/").includes("device")
                  ? "device"
                  : path.basename(directory).startsWith("element-")
                    ? "element"
                    : "capture";
            const rawDate =
              value.capturedAt || value.captured_at || value.createdAt;
            const time =
              typeof rawDate === "number"
                ? rawDate < 1e12
                  ? rawDate * 1000
                  : rawDate
                : Date.parse(rawDate);
            const createdAt = Number.isFinite(time)
              ? new Date(time).toISOString()
              : stat.mtime.toISOString();
            const sourceViews =
              value.views ||
              value.captures ||
              value.windows ||
              (kind === "device"
                ? (
                    value.provenance?.slots || [{ index: 0, source: "device" }]
                  ).map((config, index) => ({ index, config }))
                : []);
            const views = sourceViews.map((view) => ({
              index: view.index,
              label: view.config?.label || view.config?.source || view.source,
              revision:
                typeof view.revision === "string"
                  ? view.revision
                  : view.revision?.commit || view.revision?.sha || view.sha,
            }));
            cached = {
              stamp,
              data: {
                id: relative,
                kind,
                url,
                title:
                  value.comment?.split(/\r?\n/)[0]?.slice(0, 180) ||
                  kinds[kind],
                comment: value.comment || "",
                createdAt,
                session: value.session || value.provenance?.session || null,
                situationId:
                  value.situationId || value.provenance?.source_situation,
                situationName:
                  value.windows?.find((win) => win.situationName)
                    ?.situationName || "",
                views: [
                  ...new Map(views.map((view) => [view.index, view])).values(),
                ],
              },
            };
            this.cache.set(filename, cached);
          }
          const session =
            flags.sessions.find(
              (session) => session.id === cached.data.session?.id,
            ) || cached.data.session;
          const context = linked
            ? {
                kind: "review",
                id: linked.review.id,
                name: linked.review.name,
                startedAt: linked.review.createdAt,
              }
            : session
              ? { kind: "session", ...session }
              : {
                  kind: "date",
                  id: cached.data.createdAt.slice(0, 10),
                  name: "Earlier reports",
                  startedAt: cached.data.createdAt.slice(0, 10) + "T00:00:00Z",
                };
          reports.push({
            ...cached.data,
            archived: flags.archivedReports.includes(relative),
            context,
            ...(linked
              ? {
                  review: linked.review,
                  situationName:
                    linked.situationName || cached.data.situationName,
                  situationId: linked.situationId || cached.data.situationId,
                  title: cached.data.comment
                    ? cached.data.title
                    : linked.label || cached.data.title,
                }
              : {}),
          });
        } catch {
          warnings.push(`Could not read report ${relative}.`);
        }
      }
      for (const file of files)
        if (
          file.isDirectory() &&
          !file.name.startsWith(".") &&
          !["situations", "snapshots"].includes(file.name)
        )
          await scan(path.join(directory, file.name), depth + 1);
    };
    await scan(this.root);
    for (const filename of this.cache.keys())
      if (!present.has(filename)) this.cache.delete(filename);
    reports.sort(
      (a, b) =>
        (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) ||
        a.id.localeCompare(b.id),
    );
    return { reports, warnings: [...new Set(warnings)] };
  }
}

export async function writeReportSummary(directory, value) {
  const views = (value.views || value.captures || value.windows || []).map(
    (view) => ({
      index: view.index,
      source: view.source,
      config: view.config
        ? { source: view.config.source, label: view.config.label }
        : undefined,
      revision: view.revision,
    }),
  );
  await fs.writeFile(
    path.join(directory, "_report-index.json"),
    JSON.stringify({
      id: value.id,
      comment: value.comment,
      capturedAt: value.capturedAt,
      session: value.session,
      situationId: value.situationId,
      views,
    }),
  );
}
