import { describe, expect, it } from "vitest";
import { RadarService } from "../src/service";
import { RadarStore } from "../src/store";
import type { AppNotification, StorageAdapter } from "../src/types";

/**
 * 端到端冒烟测试（真实请求 Steam，默认跳过）：
 * RADAR_LIVE=1 npm test -w @radar/core
 */
const live = process.env.RADAR_LIVE === "1";

class MemoryAdapter implements StorageAdapter {
  data: string | null = null;
  async read() {
    return this.data;
  }
  async write(value: string) {
    this.data = value;
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "accept-language": "zh-CN,zh;q=0.9",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}

describe.skipIf(!live)("完整刷新流程", () => {
  it(
    "抓取真实折扣、记录史低，并给出到价提醒",
    async () => {
      const adapter = new MemoryAdapter();
      const store = new RadarStore(adapter);
      await store.load();
      store.updateSettings({ fetchPages: 1, country: "cn", language: "schinese", notifyMinDiscount: 10 });

      const sent: AppNotification[] = [];
      const service = new RadarService({
        http: fetchText,
        store,
        version: "test",
        platform: "web",
        notify: (notification) => {
          sent.push(notification);
        },
      });
      await service.init();

      const first = await service.refresh();
      expect(first.ok).toBe(true);
      expect(first.dealCount).toBeGreaterThan(50);
      expect(sent).toHaveLength(0);

      const target = store.deals.find((deal) => (deal.finalPrice ?? 0) > 0);
      expect(target).toBeDefined();

      store.addWatch({ appId: target!.appId, name: target!.name, image: target!.image }, (target!.finalPrice ?? 0) + 100);
      const second = await service.refresh();
      expect(second.ok).toBe(true);

      expect(sent.length).toBeGreaterThan(0);
      expect(sent[0]!.kind).toBe("target");
      expect(store.watchlist[0]!.lastNotified?.price).toBe(target!.finalPrice);
      expect(store.state.lowest[String(target!.appId)]).toBeLessThanOrEqual(target!.finalPrice!);
      expect(adapter.data).toBeTruthy();
    },
    120_000,
  );
});
