import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(webDir, "src/service-worker/index.ts")],
  bundle: true,
  outfile: path.join(webDir, "public/sw.js"),
  format: "iife",
  target: "es2020",
  alias: { "@": path.join(webDir, "src") },
  logLevel: "warning",
});
