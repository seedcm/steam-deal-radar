import { build } from "esbuild";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const here = import.meta.dirname;
const desktopRoot = path.resolve(here, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const uiDist = path.join(repoRoot, "apps", "ui", "dist");
const outDir = path.join(desktopRoot, "dist");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: false,
  minify: false,
  logLevel: "info",
  external: ["electron"],
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
};

await build({ ...shared, entryPoints: [path.join(desktopRoot, "src", "main.ts")], outfile: path.join(outDir, "main.cjs") });
await build({ ...shared, entryPoints: [path.join(desktopRoot, "src", "preload.ts")], outfile: path.join(outDir, "preload.cjs") });

// 把 Web UI 一起打包进 Electron 资源目录
const uiTarget = path.join(desktopRoot, "ui");
await rm(uiTarget, { recursive: true, force: true });
await stat(uiDist).catch(() => {
  throw new Error("缺少 apps/ui/dist，请先运行 npm run build -w @radar/ui");
});
await cp(uiDist, uiTarget, { recursive: true });

console.log("[build] Electron 主进程与界面资源已就绪 →", outDir);
