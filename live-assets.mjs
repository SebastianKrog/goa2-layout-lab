// Serve the Live checkout's existing public bytes from the Windows host instead
// of sending hundreds of small asset reads through the WSL filesystem boundary.
import fs from "node:fs/promises";
import path from "node:path";
export const LIVE_ASSET_PATTERN =
  /\/(?:cards|models|map|maps|mats|player-mats|hero|hero-cards|hero-images|icons|fonts|goa2-translations|goa2-cards)\//;
const types = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".ktx2": "image/ktx2",
};
export class LiveAssets {
  constructor(root, { maxBytes = 128 * 1024 * 1024 } = {}) {
    this.root = path.resolve(root, "public");
    this.archive = path.resolve(root, "model-archive/heroes");
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.cache = new Map();
    this.pending = new Map();
  }
  async get(pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (
      !/^\/(cards|models|map|maps|mats|player-mats|hero|hero-cards|hero-images|icons|fonts|goa2-translations|goa2-cards)\//.test(
        decoded,
      ) ||
      decoded.includes("\\")
    )
      return null;
    // Mirror the frontend's archived-hero-models Vite route exactly.
    const archived = /^\/models\/heroes\/original\/([a-z0-9_-]+)\.glb$/.exec(
      decoded,
    );
    const target = archived
      ? path.join(this.archive, archived[1], `${archived[1]}-original.glb`)
      : path.resolve(this.root, "." + decoded);
    const allowedRoot = archived ? this.archive : this.root;
    if (!target.startsWith(allowedRoot + path.sep)) return null;
    let stat;
    try {
      stat = await fs.stat(target, { bigint: true });
    } catch (e) {
      if (["ENOENT", "ENOTDIR"].includes(e.code)) return null;
      throw e;
    }
    if (!stat.isFile()) return null;
    const stamp = `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`;
    let entry = this.cache.get(target);
    if (entry?.stamp === stamp) {
      this.cache.delete(target);
      this.cache.set(target, entry);
      return entry.result;
    }
    const pendingKey = target + ":" + stamp;
    if (this.pending.has(pendingKey)) return this.pending.get(pendingKey);
    const reading = (async () => {
      const body = await fs.readFile(target);
      const result = {
        body,
        contentType:
          types[path.extname(target).toLowerCase()] ||
          "application/octet-stream",
      };
      const current = this.cache.get(target);
      if (current) {
        this.bytes -= current.result.body.length;
        this.cache.delete(target);
      }
      if (body.length <= this.maxBytes) {
        this.cache.set(target, { stamp, result });
        this.bytes += body.length;
        while (this.bytes > this.maxBytes) {
          const first = this.cache.keys().next().value;
          this.bytes -= this.cache.get(first).result.body.length;
          this.cache.delete(first);
        }
      }
      return result;
    })();
    this.pending.set(pendingKey, reading);
    try {
      return await reading;
    } finally {
      this.pending.delete(pendingKey);
    }
  }
}
