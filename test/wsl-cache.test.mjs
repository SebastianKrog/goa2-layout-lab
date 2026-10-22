import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DATA } from "../src/config.mjs";
import { Services } from "../src/services.mjs";
import {
  backendSnapshot,
  frontendSnapshot,
  wslCacheRoot,
} from "../src/wsl-cache.mjs";

const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
async function fixture(run) {
  const root = await fs.mkdtemp(path.join(DATA, "wsl-cache-test-"));
  try {
    const checkout = path.join(root, "checkout"),
      cache = path.join(root, "cache");
    await fs.mkdir(checkout);
    git(checkout, "init", "-q");
    await run(checkout, cache);
  } finally {
    assert.ok(root.startsWith(DATA + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("WSL cache is scoped to its checkout; Windows delegates preparation and preserves Linux paths", async () => {
  assert.equal(
    wslCacheRoot("/tool", "/home/user"),
    wslCacheRoot("/tool", "/home/user"),
  );
  assert.notEqual(
    wslCacheRoot("/tool", "/home/user"),
    wslCacheRoot("/other-tool", "/home/user"),
  );
  const services = new Services("test");
  services.mode = "wsl";
  const pidfile = path.join(DATA, `wsl-result-${process.pid}`);
  try {
    services.prepareJob = async (args) => {
      assert.deepEqual(args, ["prepare-source", "a".repeat(40)]);
      await fs.writeFile(
        `${pidfile}.result.json`,
        JSON.stringify({ root: "/home/user/.cache/source" }),
      );
      return { pidfile };
    };
    assert.equal(
      await services.prepareSource("a".repeat(40)),
      "/home/user/.cache/source",
    );
    assert.equal(
      services.servicePath("/home/user/.cache/source"),
      "/home/user/.cache/source",
    );
    await assert.rejects(
      () => services.prepareSource("--option"),
      /exact commit SHA/,
    );
  } finally {
    await fs.rm(`${pidfile}.result.json`, { force: true });
  }
});

test("backend snapshots reuse identical bytes and pick up edits, untracked source and deletions", async () =>
  fixture(async (checkout, cache) => {
    await fs.mkdir(path.join(checkout, "src/goa2"), { recursive: true });
    await fs.writeFile(path.join(checkout, "src/goa2/engine.py"), "initial");
    await fs.writeFile(path.join(checkout, "pyproject.toml"), "project");
    await fs.writeFile(path.join(checkout, "uv.lock"), "lock");
    await fs.writeFile(path.join(checkout, ".gitignore"), "__pycache__/\n");
    git(checkout, "add", ".");
    const first = await backendSnapshot(cache, checkout);
    assert.equal(
      await fs.readFile(path.join(first, "src/goa2/engine.py"), "utf8"),
      "initial",
    );
    assert.equal(await backendSnapshot(cache, checkout), first);
    await fs.writeFile(path.join(checkout, "src/goa2/engine.py"), "edited");
    const second = await backendSnapshot(cache, checkout);
    assert.notEqual(second, first);
    assert.equal(
      await fs.readFile(path.join(first, "src/goa2/engine.py"), "utf8"),
      "initial",
    );
    await fs.writeFile(path.join(checkout, "src/goa2/new.py"), "untracked");
    const third = await backendSnapshot(cache, checkout);
    assert.notEqual(third, second);
    assert.equal(
      await fs.readFile(path.join(third, "src/goa2/new.py"), "utf8"),
      "untracked",
    );
    await fs.mkdir(path.join(checkout, "src/goa2/__pycache__"));
    await fs.writeFile(
      path.join(checkout, "src/goa2/__pycache__/noise.pyc"),
      "ignored",
    );
    assert.equal(await backendSnapshot(cache, checkout), third);
    await fs.unlink(path.join(checkout, "src/goa2/engine.py"));
    const fourth = await backendSnapshot(cache, checkout);
    assert.notEqual(fourth, third);
    await assert.rejects(fs.stat(path.join(fourth, "src/goa2/engine.py")), {
      code: "ENOENT",
    });
  }));

test("frontend extraction verifies models before publishing a complete reusable snapshot", async () =>
  fixture(async (checkout, cache) => {
    const model = "public/models/heroes/example.glb";
    await fs.mkdir(path.join(checkout, "public/models/heroes"), {
      recursive: true,
    });
    await fs.mkdir(path.join(checkout, "scripts"));
    const bytes = Buffer.from("real model bytes");
    await fs.writeFile(path.join(checkout, model), "LFS pointer");
    await fs.writeFile(
      path.join(checkout, "scripts/model-assets.json"),
      JSON.stringify({
        files: [
          {
            path: model,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        ],
      }),
    );
    git(checkout, "add", ".");
    git(
      checkout,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "fixture",
    );
    const sha = git(checkout, "rev-parse", "HEAD");
    await assert.rejects(
      () => frontendSnapshot(sha, cache, checkout),
      /Required model bytes unavailable/,
    );
    await assert.rejects(fs.stat(path.join(cache, "sources", sha)), {
      code: "ENOENT",
    });
    await fs.writeFile(path.join(checkout, model), bytes);
    const root = await frontendSnapshot(sha, cache, checkout);
    assert.deepEqual(await fs.readFile(path.join(root, model)), bytes);
    assert.equal(await frontendSnapshot(sha, cache, checkout), root);
    assert.deepEqual(
      (await fs.readdir(path.join(cache, "sources"))).filter((name) =>
        name.startsWith(".extract-"),
      ),
      [],
    );
  }));
