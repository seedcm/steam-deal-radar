import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/store";
import { inQuietHours, planNotifications } from "../src/reminders";
import type { Settings, WatchEntry, WatchQuote } from "../src/types";

const NOW = new Date("2026-11-14T12:00:00+08:00").getTime();

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...patch, quietHours: { ...DEFAULT_SETTINGS.quietHours, ...(patch.quietHours ?? {}) } };
}

function entry(patch: Partial<WatchEntry> = {}): WatchEntry {
  return { appId: 1245620, name: "ELDEN RING", addedAt: NOW - 86_400_000, notifyAny: true, ...patch };
}

function quote(patch: Partial<WatchQuote> = {}): WatchQuote {
  return {
    appId: 1245620,
    name: "ELDEN RING",
    price: 14900,
    originalPrice: 29800,
    discount: 50,
    at: NOW,
    storeUrl: "https://store.steampowered.com/app/1245620",
    ...patch,
  };
}

const quotes = { "1245620": quote() };

describe("planNotifications", () => {
  it("命中目标价时发出到价提醒", () => {
    const result = planNotifications({
      watchlist: [entry({ targetPrice: 15000 })],
      quotes,
      lowestBefore: {},
      settings: settings(),
      now: NOW,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe("target");
    expect(result[0]!.title).toContain("到价提醒");
    expect(result[0]!.body).toContain("¥");
  });

  it("目标价未命中时退化为折扣提醒", () => {
    const result = planNotifications({
      watchlist: [entry({ targetPrice: 10000 })],
      quotes,
      lowestBefore: {},
      settings: settings({ notifyMinDiscount: 30 }),
      now: NOW,
    });
    expect(result[0]!.kind).toBe("sale");
  });

  it("低于历史最低价时提醒新史低", () => {
    const result = planNotifications({
      watchlist: [entry({ targetPrice: 5000 })],
      quotes,
      lowestBefore: { "1245620": 18000 },
      settings: settings(),
      now: NOW,
    });
    expect(result[0]!.kind).toBe("newlow");
    expect(result[0]!.title).toContain("新史低");
    expect(result[0]!.body).toContain("180");
  });

  it("折扣不足或未开启通知时不打扰用户", () => {
    expect(
      planNotifications({
        watchlist: [entry()],
        quotes,
        lowestBefore: {},
        settings: settings({ notifyMinDiscount: 80 }),
        now: NOW,
      }),
    ).toHaveLength(0);

    expect(
      planNotifications({
        watchlist: [entry()],
        quotes,
        lowestBefore: {},
        settings: settings({ notifyEnabled: false }),
        now: NOW,
      }),
    ).toHaveLength(0);

    expect(
      planNotifications({
        watchlist: [entry({ notifyAny: false, targetPrice: 9000 })],
        quotes,
        lowestBefore: {},
        settings: settings({ notifyMinDiscount: 80 }),
        now: NOW,
      }),
    ).toHaveLength(0);
  });

  it("同价提醒 12 小时内去重", () => {
    const notified = entry({ lastNotified: { price: 14900, discount: 50, at: NOW - 3_600_000, kind: "sale" } });
    expect(planNotifications({ watchlist: [notified], quotes, lowestBefore: {}, settings: settings(), now: NOW })).toHaveLength(0);

    const old = entry({ lastNotified: { price: 14900, discount: 50, at: NOW - 48 * 3_600_000, kind: "sale" } });
    expect(planNotifications({ watchlist: [old], quotes, lowestBefore: {}, settings: settings(), now: NOW })).toHaveLength(1);
  });

  it("更多折扣优先，且单轮最多 5 条", () => {
    const watchlist = Array.from({ length: 8 }, (_, index) =>
      entry({ appId: index + 1, name: `Game ${index + 1}`, notifyAny: true }),
    );
    const many: Record<string, WatchQuote> = {};
    watchlist.forEach((item, index) => {
      many[String(item.appId)] = quote({ appId: item.appId, name: item.name, discount: 20 + index * 5, price: 10000 - index * 500 });
    });
    const result = planNotifications({ watchlist, quotes: many, lowestBefore: {}, settings: settings(), now: NOW });
    expect(result).toHaveLength(5);
    expect(result[0]!.appId).toBe(8);
  });

  it("静默时段只放行目标价提醒", () => {
    // 用本地时间构造：inQuietHours 依据运行机器的时区判断，不能写死 +08:00
    const night = new Date(2026, 10, 14, 23, 30).getTime();
    const quietSettings = settings({ quietHours: { enabled: true, start: 22, end: 8 } });
    expect(
      planNotifications({ watchlist: [entry()], quotes, lowestBefore: {}, settings: quietSettings, now: night }),
    ).toHaveLength(0);
    expect(
      planNotifications({
        watchlist: [entry({ targetPrice: 15000 })],
        quotes,
        lowestBefore: {},
        settings: quietSettings,
        now: night,
      }),
    ).toHaveLength(1);
  });

  it("忽略没有报价或价格为零的关注项", () => {
    const result = planNotifications({
      watchlist: [entry({ appId: 999 })],
      quotes: { "999": quote({ appId: 999, price: 0, discount: 0 }) },
      lowestBefore: {},
      settings: settings(),
      now: NOW,
    });
    expect(result).toHaveLength(0);
  });
});

describe("inQuietHours", () => {
  it("支持跨零点区间", () => {
    const at = (hour: number) => new Date(2026, 10, 14, hour, 30).getTime();
    const quiet = { enabled: true, start: 23, end: 7 };
    expect(inQuietHours(quiet, at(23))).toBe(true);
    expect(inQuietHours(quiet, at(3))).toBe(true);
    expect(inQuietHours(quiet, at(12))).toBe(false);
    expect(inQuietHours({ enabled: false, start: 23, end: 7 }, at(23))).toBe(false);
    expect(inQuietHours({ enabled: true, start: 8, end: 8 }, at(8))).toBe(false);
  });
});
