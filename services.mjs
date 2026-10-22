import { LiveAssets } from "./live-assets.mjs";
import fs from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import net from "node:net";
import {
  ROOT,
  TOOL,
  DATA,
  PATCH,
  PORTS,
  REFERENCES,
  linuxPath,
  BACKEND,
  STARTUP,
} from "./config.mjs";
import { selectRuntime } from "./runtime.mjs";

export const git = (args, cwd = ROOT) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
export async function checkoutEvidence(checkout) {
  const run = (args) => git(["-c", "core.bare=false", ...args], checkout);
  const commit = run(["rev-parse", "HEAD"]);
  const status = run(["status", "--porcelain", "--untracked-files=all"]);
  const paths = [
    ...new Set(
      (
        run(["diff", "--name-only", "-z", "HEAD"]) +
        "\0" +
        run(["ls-files", "--others", "--exclude-standard", "-z"])
      )
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
  const digest = createHash("sha256").update(commit);
  const files = [];
  for (const name of paths) {
    const target = path.resolve(checkout, name);
    if (!target.startsWith(path.resolve(checkout) + path.sep))
      throw Error("Source path escapes checkout.");
    let bytes;
    try {
      const stat = await fs.lstat(target);
      bytes = stat.isSymbolicLink()
        ? Buffer.from(await fs.readlink(target))
        : await fs.readFile(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      bytes = null;
    }
    const checksum =
      bytes === null ? null : createHash("sha256").update(bytes).digest("hex");
    files.push({ path: name, sha256: checksum });
    digest
      .update(name)
      .update("\0")
      .update(checksum || "deleted")
      .update("\0");
  }
  return {
    commit,
    dirty: status.length > 0,
    status,
    workingTreeHash: digest.digest("hex"),
    files,
  };
}
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function resolveComparator(ref = "mobile-migration") {
  // A revision argument is data, never shell code or an option.
  if (!/^[\w./~-]+$/.test(ref) || ref.startsWith("-"))
    throw new Error("Invalid comparator revision.");
  return git(["rev-parse", "--verify", `${ref}^{commit}`]);
}
export async function available(port) {
  await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", () =>
      reject(
        new Error(
          `Port ${port} is occupied. Stop its existing owner, or close the other comparison desk.`,
        ),
      ),
    );
    s.listen(port, "127.0.0.1", () => s.close(resolve));
  });
}
export async function waitFor(check, description, timeout = 180_000) {
  const end = Date.now() + timeout;
  let error;
  while (Date.now() < end) {
    try {
      const value = await check();
      if (value) return value;
    } catch (e) {
      if (e.fatal) throw e;
      error = e;
    }
    await delay(350);
  }
  throw new Error(
    `Timed out waiting for ${description}.${error ? ` ${error.message}` : ""}`,
  );
}
function wsl(args, options = {}) {
  const { script = path.join(TOOL, "wsl-service.sh"), ...spawnOptions } =
    options;
  return spawn(
    "wsl.exe",
    [
      "-d",
      process.env.GOA2_LAB_WSL_DISTRO || "Ubuntu",
      "--cd",
      ROOT,
      "--exec",
      "env",
      `GOA2_LAB_TOOL=${linuxPath(TOOL)}`,
      `GOA2_LAB_FRONTEND=${linuxPath(ROOT)}`,
      `GOA2_LAB_BACKEND=${linuxPath(BACKEND)}`,
      `GOA2_LAB_PATCH=${linuxPath(PATCH)}`,
      ...Object.entries(PORTS).map(
        ([key, port]) => `GOA2_LAB_${key.toUpperCase()}_PORT=${port}`,
      ),
      "bash",
      linuxPath(script),
      ...args,
    ],
    {
      cwd: ROOT,
      windowsHide: true,
      ...spawnOptions,
    },
  );
}
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export class Services {
  constructor(token) {
    this.token = token;
    this.children = new Map();
    this.frontends = new Map();
    this.sources = new Map();
    this.closing = false;
    this.references = { ...REFERENCES };
    this.mode = selectRuntime();
    this.liveAssets = new LiveAssets(ROOT);
  }
  servicePath(value) {
    if (this.mode === "wsl" && value.startsWith("/")) return value;
    return this.mode === "wsl" ? linuxPath(value) : value;
  }
  async init() {
    await fs.mkdir(DATA, { recursive: true });
    if (
      !/^[\w./~-]+$/.test(STARTUP.scriptRef) ||
      STARTUP.scriptRef.startsWith("-")
    )
      throw new Error("Invalid userscript revision.");
    this.references = {
      base: resolveComparator(STARTUP.baseRef),
      script: /^[a-f0-9]{40}$/.test(STARTUP.scriptRef)
        ? STARTUP.scriptRef
        : git(
            ["rev-parse", "--verify", `${STARTUP.scriptRef}^{commit}`],
            PATCH,
          ),
    };
    this.comparator = resolveComparator(STARTUP.comparatorRef);
  }
  async source(sha) {
    if (!this.sources.has(sha)) {
      const pending = this.prepareSource(sha).catch((error) => {
        this.sources.delete(sha);
        throw error;
      });
      this.sources.set(sha, pending);
    }
    return this.sources.get(sha);
  }
  async prepareSource(sha) {
    if (!/^[a-f0-9]{40}$/.test(sha))
      throw new Error("An exact commit SHA is required.");
    if (this.mode === "wsl") {
      const job = await this.prepareJob(["prepare-source", sha]);
      const result = JSON.parse(
        await fs.readFile(`${job.pidfile}.result.json`, "utf8"),
      );
      if (typeof result.root !== "string" || !result.root.startsWith("/"))
        throw new Error("Invalid WSL source cache path.");
      return result.root;
    }
    const dest = path.join(
      DATA,
      "cache",
      // Retain the original Windows/WSL cache; native installs get their own
      // platform/architecture directory (including native Linux inside WSL).
      ...(this.mode === "wsl" ? [] : [`${process.platform}-${process.arch}`]),
      sha,
    );
    if (!existsSync(path.join(dest, ".layout-lab-reference.json"))) {
      await fs.mkdir(dest, { recursive: true });
      const archive = path.join(DATA, `archive-${randomUUID()}.tar`);
      try {
        execFileSync("git", ["archive", "--format=tar", "-o", archive, sha], {
          cwd: ROOT,
          windowsHide: true,
        });
        execFileSync(
          process.platform === "win32" ? "tar.exe" : "tar",
          ["-xf", archive, "-C", dest],
          {
            windowsHide: true,
          },
        );
        const manifest = JSON.parse(
          await fs.readFile(
            path.join(dest, "scripts/model-assets.json"),
            "utf8",
          ),
        );
        for (const model of manifest.files) {
          if (
            !/^(public\/models\/heroes\/|model-archive\/heroes\/)[\w/.-]+\.glb$/.test(
              model.path,
            ) ||
            model.path.includes("..")
          )
            throw new Error("Invalid model manifest path.");
          const target = path.join(dest, model.path);
          const current = await fs.readFile(path.join(ROOT, model.path));
          if (sha256(current) !== model.sha256)
            throw new Error(
              `Required model bytes unavailable: ${model.path}. Run npm run models:prepare.`,
            );
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, current);
        }
        await fs.writeFile(
          path.join(dest, ".layout-lab-reference.json"),
          JSON.stringify({ sha }),
        );
      } finally {
        await fs.rm(archive, { force: true });
      }
    }
    await this.prepare(dest);
    return dest;
  }
  async script() {
    const original = execFileSync(
      "git",
      ["show", `${this.references.script}:dist/goa2-mobile-2d.user.js`],
      { cwd: PATCH, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
    );
    const checksum = sha256(original);
    await fs.mkdir(path.join(DATA, "cache"), { recursive: true });
    await fs.writeFile(
      path.join(DATA, "cache", `userscript-${this.references.script}.js`),
      original,
    );
    return {
      content: original.toString("utf8"),
      checksum,
      revision: this.references.script,
    };
  }
  async backend() {
    if (this.children.has("backend")) return;
    await available(PORTS.backend);
    this.backendEvidence = await checkoutEvidence(BACKEND);
    await this.start("backend", ["backend"], true, PORTS.backend);
    await waitFor(async () => {
      const process = this.children.get("backend");
      if (!process || process.exited)
        throw Object.assign(
          new Error("The isolated backend stopped. Check its process log."),
          { fatal: true },
        );
      const response = await fetch(
        `http://127.0.0.1:${PORTS.backend}/__lab/health`,
        {
          headers: { "x-lab-token": this.token },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok) return false;
      return await response.json();
    }, "isolated backend");
  }
  async assetFor(source, pathname) {
    return source === "live" && process.platform === "win32"
      ? this.liveAssets.get(pathname)
      : null;
  }
  async provenance() {
    return {
      backend: this.backendEvidence || null,
      frontend: {
        base: { commit: this.references.base, dirty: false },
        comparator: { commit: this.comparator, dirty: false },
        live: await checkoutEvidence(ROOT),
      },
      userscript: { commit: this.references.script, dirty: false },
      lab: await checkoutEvidence(TOOL),
    };
  }
  async frontend(source) {
    const key = source === "target" ? "base" : source;
    if (!this.frontends.has(key)) {
      const pending = this.startFrontend(source).finally(() =>
        this.frontends.delete(key),
      );
      this.frontends.set(key, pending);
    }
    return this.frontends.get(key);
  }
  async startFrontend(source) {
    const key = source === "target" ? "base" : source;
    if (this.children.has(key) && !this.children.get(key).exited)
      return this.children.get(key).port;
    if (this.children.has(key)) await this.stop(key);
    const port =
      key === "base"
        ? PORTS.base
        : key === "live"
          ? PORTS.live
          : PORTS.comparator;
    // Restart only this desk's existing owner when reusing a service port.
    for (const [other, value] of this.children)
      if (value.port === port) await this.stop(other);
    await available(port);
    const root =
      key === "live"
        ? ROOT
        : await this.source(
            key === "base" ? this.references.base : this.comparator,
          );
    if (key === "live" && !existsSync(path.join(ROOT, "node_modules/vite")))
      await this.prepare(ROOT);
    await this.start(
      key,
      ["serve", this.servicePath(root), String(port)],
      false,
      port,
    );
    await waitFor(
      async () => {
        const p = this.children.get(key);
        if (p?.exited)
          throw Object.assign(
            new Error(`${key} frontend exited ${p.code}. See ${p.pidfile}.log`),
            { fatal: true },
          );
        return (
          await fetch(`http://127.0.0.1:${port}/`, {
            signal: AbortSignal.timeout(5000),
          })
        ).ok;
      },
      `${key} frontend`,
      240_000,
    );
    return port;
  }
  async start(key, args, backend, port) {
    if (this.closing) throw new Error("The comparison desk is shutting down.");
    await fs.mkdir(path.join(DATA, "runtime"), { recursive: true });
    const pidfile = path.join(DATA, "runtime", `${key}-${randomUUID()}.pid`);
    const full = backend
      ? [...args, this.servicePath(pidfile), this.token]
      : [...args, this.servicePath(pidfile)];
    // Bash reads scripts incrementally. Freeze each launched script so editing
    // the tool while a service runs cannot change its shutdown instructions.
    const script = `${pidfile}.sh`;
    if (this.mode === "wsl")
      await fs.copyFile(path.join(TOOL, "wsl-service.sh"), script);
    if (this.closing) throw new Error("The comparison desk is shutting down.");
    const child =
      this.mode === "wsl"
        ? wsl(full, { script, stdio: ["ignore", "pipe", "pipe"] })
        : spawn(
            process.execPath,
            [path.join(TOOL, "service-runner.mjs"), ...full],
            { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
          );
    const log = createWriteStream(`${pidfile}.launcher.log`);
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    const value = { child, pidfile, port, log, exited: false };
    this.children.set(key, value);
    child.once("exit", (code) => {
      value.exited = true;
      value.code = code;
      log.end();
    });
    child.once("error", (error) => {
      value.exited = true;
      value.error = error.message;
    });
    await waitFor(
      async () => {
        if (
          ["prepare", "prepare-source"].includes(args[0]) &&
          existsSync(pidfile)
        )
          return true;
        if (value.exited)
          throw Object.assign(
            new Error(
              `${this.mode} ${key} exited ${value.code}: ${value.error || ""}. See ${pidfile}.log`,
            ),
            { fatal: true },
          );
        return existsSync(pidfile);
      },
      `${key} process registration`,
      30_000,
    );
  }
  async prepare(root) {
    await this.prepareJob(["prepare", this.servicePath(root)]);
  }
  async prepareJob(args) {
    const key = `prepare-${randomUUID()}`;
    try {
      await this.start(key, args, false);
      const process = this.children.get(key);
      await waitFor(
        () => {
          if (!process.exited) return false;
          if (process.code !== 0 || process.error)
            throw Object.assign(
              new Error(`Dependency setup failed. See ${process.pidfile}.log`),
              { fatal: true },
            );
          return true;
        },
        "frontend dependencies",
        600_000,
      );
      return process;
    } finally {
      await this.stop(key);
    }
  }
  async stop(key) {
    const value = this.children.get(key);
    if (!value) return;
    // Registration can still be in flight when Ctrl+C arrives during setup.
    await waitFor(
      () => value.exited || existsSync(value.pidfile),
      `${key} registration`,
      30_000,
    ).catch(() => {});
    const pid = await fs.readFile(value.pidfile, "utf8").catch(() => "");
    if (/^\d+$/.test(pid) && !value.exited) {
      if (this.mode === "native") {
        try {
          process.kill(-Number(pid), "SIGTERM");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      } else {
        const killer = spawn(
          "wsl.exe",
          [
            "-d",
            process.env.GOA2_LAB_WSL_DISTRO || "Ubuntu",
            "--exec",
            "kill",
            "-TERM",
            "--",
            `-${pid}`,
          ],
          { windowsHide: true },
        );
        await new Promise((resolve) => {
          killer.once("exit", resolve);
          killer.once("error", resolve);
        });
      }
      await waitFor(() => value.exited, `${key} shutdown`, 15_000).catch(() =>
        value.child.kill(),
      );
    }
    if (value.port)
      await waitFor(
        async () => {
          await available(value.port);
          return true;
        },
        `${key} port release`,
        30_000,
      );
    this.children.delete(key);
  }
  async close() {
    this.closing = true;
    const errors = [];
    for (const key of [...this.children.keys()].reverse()) {
      try {
        await this.stop(key);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(
        errors,
        "Some comparison services could not stop cleanly.",
      );
  }
  status() {
    return [...this.children].map(([name, p]) => ({
      name,
      port: p.port,
      exited: p.exited,
      log: `${p.pidfile}.log`,
    }));
  }
}
