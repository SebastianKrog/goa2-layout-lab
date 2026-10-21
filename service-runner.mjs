// Runs on the service host (Linux/macOS, including WSL). Node's detached
// process groups work on both POSIX systems without a `setsid` executable.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import path from "node:path";
import { TOOL, DATA, BACKEND, PORTS } from "./config.mjs";
import { dependencyRuntime, reuseDependencies } from "./dependency-cache.mjs";

const [action, ...args] = process.argv.slice(2);
if (action === "install") {
  const [root] = args;
  await reuseDependencies(
    root,
    process.env.GOA2_LAB_SOURCE_CACHE || path.join(DATA, "cache"),
  );
  const lock = await fs.readFile(path.join(root, "package-lock.json"));
  const marker = path.join(root, "node_modules/.cache/layout-lab-dependencies");
  const current = await fs.readFile(marker).catch(() => null);
  const runtimeMarker = path.join(
    root,
    "node_modules/.cache/layout-lab-runtime",
  );
  const installedRuntime = await fs
    .readFile(runtimeMarker, "utf8")
    .catch(() => null);
  if (
    !current?.equals(lock) ||
    (installedRuntime && installedRuntime !== dependencyRuntime)
  ) {
    // npm ci empties node_modules. Detach a borrowed install first so it
    // cannot remove packages belonging to another committed source.
    const modules = path.join(root, "node_modules");
    if ((await fs.lstat(modules).catch(() => null))?.isSymbolicLink())
      await fs.unlink(modules);
    await run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: root });
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.writeFile(marker, lock);
  }
  await fs.writeFile(runtimeMarker, dependencyRuntime);
} else {
  let command, commandArgs, cwd, pidfile;
  const env = { ...process.env };
  if (action === "prepare") {
    const [root, file] = args;
    pidfile = file;
    command = process.execPath;
    commandArgs = [path.join(TOOL, "service-runner.mjs"), "install", root];
    cwd = root;
  } else if (action === "serve") {
    const [root, port, file] = args;
    pidfile = file;
    command = process.execPath;
    commandArgs = [
      path.join(root, "node_modules/vite/bin/vite.js"),
      "--config",
      path.join(TOOL, "vite.lab.mjs"),
    ];
    cwd = root;
    Object.assign(env, {
      GOA2_LAB_SOURCE: root,
      GOA2_LAB_PORT: port,
      GOA2_LAB_TOOL: TOOL,
      GOA2_LAB_BACKEND_PORT: String(PORTS.backend),
    });
  } else if (action === "backend") {
    const [file, token] = args;
    pidfile = file;
    cwd = BACKEND;
    command = "uv";
    commandArgs = [
      "run",
      "--locked",
      "--no-default-groups",
      "python",
      "-m",
      "uvicorn",
      "backend:create_app",
      "--factory",
      "--host",
      "0.0.0.0",
      "--port",
      String(PORTS.backend),
    ];
    Object.assign(env, {
      UV_PROJECT_ENVIRONMENT:
        process.env.GOA2_LAB_VENV ||
        path.join(DATA, "runtime", `venv-${process.platform}-${process.arch}`),
      UV_LINK_MODE: "copy",
      PYTHONPATH: [TOOL, path.join(BACKEND, "src")].join(path.delimiter),
      GOA2_LAB_TOKEN: token,
      GOA2_LAB_DATA: DATA,
      GOA2_PREWARM_WORKERS: "0",
      GOA2_VERIFY_REPLAYS: "0",
    });
    for (const [key, dir] of Object.entries({
      SAVE: "games",
      REPLAY: "replays",
      LOG: "logs",
      BUG_REPORT: "reports",
      SHARE: "shares",
    }))
      env[`GOA2_${key}_DIR`] = path.join(DATA, "runtime", dir);
  } else throw new Error(`Unknown lab service: ${action}`);
  const log = openSync(`${pidfile}.log`, "a");
  const child = spawn(command, commandArgs, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal ? 0 : (code ?? 1)));
  });
  const terminate = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  };
  process.on("SIGINT", terminate);
  process.on("SIGTERM", terminate);
  if (child.pid) await fs.writeFile(pidfile, String(child.pid));
  process.exitCode = await completion;
}

async function run(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: "inherit" });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}
