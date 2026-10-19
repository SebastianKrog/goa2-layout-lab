import fs from "node:fs/promises";
import path from "node:path";

export const dependencyRuntime = `${process.platform}-${process.arch}-${process.versions.modules}`;
const marker = "node_modules/.cache/layout-lab-dependencies";
const runtimeMarker = "node_modules/.cache/layout-lab-runtime";
const read = (file) => fs.readFile(file).catch(() => null);
const equal = (a, b) => a === b || !!(a && b && a.equals(b));

// Only committed source caches may borrow dependencies. Never link a live
// checkout: npm ci there could otherwise remove another view's dependencies.
export async function reuseDependencies(root, cache) {
  if (!path.resolve(root).startsWith(path.resolve(cache) + path.sep))
    return false;
  if (!(await read(path.join(root, ".layout-lab-reference.json"))))
    return false;
  // Leave existing installations (including broken ones) to npm's normal path.
  if (await fs.lstat(path.join(root, "node_modules")).catch(() => null))
    return false;
  const files = ["package.json", "package-lock.json", ".npmrc"];
  const expected = await Promise.all(
    files.map((file) => read(path.join(root, file))),
  );
  if (!expected[0] || !expected[1]) return false;
  const pkg = JSON.parse(expected[0]);
  // Root install hooks and local packages may depend on this source directory.
  if (
    [
      "preinstall",
      "install",
      "postinstall",
      "prepublish",
      "preprepare",
      "prepare",
      "postprepare",
    ].some((key) => pkg.scripts?.[key])
  )
    return false;
  if (await fs.stat(path.join(root, "binding.gyp")).catch(() => null))
    return false;
  if (
    pkg.workspaces ||
    Object.values({
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.optionalDependencies,
    }).some((version) => /^(file:|link:|workspace:|\.?\.?\/)/.test(version))
  )
    return false;
  const entries = await fs.readdir(path.dirname(root), { withFileTypes: true });
  for (const entry of entries) {
    const donor = path.join(path.dirname(root), entry.name);
    if (!entry.isDirectory() || donor === root) continue;
    if (!(await read(path.join(donor, ".layout-lab-reference.json")))) continue;
    const actual = await Promise.all(
      files.map((file) => read(path.join(donor, file))),
    );
    if (!actual.every((value, i) => equal(value, expected[i]))) continue;
    if (!equal(await read(path.join(donor, marker)), expected[1])) continue;
    if (
      (await read(path.join(donor, runtimeMarker)))?.toString() !==
      dependencyRuntime
    )
      continue;
    const modules = await fs.realpath(path.join(donor, "node_modules"));
    if (
      !(await fs.stat(path.join(modules, "vite/bin/vite.js")).catch(() => null))
    )
      continue;
    await fs.symlink(
      modules,
      path.join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    console.log(`Reusing frontend dependencies from ${entry.name}`);
    return true;
  }
  return false;
}
