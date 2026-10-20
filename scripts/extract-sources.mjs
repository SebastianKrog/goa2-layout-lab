import fs from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const at = arg.indexOf("=");
    return at < 0
      ? [arg.slice(2), true]
      : [arg.slice(2, at), arg.slice(at + 1)];
  }),
);
if (args.help) {
  console.log(
    'npm run extract -- --origin=http://127.0.0.1:3200 --indexes=0,1 --mode=full --out=./new-export\nModes: full, active, element. For element add --selector=".your-element". Uses already-open views; does not load or advance a situation. Omit --out to keep the report in the lab.',
  );
  process.exit(0);
}
const origin = new URL(args.origin || "http://127.0.0.1:3200");
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
  !["http:", "https:"].includes(origin.protocol)
)
  throw Error("Use a local desk origin.");
const indexes = String(args.indexes || "0,1")
  .split(",")
  .map(Number);
const out = args.out ? path.resolve(args.out) : null;
if (out) {
  try {
    await fs.access(out);
    throw Error("Output directory already exists; choose a new one.");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
const response = await fetch(new URL("/api/extract", origin), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    indexes,
    mode: args.mode || "full",
    selector: args.selector || "",
  }),
});
const result = await response.json();
if (!response.ok) throw Error(result.error || "Extraction failed.");
if (!/^source-[a-f0-9-]+$/.test(result.id)) throw Error("Invalid report ID.");
if (out) {
  const prefix = "/reports/" + result.id + "/";
  const metadataResponse = await fetch(
    new URL(prefix + "comparison.json", origin),
  );
  if (!metadataResponse.ok) throw Error("Could not read extraction metadata.");
  const metadata = await metadataResponse.json();
  if (
    !Array.isArray(metadata.files) ||
    metadata.files.some((f) => !/^[a-zA-Z0-9.-]+$/.test(f) || f.includes(".."))
  )
    throw Error("Unexpected export filenames.");
  await fs.mkdir(out);
  for (const file of metadata.files) {
    const r = await fetch(new URL(prefix + file, origin));
    if (!r.ok) throw Error("Failed to download " + file);
    await fs.writeFile(
      path.join(out, file),
      Buffer.from(await r.arrayBuffer()),
    );
  }
}
console.log(
  JSON.stringify(
    { ...result, url: new URL(result.url, origin).href, directory: out },
    null,
    2,
  ),
);
