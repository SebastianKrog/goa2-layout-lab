import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA } from "../src/config.mjs";
import {
  dependencyRuntime,
  reuseDependencies,
} from "../src/dependency-cache.mjs";

test("committed sources reuse compatible dependencies without sharing live or incompatible installs", async () => {
  const cache = await fs.mkdtemp(path.join(DATA, "dependency-test-"));
  try {
    const donor = path.join(cache, "first"),
      next = path.join(cache, "next");
    const pkg = JSON.stringify({ dependencies: { vite: "7.0.0" } });
    const lock = JSON.stringify({ lockfileVersion: 3 });
    for (const dir of [donor, next]) {
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, ".layout-lab-reference.json"), "{}");
      await fs.writeFile(path.join(dir, "package.json"), pkg);
      await fs.writeFile(path.join(dir, "package-lock.json"), lock);
    }
    const modules = path.join(donor, "node_modules");
    await fs.mkdir(path.join(modules, ".cache"), { recursive: true });
    await fs.mkdir(path.join(modules, "vite/bin"), { recursive: true });
    await fs.writeFile(path.join(modules, "vite/bin/vite.js"), "");
    await fs.writeFile(
      path.join(modules, ".cache/layout-lab-dependencies"),
      lock,
    );
    const runtime = path.join(modules, ".cache/layout-lab-runtime");
    await fs.writeFile(runtime, "other-runtime");
    assert.equal(await reuseDependencies(next, cache), false);
    await fs.writeFile(runtime, dependencyRuntime);
    await fs.writeFile(path.join(next, "package-lock.json"), "changed");
    assert.equal(await reuseDependencies(next, cache), false);
    await fs.writeFile(path.join(next, "package-lock.json"), lock);
    await fs.writeFile(
      path.join(next, "package.json"),
      JSON.stringify({ scripts: { prepare: "build" } }),
    );
    assert.equal(await reuseDependencies(next, cache), false);
    await fs.writeFile(path.join(next, "package.json"), pkg);
    await fs.writeFile(path.join(next, ".npmrc"), "legacy-peer-deps=true");
    assert.equal(await reuseDependencies(next, cache), false);
    await fs.unlink(path.join(next, ".npmrc"));
    await fs.unlink(path.join(next, ".layout-lab-reference.json"));
    assert.equal(await reuseDependencies(next, cache), false);
    await fs.writeFile(path.join(next, ".layout-lab-reference.json"), "{}");
    assert.equal(
      await reuseDependencies(next, path.join(cache, "elsewhere")),
      false,
    );
    assert.equal(await reuseDependencies(next, cache), true);
    assert.equal(
      await fs.realpath(path.join(next, "node_modules")),
      await fs.realpath(modules),
    );
    assert.equal(
      await reuseDependencies(next, cache),
      false,
      "an existing installation is left intact",
    );
  } finally {
    assert.ok(cache.startsWith(DATA + path.sep));
    await fs.rm(cache, { recursive: true, force: true });
  }
});
