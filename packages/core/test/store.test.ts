import { describe, expect, it } from "vitest";
import { RadarStore, createEmptyState } from "../src/store";
import type { StorageAdapter } from "../src/types";

class MemoryAdapter implements StorageAdapter {
  data: string | null = null;
  writes = 0;
  async read() {
    return this.data;
  }
  async write(value: string) {
    this.writes += 1;
    this.data = value;
  }
}

const NOW = 1_800_000_000_000;

describe("RadarStore", () => {
  it("关注列表增删改与去重", () => {
    const store = new RadarStore(new MemoryAdapter(), () => NOW);
    store.addWatch({ appId: 1245620, name: "ELDEN RING" }, 10000);
    store.addWatch({ appId: 1245620, name: "ELDEN RING" });
    expect(store.watchlist).toHaveLength(1);
    expect(store.isWatched(1245620)).toBe(true);

    store.updateWatch(1245620, { targetPrice: 8000, note: "史低再买" });
    expect(store.watchlist[0]!.targetPrice).toBe(8000);
    expect(store.watchlist[0]!.note).toBe("史低再买");

    expect(store.removeWatch(1245620)).toBe(true);
    expect(store.removeWatch(1245620)).toBe(false);
    expect(store.watchlist).toHaveLength(0);
  });

  it("记录历史最低价并保留价格点位", () => {
    const store = new RadarStore(new MemoryAdapter(), () => NOW);
    store.recordPrice(570, 1000, 50);
    store.recordPrice(570, 900, 55);
    store.recordPrice(570, 900, 55); // 同价去重
    expect(store.state.lowest["570"]).toBe(900);
    expect(store.state.history["570"]).toHaveLength(2);
  });

  it("合并折扣数据时保留详情字段", () => {
    const store = new RadarStore(new MemoryAdapter(), () => NOW);
    store.setDeals([
      {
        appId: 1,
        name: "A",
        discountPercent: 10,
        finalPrice: 900,
        platforms: { windows: true, mac: false, linux: false },
        storeUrl: "https://store.steampowered.com/app/1",
        description: "旧简介",
      },
    ]);
    store.mergeDeals([
      {
        appId: 1,
        name: "A",
        discountPercent: 20,
        finalPrice: 800,
        platforms: { windows: true, mac: false, linux: false },
        storeUrl: "https://store.steampowered.com/app/1",
      },
    ]);
    expect(store.deals[0]!.description).toBe("旧简介");
    expect(store.deals[0]!.finalPrice).toBe(800);
  });

  it("设置写回时做范围修正", () => {
    const store = new RadarStore(new MemoryAdapter(), () => NOW);
    const next = store.updateSettings({ refreshMinutes: 1, fetchPages: 99, minDiscount: -5 });
    expect(next.refreshMinutes).toBe(15);
    expect(next.fetchPages).toBe(6);
    expect(next.minDiscount).toBe(0);
  });

  it("导出备份不包含翻译 API Key", async () => {
    const store = new RadarStore(new MemoryAdapter(), () => NOW);
    store.updateSettings({ translationApiKey: "sk-secret-value" });
    const json = store.exportState();
    expect(json).not.toContain("sk-secret-value");
    expect(JSON.parse(json).settings.translationApiKey).toBe("");
  });

  it("导出后可完整导入", async () => {
    const adapter = new MemoryAdapter();
    const store = new RadarStore(adapter, () => NOW);
    store.addWatch({ appId: 730, name: "CS2" }, 500);
    store.updateSettings({ country: "us", sort: "price" });
    await store.flush();
    const json = store.exportState();

    const restored = new RadarStore(new MemoryAdapter(), () => NOW);
    await restored.importState(json);
    expect(restored.watchlist).toHaveLength(1);
    expect(restored.settings.country).toBe("us");
    expect(restored.settings.sort).toBe("price");
  });

  it("损坏的状态文件不会导致崩溃", async () => {
    const adapter = new MemoryAdapter();
    adapter.data = "{ not json";
    const store = new RadarStore(adapter, () => NOW);
    await store.load();
    expect(store.settings).toEqual(createEmptyState().settings);
  });

  it("snapshot 暴露元数据", () => {
    const store = new RadarStore(new MemoryAdapter(), () => NOW);
    store.state.lastRefreshAt = NOW - 60_000;
    store.updateSettings({ refreshMinutes: 30 });
    const snapshot = store.snapshot({ platform: "electron", appVersion: "1.2.0" });
    expect(snapshot.meta.lastRefreshAt).toBe(NOW - 60_000);
    expect(snapshot.meta.platform).toBe("electron");
    expect(snapshot.settings.refreshMinutes).toBe(30);
  });
});
