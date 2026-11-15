import { describe, expect, it } from "vitest";
import { RadarService } from "../src/service";
import { RadarStore } from "../src/store";
import type { StorageAdapter } from "../src/types";

/** 联网验证评测解析（默认跳过）：RADAR_LIVE=1 npm test -w @radar/core */
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

describe.skipIf(!live)("Steam 评测页面", () => {
  it(
    "能解析第一页并按官方排序翻页",
    async () => {
      const store = new RadarStore(new MemoryAdapter());
      const service = new RadarService({ http: fetchText, store });
      await service.init();

      const page1 = await service.reviews(1245620);
      expect(page1.reviews.length).toBeGreaterThanOrEqual(5);
      expect(page1.hasMore).toBe(true);
      expect(page1.next?.userreviewscursor).toBeTruthy();

      const first = page1.reviews[0]!;
      expect(first.author.length).toBeGreaterThan(0);
      expect(first.text.length).toBeGreaterThan(0);
      expect(first.helpful).toBeGreaterThan(0);
      expect(typeof first.votedUp).toBe("boolean");

      const page2 = await service.reviews(1245620, page1.next);
      expect(page2.reviews.length).toBeGreaterThan(0);
      const ids = new Set(page1.reviews.map((review) => review.id));
      expect(page2.reviews.some((review) => ids.has(review.id))).toBe(false);
      console.log(`[live] 第一页 ${page1.reviews.length} 条，示例 ${first.author}（${first.helpful} 人觉得有帮助）`);
    },
    60_000,
  );

  it(
    "能按国区/英语区筛选评价，并免费翻译成中文",
    async () => {
      const store = new RadarStore(new MemoryAdapter());
      const service = new RadarService({ http: fetchText, store });
      await service.init();

      const chinese = await service.reviews(1245620, undefined, "schinese");
      const chineseTexts = chinese.reviews.map((review) => review.text).join(" ");
      expect(chineseTexts).toMatch(/[\u4e00-\u9fff]/);

      const english = await service.reviews(1245620, undefined, "english");
      const firstEnglish = english.reviews.find((review) => review.text.length > 40);
      expect(firstEnglish).toBeDefined();
      expect(firstEnglish!.text).not.toMatch(/[\u4e00-\u9fff]/);

      const translated = await service.translate(firstEnglish!.text.slice(0, 300));
      expect(translated.text).toMatch(/[\u4e00-\u9fff]/);
      expect(["MyMemory", "Google"]).toContain(translated.engine);
      console.log(`[live] 翻译引擎 ${translated.engine}：${translated.text.slice(0, 40)}`);
    },
    90_000,
  );
});
