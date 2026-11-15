import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const uiDist = path.join(repoRoot, "apps", "ui", "dist");
const target = path.join(repoRoot, "apps", "harmony", "entry", "src", "main", "resources", "rawfile", "web");

await stat(uiDist).catch(() => {
  throw new Error("缺少 apps/ui/dist，请先运行 npm run build -w @radar/ui");
});

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(uiDist, target, { recursive: true });
// 构建产物不入库，但保留目录占位，方便 DevEco 识别路径
await writeFile(path.join(target, ".gitkeep"), "", "utf8");

console.log(`[sync] 前端资源已复制到 ${path.relative(repoRoot, target)}`);
