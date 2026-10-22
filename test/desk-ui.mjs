// Retained CLI entry point; the UI suite owns its API fixtures and never changes user games.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const result = spawnSync(
  process.execPath,
  [
    "--test",
    fileURLToPath(new URL("./desk-interface.test.mjs", import.meta.url)),
  ],
  { stdio: "inherit", windowsHide: true },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
