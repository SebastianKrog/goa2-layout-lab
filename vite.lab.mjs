import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { instrument } from "./instrument.mjs";
import { ROOT } from "./config.mjs";

import { localAPIProxy } from "./local-api-proxy.mjs";

const root = process.env.GOA2_LAB_SOURCE;
if (!root) throw new Error("Start Vite through npm run compare.");
const requireSource = createRequire(path.join(root, "package.json"));
const { defineConfig, loadConfigFromFile } = await import(
  pathToFileURL(requireSource.resolve("vite")).href
);
const loaded = await loadConfigFromFile(
  { command: "serve", mode: "development" },
  path.join(root, "vite.config.ts"),
);
if (!loaded) throw new Error("Cannot load the source frontend Vite config.");
const original = loaded.config;
// Local comparisons need the same-origin API contract, without a deployment
// worker emulator for every frontend. Keep the source React/asset plugins.
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
    proxy: {
      "^/api(?:/|$)": localAPIProxy(process.env.GOA2_LAB_BACKEND_PORT || 8100),
    },
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
