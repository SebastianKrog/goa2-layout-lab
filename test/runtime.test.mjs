import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { selectRuntime } from "../runtime.mjs";
import { Services, available, waitFor } from "../services.mjs";
import { DATA } from "../config.mjs";
import { launchSettings, REFERENCES } from "../config.mjs";
import { TOOL } from "../config.mjs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

test("env-file loading preserves shell values and CLI overrides", async () => {
  await fs.mkdir(path.join(DATA, "runtime"), { recursive: true });
  const root = await fs.mkdtemp(
    path.join(DATA, "runtime", "launcher with spaces-"),
  );
  try {
    const file = path.join(root, "settings.env"),
      script = path.join(root, "check.mjs");
    await fs.writeFile(
      file,
      "GOA2_LAB_BASE_REF=file-base\nGOA2_LAB_SCRIPT_REF=file-script\nGOA2_LAB_PRESET=desktop-2d\n",
    );
    await fs.writeFile(
      script,
      `import { STARTUP } from ${JSON.stringify(pathToFileURL(path.join(TOOL, "config.mjs")).href)}; console.log(JSON.stringify(STARTUP));`,
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("GOA2_LAB_"),
      ),
    );
    env.GOA2_LAB_BASE_REF = "shell-base";
    const run = (args) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [script, `--env-file=${file}`, ...args],
          { env, encoding: "utf8", windowsHide: true },
        ),
      );
    assert.equal(run([]).baseRef, "shell-base");
    assert.equal(run([]).scriptRef, "file-script");
    assert.equal(run(["--base-ref=cli-base"]).baseRef, "cli-base");
    assert.equal(run([]).preset, "Layout regression");
  } finally {
    assert.ok(root.startsWith(path.join(DATA, "runtime") + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("launcher configuration prefers CLI refs, validates ports and names startup presets", () => {
  const settings = launchSettings(
    ["--base-ref=abc123", "--preset=desktop-3d"],
    {
      GOA2_LAB_BASE_REF: "from-env",
      GOA2_LAB_SCRIPT_REF: "script-tag",
      GOA2_LAB_DESK_PORT: "3300",
    },
  );
  assert.equal(settings.baseRef, "abc123");
  assert.equal(settings.scriptRef, "script-tag");
  assert.equal(settings.preset, "3D regression");
  assert.equal(settings.ports.desk, 3300);
  assert.equal(launchSettings([], {}).baseRef, REFERENCES.base);
  assert.throws(
    () => launchSettings([], { GOA2_LAB_DESK_PORT: "wat" }),
    /Invalid desk port/,
  );
  assert.throws(
    () => launchSettings([], { GOA2_LAB_DESK_PORT: "3100" }),
    /must be different/,
  );
});

test("Linux/macOS/WSL use native services by default; Windows retains WSL", () => {
  for (const platform of ["linux", "darwin"]) {
    assert.equal(selectRuntime(platform, [], {}), "native");
    assert.equal(selectRuntime(platform, ["--runtime=wsl"], {}), "wsl");
  }
  assert.equal(selectRuntime("win32", [], {}), "wsl");
  assert.equal(selectRuntime("linux", [], { GOA2_LAB_RUNTIME: "wsl" }), "wsl");
  assert.equal(
    selectRuntime("linux", ["--runtime=native"], { GOA2_LAB_RUNTIME: "wsl" }),
    "native",
  );
  assert.throws(
    () => selectRuntime("win32", ["--runtime=native"], {}),
    /Linux or macOS/,
  );
  assert.throws(
    () => selectRuntime("linux", ["--runtime=typo"], {}),
    /Runtime/,
  );
});

test(
  "native service shutdown releases its own process group and preserves an unrelated listener",
  {
    skip: process.platform === "win32",
    timeout: 40_000,
  },
  async () => {
    await fs.mkdir(path.join(DATA, "runtime"), { recursive: true });
    const root = await fs.mkdtemp(
      path.join(DATA, "runtime", "native-service-test-"),
    );
    const bin = path.join(root, "node_modules/vite/bin");
    await fs.mkdir(bin, { recursive: true });
    await fs.writeFile(
      path.join(bin, "vite.js"),
      `
    const net = require('node:net');
    net.createServer().listen(Number(process.env.GOA2_LAB_PORT), '127.0.0.1');
  `,
    );
    const unrelated = net.createServer();
    const reserve = net.createServer();
    await new Promise((resolve) => unrelated.listen(0, "127.0.0.1", resolve));
    await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
    const port = reserve.address().port;
    await new Promise((resolve) => reserve.close(resolve));
    const services = new Services("test");
    try {
      await services.start(
        "fixture",
        ["serve", root, String(port)],
        false,
        port,
      );
      await waitFor(
        async () => {
          try {
            await available(port);
            return false;
          } catch {
            return true;
          }
        },
        "native fixture listener",
        10_000,
      );
      await services.close();
      await available(port);
      assert.equal(unrelated.listening, true);
    } finally {
      await services.close();
      await new Promise((resolve) => unrelated.close(resolve));
      // mkdtemp created this exact path beneath the lab runtime directory.
      assert.ok(root.startsWith(path.join(DATA, "runtime") + path.sep));
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
