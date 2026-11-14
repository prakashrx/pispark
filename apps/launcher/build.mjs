// Bundles the launcher into one file with no dependencies, and copies the Windows tray script beside it.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/pispark.mjs",
  sourcemap: true,
  logLevel: "warning",
});
copyFileSync("src/tray.ps1", "dist/tray.ps1");
copyFileSync("assets/pispark.ico", "dist/pispark.ico");
