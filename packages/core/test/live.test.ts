import { describe, expect, it } from "vitest";
import { buildAppDetailsUrl, buildDealsUrl, buildFeaturedUrl, parseAppDetails, parseFeaturedSpecials, parseSearchPayload } from "../src/steam";

/**
 * 需要联网的冒烟测试，默认跳过。
 * 运行：RADAR_LIVE=1 npm test -w @radar/core
 */
const live = process.env.RADAR_LIVE === "1";

async function get(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "accept-language": "zh-CN,zh;q=0.9",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return await response.text();
}

describe.skipIf(!live)("Steam 线上接口", () => {
  it("折扣列表可以解析出真实数据", async () => {
    const body = await get(buildDealsUrl({ country: "cn", language: "schinese" }, 0));
    const deals = parseSearchPayload(body, "CNY");
    expect(deals.length).toBeGreaterThan(20);
    expect(deals.filter((deal) => deal.discountPercent > 0).length).toBe(deals.length);
    const priced = deals.filter((deal) => (deal.finalPrice ?? 0) > 0);
    expect(priced.length).toBeGreaterThan(10);
    console.log(`[live] 解析到 ${deals.length} 个折扣，示例：`, deals[0]?.name, deals[0]?.finalPriceText);
  }, 30_000);

  it("每日特惠与详情接口可用", async () => {
    const featured = parseFeaturedSpecials(JSON.parse(await get(buildFeaturedUrl({ country: "cn", language: "schinese" }))));
    expect(featured.length).toBeGreaterThan(0);

    const details = parseAppDetails(await get(buildAppDetailsUrl(1245620, { country: "cn", language: "schinese" })), 1245620);
    expect(details?.name).toContain("艾尔登法环");
    expect(details?.platforms.windows).toBe(true);
  }, 30_000);
});
