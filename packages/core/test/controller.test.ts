import { describe, expect, it } from "vitest";
import { isAllowedExternalUrl } from "../src/controller";

describe("isAllowedExternalUrl", () => {
  it("允许 Steam 与 GitHub 的 https 链接", () => {
    expect(isAllowedExternalUrl("https://store.steampowered.com/app/730")).toContain("store.steampowered.com");
    expect(isAllowedExternalUrl("https://github.com/seedcm/steam-deal-radar")).toContain("github.com");
    expect(isAllowedExternalUrl("https://gist.github.com/abc")).toContain("gist.github.com");
  });

  it("拒绝非 https、非白名单与伪造域名", () => {
    expect(isAllowedExternalUrl("http://github.com/seedcm/steam-deal-radar")).toBeNull();
    expect(isAllowedExternalUrl("https://example.com/steal")).toBeNull();
    expect(isAllowedExternalUrl("https://github.com.evil.example/x")).toBeNull();
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBeNull();
    expect(isAllowedExternalUrl("not a url")).toBeNull();
  });
});

import { RadarController } from "../src/controller";
import { RadarService } from "../src/service";
import { RadarStore } from "../src/store";
import type { StorageAdapter } from "../src/types";

class MemoryAdapter implements StorageAdapter {
  data: string | null = null;
  async read() {
    return this.data;
  }
  async write(value: string) {
    this.data = value;
  }
}

describe("saveExport", () => {
  it("调用宿主的保存对话框并返回路径", async () => {
    const store = new RadarStore(new MemoryAdapter());
    await store.load();
    const service = new RadarService({ http: async () => "", store });
    let savedName = "";
    const controller = new RadarController(
      service,
      {
        os: "test",
        openExternal: () => {},
        saveFile: async (data, name) => {
          savedName = name;
          expect(data).toContain("\"settings\"");
          return "/tmp/backup.json";
        },
      },
      { version: "1.5.2", platform: "web" },
    );
    await expect(controller.invoke("saveExport")).resolves.toEqual({ saved: true, path: "/tmp/backup.json" });
    expect(savedName).toMatch(/^steam-deal-radar-backup-\d{4}-\d{2}-\d{2}\.json$/);
  });
});
