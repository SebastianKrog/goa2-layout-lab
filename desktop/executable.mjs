import fs from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { downloadArtifact } from "@electron/get";
import yauzl from "yauzl";
import { DATA } from "../config.mjs";
const require = createRequire(import.meta.url);
export async function electronExecutable() {
  if (process.env.GOA2_LAB_ELECTRON_EXECUTABLE)
    return path.resolve(process.env.GOA2_LAB_ELECTRON_EXECUTABLE);
  const pkg = require("electron/package.json");
  const relative =
    process.platform === "win32"
      ? "electron.exe"
      : process.platform === "darwin"
        ? "Electron.app/Contents/MacOS/Electron"
        : "electron";
  const packageRoot = path.dirname(require.resolve("electron/package.json"));
  const installed = path.join(packageRoot, "dist", relative);
  if (existsSync(installed)) return installed;
  const dest = path.join(
      DATA,
      "runtime",
      `electron-${pkg.version}-${process.platform}-${process.arch}`,
    ),
    executable = path.join(dest, relative);
  if (existsSync(executable)) return executable;
  console.log(
    `Installing Electron ${pkg.version} for ${process.platform}/${process.arch}...`,
  );
  const zip = await downloadArtifact({
    version: pkg.version,
    artifactName: "electron",
    platform: process.platform,
    arch: process.arch,
    checksums: require("electron/checksums.json"),
  });
  const temporary = dest + ".extracting-" + randomUUID();
  await fs.mkdir(temporary, { recursive: true });
  await unzip(zip, temporary);
  await fs.rename(temporary, dest);
  return executable;
}
async function unzip(filename, dest) {
  const zip = await new Promise((resolve, reject) =>
    yauzl.open(filename, { lazyEntries: true }, (e, z) =>
      e ? reject(e) : resolve(z),
    ),
  );
  await new Promise((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (entry) => {
      void (async () => {
        const target = path.resolve(dest, entry.fileName);
        if (!target.startsWith(dest + path.sep))
          throw Error("Invalid Electron archive path");
        const mode = entry.externalFileAttributes >>> 16;
        if (entry.fileName.endsWith("/")) {
          await fs.mkdir(target, { recursive: true });
          zip.readEntry();
          return;
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        const parent = await fs.realpath(path.dirname(target)),
          realRoot = await fs.realpath(dest);
        if (parent !== realRoot && !parent.startsWith(realRoot + path.sep))
          throw Error("Archive path leaves destination");
        const input = await new Promise((res, rej) =>
          zip.openReadStream(entry, (e, s) => (e ? rej(e) : res(s))),
        );
        if ((mode & 0o170000) === 0o120000) {
          let value = "";
          for await (const part of input) {
            value += part.toString();
            if (value.length > 4096) throw Error("Invalid archive link");
          }
          const link = path.resolve(path.dirname(target), value);
          if (link !== dest && !link.startsWith(dest + path.sep))
            throw Error("Invalid archive link");
          await fs.symlink(value, target);
        } else {
          await pipeline(input, createWriteStream(target));
          if (process.platform !== "win32" && mode)
            await fs.chmod(target, mode & 0o777);
        }
        zip.readEntry();
      })().catch((e) => {
        zip.close();
        reject(e);
      });
    });
    zip.readEntry();
  });
}
