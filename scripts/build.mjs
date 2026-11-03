import { build } from "esbuild";
import { mkdir, copyFile, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await build({
  entryPoints: {
    content: "src/content/index.ts",
    background: "src/background.ts",
    popup: "src/ui/popup.ts",
    workspace: "src/ui/workspace.ts",
  },
  bundle: true,
  outdir: "dist",
  target: "chrome120",
  format: "iife",
  sourcemap: false,
  minify: false,
});
for (const name of ["manifest.json", "popup.html", "workspace.html", "ui.css"])
  await copyFile(name, `dist/${name}`);
console.log("Extensão gerada em dist/");
