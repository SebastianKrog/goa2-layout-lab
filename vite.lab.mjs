import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { instrument } from "./instrument.mjs";
import { DATA, ROOT } from "./config.mjs";

const root = process.env.GOA2_LAB_SOURCE;
if (!root) throw new Error("Start Vite through npm run compare.");
const requireSource = createRequire(path.join(root, "package.json"));
const { defineConfig, loadConfigFromFile } = await import(
  pathToFileURL(requireSource.resolve("vite")).href
);
const { cloudflare } = await import(
  pathToFileURL(
    path.join(root, "node_modules/@cloudflare/vite-plugin/dist/index.mjs"),
  ).href
);
const loaded = await loadConfigFromFile(
  { command: "serve", mode: "development" },
  path.join(root, "vite.config.ts"),
);
if (!loaded) throw new Error("Cannot load the source frontend Vite config.");
const original = loaded.config;
const generated = path.join(
  DATA,
  "workers",
  `worker-${process.env.GOA2_LAB_PORT}.json`,
);
fs.mkdirSync(path.dirname(generated), { recursive: true });
fs.writeFileSync(
  generated,
  JSON.stringify({
    name: "goa2-layout-lab",
    main: path.join(root, "worker/index.ts"),
    compatibility_date: "2025-09-27",
    compatibility_flags: ["nodejs_compat"],
    assets: {
      binding: "ASSETS",
      not_found_handling: "single-page-application",
    },
    vars: {
      BACKEND_ORIGIN: `http://127.0.0.1:${process.env.GOA2_LAB_BACKEND_PORT || 8100}`,
    },
  }),
);
// The generated Wrangler config has its own directory, so the normal .dev.vars
// (which points at port 8000) is never read by the comparison Worker.
export default defineConfig({
  ...original,
  root,
  define: {
    ...original.define,
    "import.meta.env.VITE_API_URL": JSON.stringify("/api"),
  },
  // Keep optimized bundles under node_modules, where React's source transform
  // excludes them. An external cache makes Babel reprocess huge Three bundles.
  cacheDir: path.join(
    root,
    `node_modules/.cache/layout-lab-vite-${process.env.GOA2_LAB_PORT}`,
  ),
  plugins: [
    {
      name: "goa2-layout-lab-camera",
      enforce: "pre",
      apply: "serve",
      transform: instrument,
    },
    ...original.plugins.slice(0, -1),
    cloudflare({
      configPath: generated,
      inspectorPort: false,
      persistState: {
        path: path.join(DATA, `workers/state-${process.env.GOA2_LAB_PORT}`),
      },
    }),
  ],
  resolve: {
    ...original.resolve,
    dedupe: ["react", "react-dom", "three", "@react-three/fiber"],
  },
  server: {
    ...original.server,
    host: "0.0.0.0",
    port: Number(process.env.GOA2_LAB_PORT),
    strictPort: true,
    watch:
      path.resolve(root) === path.resolve(ROOT)
        ? {
            usePolling: true,
            interval: 500,
            ignored: [path.join(root, ".layout-lab/**")],
          }
        : null,
    fs: { allow: [root, process.env.GOA2_LAB_TOOL] },
  },
});
