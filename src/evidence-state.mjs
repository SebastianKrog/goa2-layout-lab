import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
export class EvidenceState {
  constructor(file) {
    this.file = file;
    this.currentSession = null;
  }
  async read() {
    try {
      const value = JSON.parse(await fs.readFile(this.file, "utf8"));
      return {
        archivedReports: [],
        archivedReviews: [],
        sessions: [],
        ...value,
      };
    } catch (error) {
      if (error.code === "ENOENT")
        return { archivedReports: [], archivedReviews: [], sessions: [] };
      throw error;
    }
  }
  async change(edit) {
    const value = await this.read();
    edit(value);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = this.file + "." + randomBytes(6).toString("hex") + ".tmp";
    try {
      await fs.writeFile(temporary, JSON.stringify(value, null, 2));
      await fs.rename(temporary, this.file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return value;
  }
  async startSession(name = "Lab session") {
    const session = {
      id: randomBytes(12).toString("hex"),
      name: String(name).trim().slice(0, 100) || "Lab session",
      startedAt: new Date().toISOString(),
    };
    await this.change((value) => value.sessions.push(session));
    this.currentSession = session;
    return session;
  }
}
export async function evidenceTarget(root, relative) {
  if (
    typeof relative !== "string" ||
    !relative ||
    relative
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          !/^[a-zA-Z0-9_.-]+$/.test(part),
      )
  )
    throw Error("Invalid evidence path.");
  const base = await fs.realpath(root);
  let target = base;
  for (const part of relative.split("/")) {
    target = path.join(target, part);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw Error("Evidence path must be an ordinary folder.");
  }
  const actual = await fs.realpath(target),
    inside = path.relative(base, actual);
  if (!inside || inside.startsWith(".." + path.sep) || path.isAbsolute(inside))
    throw Error("Evidence path escapes its collection.");
  return actual;
}
