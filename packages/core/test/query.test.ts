import { describe, expect, it } from "vitest";
import { filterDeals, filterReviews, matchesQuery, sortDeals } from "../src/query";
import { formatMoney, formatCountdown, parseMoneyInput, moneyToInput, sanitizeSettings, regionCurrency, validateMoneyInput, friendlyError } from "../src/format";
import { DEFAULT_SETTINGS } from "../src/store";
import type { Deal } from "../src/types";

const deal = (patch: Partial<Deal>): Deal => ({
  appId: 1,
  name: "Game",
  discountPercent: 10,
  finalPrice: 1000,
  platforms: { windows: true, mac: false, linux: false },
  storeUrl: "https://store.steampowered.com/app/1",
  ...patch,
});

const deals = [
  deal({ appId: 1, name: "Alpha", discountPercent: 80, finalPrice: 2000, originalPrice: 10000, platforms: { windows: true, mac: false, linux: false } }),
  deal({ appId: 2, name: "Beta 测试", discountPercent: 30, finalPrice: 500, originalPrice: 714, platforms: { windows: true, mac: true, linux: true } }),
  deal({ appId: 3, name: "Gamma", discountPercent: 50, finalPrice: 1000, originalPrice: 2000, tags: ["Roguelike"], platforms: { windows: false, mac: false, linux: true } }),
];

describe("filterDeals", () => {
  it("按折扣、平台与关注状态过滤", () => {
    expect(filterDeals(deals, { minDiscount: 40 })).toHaveLength(2);
    expect(filterDeals(deals, { platform: "linux" })).toHaveLength(2);
    expect(filterDeals(deals, { platform: "windows" })).toHaveLength(2);
    expect(filterDeals(deals, { platform: "mac" })).toHaveLength(1);
    expect(filterDeals(deals, { watchOnly: true, watchIds: new Set([1, 3]) })).toHaveLength(2);
    expect(filterDeals(deals, { hideWatched: true, watchIds: [1] })).toHaveLength(2);
  });

  it("支持名称与标签搜索", () => {
    expect(filterDeals(deals, { query: "beta" })).toHaveLength(1);
    expect(filterDeals(deals, { query: "rogue" })).toHaveLength(1);
    expect(matchesQuery({ name: "Hades" }, "HADES")).toBe(true);
    expect(matchesQuery({ name: "Hades" }, "")).toBe(true);
    expect(filterDeals(deals, { query: "nothing" })).toHaveLength(0);
  });
});

describe("sortDeals", () => {
  it("按折扣/价格/名称排序", () => {
    expect(sortDeals(deals, "discount").map((item) => item.appId)).toEqual([1, 3, 2]);
    expect(sortDeals(deals, "price").map((item) => item.appId)).toEqual([2, 3, 1]);
    expect(sortDeals(deals, "name").map((item) => item.name)).toEqual(["Alpha", "Beta 测试", "Gamma"]);
  });

  it("支持升降序与原价排序", () => {
    expect(sortDeals(deals, "discount", "asc").map((item) => item.appId)).toEqual([2, 3, 1]);
    expect(sortDeals(deals, "price", "desc").map((item) => item.appId)).toEqual([1, 3, 2]);
    expect(sortDeals(deals, "originalPrice", "asc").map((item) => item.appId)).toEqual([2, 3, 1]);
    expect(sortDeals(deals, "name", "desc").map((item) => item.name)).toEqual(["Gamma", "Beta 测试", "Alpha"]);
  });

  it("不修改原数组", () => {
    const copy = [...deals];
    sortDeals(deals, "price");
    expect(deals).toEqual(copy);
  });
});

describe("价格格式化", () => {
  it("分转显示与输入解析", () => {
    expect(formatMoney(14900, "CNY")).toContain("149");
    expect(moneyToInput(14900)).toBe("149.00");
    expect(parseMoneyInput("¥ 149.5")).toBe(14950);
    expect(parseMoneyInput("")).toBeUndefined();
    expect(parseMoneyInput("abc")).toBeUndefined();
    expect(validateMoneyInput("99.99")).toEqual({ ok: true, cents: 9999 });
    expect(validateMoneyInput("")).toEqual({ ok: true, cents: undefined });
    expect(validateMoneyInput("-10").ok).toBe(false);
    expect(validateMoneyInput("abc").ok).toBe(false);
    expect(validateMoneyInput("12.345").ok).toBe(false);
    expect(regionCurrency("cn")).toBe("CNY");
    expect(regionCurrency("unknown")).toBe("USD");
  });

  it("网络错误转成中文", () => {
    expect(friendlyError(new Error("fetch failed"))).toContain("网络请求失败");
    expect(friendlyError(new Error("net::ERR_NAME_NOT_RESOLVED"))).toContain("域名解析");
    expect(friendlyError(new Error("MyMemory 今日额度已用完"))).toContain("额度");
  });

  it("倒计时文案", () => {
    const now = Date.now();
    expect(formatCountdown(now + 30 * 60_000, now)).toContain("分钟后结束");
    expect(formatCountdown(now + 3 * 3_600_000, now)).toContain("小时后结束");
    expect(formatCountdown(now + 72 * 3_600_000, now)).toContain("天后结束");
    expect(formatCountdown(now - 1000, now)).toBeNull();
    expect(formatCountdown(undefined, now)).toBeNull();
  });
});

describe("sanitizeSettings", () => {
  it("修正越界值并保留其余字段", () => {
    const next = sanitizeSettings(
      { refreshMinutes: 5, quietHours: { enabled: true, start: 30, end: -2 } as never },
      DEFAULT_SETTINGS,
    );
    expect(next.refreshMinutes).toBe(15);
    expect(next.quietHours.start).toBe(23);
    expect(next.quietHours.end).toBe(0);
    expect(next.sort).toBe(DEFAULT_SETTINGS.sort);
  });
});


describe("filterReviews", () => {
  const reviews = [
    { id: "1", author: "a", votedUp: true, text: "", helpful: 1, funny: 0, comments: 0 },
    { id: "2", author: "b", votedUp: false, text: "", helpful: 2, funny: 0, comments: 0 },
    { id: "3", author: "c", votedUp: true, text: "", helpful: 3, funny: 0, comments: 0 },
  ] as const;

  it("支持仅好评、仅差评与组合（全部）", () => {
    expect(filterReviews([...reviews], ["positive"]).map((item) => item.id)).toEqual(["1", "3"]);
    expect(filterReviews([...reviews], ["negative"]).map((item) => item.id)).toEqual(["2"]);
    expect(filterReviews([...reviews], ["positive", "negative"])).toHaveLength(3);
    expect(filterReviews([...reviews], [])).toHaveLength(3);
  });

  it("支持升降序与原价排序", () => {
    expect(sortDeals(deals, "discount", "asc").map((item) => item.appId)).toEqual([2, 3, 1]);
    expect(sortDeals(deals, "price", "desc").map((item) => item.appId)).toEqual([1, 3, 2]);
    expect(sortDeals(deals, "originalPrice", "asc").map((item) => item.appId)).toEqual([2, 3, 1]);
    expect(sortDeals(deals, "name", "desc").map((item) => item.name)).toEqual(["Gamma", "Beta 测试", "Alpha"]);
  });

  it("不修改原数组", () => {
    const copy = [...reviews];
    filterReviews([...reviews], ["positive"]);
    expect(reviews).toEqual(copy);
  });
});
