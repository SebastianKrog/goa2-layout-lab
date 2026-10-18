import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { TOOL, PORTS, STARTUP } from "./config.mjs";
import { selectRuntime } from "./runtime.mjs";

if (process.argv.includes("--help")) {
  console.log(`Layout lab â€” local comparison workspace

npm run compare [-- options]
  --env-file=.env.layout-lab  Load local launcher settings
  --base-ref=<commit>        Frozen base frontend
  --script-ref=<commit>      Frozen userscript target
  --comparator-ref=<ref>     Current build (default: mobile-migration)
  --preset=mobile|desktop-2d|desktop-3d
  --runtime=native|wsl       Defaults to native on Linux/macOS, WSL on Windows
  --display=embedded|browser|windows  Native desktop views by default
  --headless --no-open       Run without desktop windows
  --situation=<id>           Load this saved situation at startup (default: empty)
  --no-auto-load             Keep empty even if --situation was supplied
  --stop                     Stop the running desk

See layout-lab.env.example for environment variables.
CLI reference/preset options take precedence over environment values.`);
  process.exit(0);
}

// Linux, macOS and WSL run entirely locally by default. WSL callers can
// explicitly retain Windows browser windows with --runtime=wsl.
if (process.platform !== "win32" && selectRuntime() === "wsl") {
  const converted = spawnSync(
    "wslpath",
    ["-w", path.join(TOOL, "launch.mjs")],
    { encoding: "utf8" },
  );
  if (converted.status !== 0)
    throw new Error(
      "--runtime=wsl requires WSL. Omit it for native Linux/macOS.",
    );
  const result = spawnSync(
    process.env.GOA2_LAB_WINDOWS_NODE || "node.exe",
    [converted.stdout.trim(), ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  if (result.error)
    throw new Error(
      "Cannot find Windows node.exe. Set GOA2_LAB_WINDOWS_NODE to its WSL path, or omit --runtime=wsl.",
    );
  process.exit(result.status ?? 1);
}
selectRuntime();
if (process.argv.includes("--stop")) {
  const response = await fetch(`http://127.0.0.1:${PORTS.desk}/api/shutdown`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(await response.text());
  process.exit(0);
}
const lock = createHash("sha256")
  .update(readFileSync(path.join(TOOL, "package-lock.json")))
  .digest("hex");
const marker = path.join(TOOL, ".layout-lab-dependencies");
if (
  !existsSync(path.join(TOOL, "node_modules/playwright")) ||
  !existsSync(marker) ||
  readFileSync(marker, "utf8") !== lock
) {
  console.log("Installing isolated layout-lab dev dependencies...");
  const npm =
    process.platform === "win32"
      ? path.join(
          path.dirname(process.execPath),
          "node_modules/npm/bin/npm-cli.js",
        )
      : "npm";
  const result = spawnSync(
    process.platform === "win32" ? process.execPath : npm,
    [...(process.platform === "win32" ? [npm] : []), "ci", "--prefix", TOOL],
    {
      stdio: "inherit",
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
  writeFileSync(marker, lock);
}
if (STARTUP.display !== "embedded" || process.argv.includes("--headless")) {
  const { chromium } = await import("playwright");
  if (!existsSync(chromium.executablePath())) {
    console.log("Installing the comparison browser for this platform...");
    const result = spawnSync(
      process.execPath,
      [
        path.join(TOOL, "node_modules/playwright/cli.js"),
        "install",
        "chromium",
      ],
      { stdio: "inherit" },
    );
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
const { startDesk } = await import("./desk.mjs");
await startDesk();
