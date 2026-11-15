// 为 Windows dir 构建补写 app-update.yml（electron-builder 的 dir 目标不会生成）
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const resources = process.argv[2];
if (!resources) {
  console.error("usage: node scripts/write-update-config.mjs <resources-dir>");
  process.exit(1);
}
mkdirSync(resources, { recursive: true });
writeFileSync(
  join(resources, "app-update.yml"),
  ["owner: seedcm", "repo: steam-deal-radar", "provider: github", "releaseType: release", "updaterCacheDirName: '@radardesktop-updater'", ""].join("\n"),
  "utf8",
);
console.log("[update] wrote app-update.yml ->", resources);
