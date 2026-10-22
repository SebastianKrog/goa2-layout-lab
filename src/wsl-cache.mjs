// WSL adapter only. Native services keep their repository-local caches.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { TOOL, ROOT, BACKEND } from "./config.mjs";

const exec = promisify(execFile);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function wslCacheRoot(tool = TOOL, home = os.homedir()) {
  // Scope by checkout so independent labs cannot replace one another's files.
  return path.join(
    home,
    ".cache",
    "goa2-layout-lab",
    hash(tool).slice(0, 16),
    `${process.platform}-${process.arch}`,
  );
}

export async function frontendSnapshot(sha, cache, checkout = ROOT) {
  if (!/^[a-f0-9]{40}$/.test(sha))
    throw Error("An exact commit SHA is required.");
  const root = path.join(cache, "sources", sha);
  const marker = path.join(root, ".layout-lab-reference.json");
  if (await fs.stat(marker).catch(() => null)) return root;
  await fs.mkdir(path.join(cache, "sources"), { recursive: true });
  const stage = await fs.mkdtemp(path.join(cache, "sources", ".extract-"));
  const archive = path.join(stage, "source.tar");
  try {
    await exec("git", ["archive", "--format=tar", "-o", archive, sha], {
      cwd: checkout,
    });
    await exec("tar", ["-xf", archive, "-C", stage]);
    await fs.unlink(archive);
    const manifest = JSON.parse(
      await fs.readFile(path.join(stage, "scripts/model-assets.json"), "utf8"),
    );
    for (const model of manifest.files) {
      if (
        !/^(public\/models\/heroes\/|model-archive\/heroes\/)[\w/.-]+\.glb$/.test(
          model.path,
        ) ||
        model.path.includes("..")
      )
        throw Error("Invalid model manifest path.");
      const bytes = await fs.readFile(path.join(checkout, model.path));
      if (hash(bytes) !== model.sha256)
        throw Error(
          `Required model bytes unavailable: ${model.path}. Run npm run models:prepare.`,
        );
      const target = path.join(stage, model.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
    }
    await fs.writeFile(
      path.join(stage, ".layout-lab-reference.json"),
      JSON.stringify({ sha }),
    );
    // Publish only complete snapshots. A concurrent desk may win the rename.
    await fs.rename(stage, root).catch(async (error) => {
      if (!(await fs.stat(marker).catch(() => null))) throw error;
    });
    return root;
  } finally {
    await removeStage(stage, path.join(cache, "sources"));
  }
}

export async function backendSnapshot(cache, checkout = BACKEND) {
  const { stdout } = await exec(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "src",
    ],
    { cwd: checkout, maxBuffer: 16 * 1024 * 1024 },
  );
  const names = [
    ...new Set([
      "pyproject.toml",
      "uv.lock",
      "README.md",
      ".env",
      ...stdout.split("\0").filter(Boolean),
    ]),
  ].sort();
  const files = [];
  const digest = createHash("sha256");
  for (const name of names) {
    if (name.split("/").includes("..") || path.isAbsolute(name))
      throw Error("Invalid backend source path.");
    const bytes = await fs
      .readFile(path.join(checkout, name))
      .catch((error) => {
        if (error.code === "ENOENT") return null; // Deleted working-tree files.
        throw error;
      });
    if (bytes === null) continue;
    digest.update(name).update("\0").update(hash(bytes)).update("\0");
    files.push([name, bytes]);
  }
  const id = digest.digest("hex");
  const root = path.join(cache, "backend", id);
  if (await fs.stat(path.join(root, ".complete")).catch(() => null))
    return root;
  await fs.mkdir(path.join(cache, "backend"), { recursive: true });
  const stage = await fs.mkdtemp(path.join(cache, "backend", ".snapshot-"));
  try {
    for (const [name, bytes] of files) {
      const target = path.join(stage, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
    }
    await fs.writeFile(path.join(stage, ".complete"), id);
    await fs.rename(stage, root).catch(async (error) => {
      if (!(await fs.stat(path.join(root, ".complete")).catch(() => null)))
        throw error;
    });
    return root;
  } finally {
    await removeStage(stage, path.join(cache, "backend"));
  }
}

async function removeStage(stage, parent) {
  if (!path.resolve(stage).startsWith(path.resolve(parent) + path.sep))
    throw Error("Unsafe cache cleanup path.");
  await fs.rm(stage, { recursive: true, force: true });
}

async function run(args, env) {
  const child = spawn(
    process.execPath,
    [path.join(TOOL, "src/service-runner.mjs"), ...args],
    { env, stdio: "inherit" },
  );
  // The service runner owns its detached process group and forwards shutdown.
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal ? 0 : (code ?? 1)));
  });
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  const cache = wslCacheRoot();
  await fs.mkdir(cache, { recursive: true, mode: 0o700 });
  const env = {
    ...process.env,
    GOA2_LAB_SOURCE_CACHE: path.join(cache, "sources"),
  };
  console.log(`WSL service cache: ${cache}`);
  if (action === "prepare-source") {
    const [sha, pidfile] = args;
    // Register before extraction, which can exceed the launcher's 30s budget.
    await fs.writeFile(pidfile, String(process.pid));
    const root = await frontendSnapshot(sha, cache);
    const code = await run(["install", root], env);
    if (code) throw Error(`Frontend dependencies exited ${code}`);
    await fs.writeFile(`${pidfile}.result.json`, JSON.stringify({ root }));
  } else if (action === "backend") {
    // Register the adapter while hashing/copying. The runner replaces this with
    // its owned process-group PID before Uvicorn starts accepting requests.
    const [pidfile] = args;
    await fs.writeFile(pidfile, String(process.pid));
    const root = await backendSnapshot(cache);
    Object.assign(env, {
      GOA2_LAB_BACKEND: root,
      GOA2_LAB_BACKEND_CHECKOUT: BACKEND,
      GOA2_LAB_VENV: path.join(cache, "venv"),
      PYTHONPYCACHEPREFIX: path.join(cache, "pycache"),
    });
    process.exitCode = await run([action, ...args], env);
  } else process.exitCode = await run([action, ...args], env);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await main();
