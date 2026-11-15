import { describe, expect, it } from "vitest";
import {
  buildDealsUrl,
  decodeEntities,
  parseAppDetails,
  parseFeaturedSpecials,
  parseSearchResults,
  parseStoreSearch,
  parseReviewsHtml,
  parsePostedDate,
  stripTags,
} from "../src/steam";

const SEARCH_HTML = `
<!-- List Items -->
<a href="https://store.steampowered.com/app/1696770/The_Mermaid_Mask/" data-ds-appid="1696770" data-ds-itemkey="App_1696770" class="search_result_row ds_collapse_flag ">
  <div class="search_capsule"><img src="https://shared.fastly.steamstatic.com/capsule_231x87.jpg?t=1" ></div>
  <div class="responsive_search_name_combined">
    <div class="search_name ellipsis"><span class="title">The Mermaid &amp; Mask</span></div>
    <div class="search_platforms"><span class="platform_img win"></span><span class="platform_img linux"></span></div>
    <div class="search_released responsive_secondrow">2026 年 7 月 16 日</div>
    <div class="search_reviewscore responsive_secondrow">
      <span class="search_review_summary positive" data-tooltip-html="特别好评&lt;br&gt;此游戏的 216 篇用户评测中有 99% 为好评。"></span>
    </div>
    <div class="search_price_discount_combined responsive_secondrow" data-price-final="6160">
      <div class="search_discount_and_price">
        <div class="discount_block search_discount_block" data-price-final="6160" data-discount="20">
          <div class="discount_pct">-20%</div>
          <div class="discount_prices">
            <div class="discount_original_price">¥ 77.00</div>
            <div class="discount_final_price">¥ 61.60</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</a>
<a href="https://store.steampowered.com/app/1245620/ELDEN_RING/" data-ds-appid="1245620" class="search_result_row">
  <div class="search_capsule"><img src="https://cdn.example/elden.jpg" ></div>
  <div class="responsive_search_name_combined">
    <div class="search_name ellipsis"><span class="title">ELDEN RING</span></div>
    <div class="search_platforms"><span class="platform_img win"></span></div>
    <div class="search_released responsive_secondrow">2022 年 2 月 24 日</div>
    <div class="search_price_discount_combined responsive_secondrow" data-price-final="14900">
      <div class="discount_block" data-price-final="14900" data-discount="50">
        <div class="discount_pct">-50%</div>
        <div class="discount_original_price">¥ 298.00</div>
        <div class="discount_final_price">¥ 149.00</div>
      </div>
    </div>
  </div>
</a>
`;

describe("parseSearchResults", () => {
  it("解析名称、折扣、价格、平台与评价", () => {
    const deals = parseSearchResults(SEARCH_HTML, "CNY");
    expect(deals).toHaveLength(2);

    const [first, second] = deals;
    expect(first).toMatchObject({
      appId: 1696770,
      name: "The Mermaid & Mask",
      discountPercent: 20,
      finalPrice: 6160,
      originalPrice: 7700,
      finalPriceText: "¥ 61.60",
      reviewSummary: "特别好评",
      reviewPercent: 99,
      currency: "CNY",
    });
    expect(first!.platforms).toEqual({ windows: true, mac: false, linux: true });
    expect(first!.storeUrl).toBe("https://store.steampowered.com/app/1696770");

    expect(second!.appId).toBe(1245620);
    expect(second!.discountPercent).toBe(50);
    expect(second!.reviewSummary).toBeUndefined();
  });

  it("忽略没有折扣的条目并去重", () => {
    const noDiscount = SEARCH_HTML.replace('data-discount="50"', 'data-discount="0"');
    expect(parseSearchResults(noDiscount)).toHaveLength(1);
    const duplicated = SEARCH_HTML + SEARCH_HTML;
    expect(parseSearchResults(duplicated)).toHaveLength(2);
  });

  it("空输入安全返回", () => {
    expect(parseSearchResults("")).toEqual([]);
    expect(parseSearchResults("<div>nothing</div>")).toEqual([]);
  });
});

describe("parseFeaturedSpecials", () => {
  it("提取每日特惠并换算结束时间", () => {
    const deals = parseFeaturedSpecials({
      dailydeal: {
        items: [
          {
            id: 1091500,
            name: "Cyberpunk 2077",
            discount_percent: 60,
            original_price: 29800,
            final_price: 11920,
            currency: "CNY",
            discount_expiration: 1793903078,
            windows_available: true,
            linux_available: false,
            header_image: "https://cdn.example/cp.jpg",
          },
        ],
      },
      specials: { items: [{ id: 570, name: "Dota 2", discount_percent: 0 }] },
    });
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({ appId: 1091500, discountPercent: 60, finalPrice: 11920 });
    expect(deals[0]!.discountEndsAt).toBe(1793903078000);
    expect(deals[0]!.platforms).toEqual({ windows: true, mac: false, linux: false });
  });
});

describe("parseAppDetails", () => {
  it("读取 price_overview 与简介", () => {
    const body = JSON.stringify({
      "1245620": {
        success: true,
        data: {
          name: "ELDEN RING",
          header_image: "https://cdn.example/elden.jpg",
          price_overview: {
            currency: "CNY",
            initial: 29800,
            final: 14900,
            discount_percent: 50,
            initial_formatted: "¥ 298.00",
            final_formatted: "¥ 149.00",
          },
          platforms: { windows: true, mac: false, linux: false },
          release_date: { date: "2022 年 2 月 24 日" },
          short_description: "黄金树之影",
          developers: ["FromSoftware, Inc."],
        },
      },
    });
    const deal = parseAppDetails(body, 1245620);
    expect(deal).toMatchObject({
      appId: 1245620,
      name: "ELDEN RING",
      discountPercent: 50,
      finalPrice: 14900,
      originalPrice: 29800,
      finalPriceText: "¥ 149.00",
      description: "黄金树之影",
    });
  });

  it("处理免费游戏与失败响应", () => {
    const free = parseAppDetails(JSON.stringify({ "730": { success: true, data: { name: "CS2", is_free: true } } }), 730);
    expect(free?.finalPrice).toBeUndefined();
    expect(free?.discountPercent).toBe(0);
    expect(parseAppDetails(JSON.stringify({ "1": { success: false } }), 1)).toBeNull();
    expect(parseAppDetails("null", 1)).toBeNull();
    expect(parseAppDetails("{oops", 1)).toBeNull();
  });
});

describe("parseStoreSearch", () => {
  it("根据原价与现价推算折扣", () => {
    const hits = parseStoreSearch({
      items: [
        {
          type: "app",
          id: 1245620,
          name: "艾尔登法环",
          tiny_image: "https://cdn.example/e.jpg",
          price: { currency: "CNY", initial: 29800, final: 14900 },
          platforms: { windows: true, mac: false, linux: false },
        },
        { type: "dlc", id: 1, name: "DLC" },
      ],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ appId: 1245620, discountPercent: 50, price: 14900, originalPrice: 29800 });
  });
});

describe("文本工具", () => {
  it("解码 HTML 实体与去除标签", () => {
    expect(decodeEntities("Tom &amp; Jerry &lt;3 &#39;x&#39;")).toBe("Tom & Jerry <3 'x'");
    expect(stripTags("<b>Hello</b>&nbsp;<i>world</i>")).toBe("Hello world");
  });

  it("生成带区域的搜索链接", () => {
    const url = buildDealsUrl({ country: "cn", language: "schinese" }, 2, 100);
    expect(url).toContain("start=200");
    expect(url).toContain("specials=1");
    expect(url).toContain("cc=cn");
    expect(url).toContain("l=schinese");
  });
});


const REVIEWS_HTML = `
<div id="page1">
  <div data-panel="{&quot;focusable&quot;:true}" role="button" class="apphub_Card modalContentLink interactable" data-modal-content-url="https://steamcommunity.com/profiles/76561198038703897/recommended/1245620/">
    <div class="apphub_CardContentMain">
      <div class="found_helpful">2,669 people found this review helpful<br>2,851 people found this review funny</div>
      <div class="title">Recommended</div>
      <div class="hours">157.6 hrs on record</div>
      <div class="apphub_CardTextContent">
        <div class="date_posted">Posted: 19 January, 2023</div>
        这是一条用于测试的评价文本，包含 <div class="bb_h1">嵌套标签</div><br>以及 HTML 实体 &amp; 换行。
      </div>
      <div class="apphub_CardCommentCount alignNews">16</div>
      <div class="apphub_CardContentAuthorBlock tall">
        <div class="apphub_CardContentAuthorName offline ellipsis"><a href="https://steamcommunity.com/profiles/76561198038703897/">shawnpeat</a></div>
      </div>
    </div>
  </div>
  <div data-panel="{&quot;focusable&quot;:true}" role="button" class="apphub_Card modalContentLink interactable" data-modal-content-url="https://steamcommunity.com/id/angryplayer/recommended/1245620/">
    <div class="apphub_CardContentMain">
      <div class="found_helpful">12 people found this review helpful</div>
      <div class="title">Not Recommended</div>
      <div class="hours">3.2 hrs on record</div>
      <div class="apphub_CardTextContent">
        <div class="date_posted">Posted: 2 March, 2024</div>
        优化太差，帧数不稳。<br>等打折再买。
      </div>
      <div class="apphub_CardCommentCount alignNews">0</div>
      <div class="apphub_CardContentAuthorBlock tall">
        <div class="apphub_CardContentAuthorName offline ellipsis"><a href="https://steamcommunity.com/id/angryplayer/">暴躁老哥</a></div>
      </div>
    </div>
  </div>
</div>
<form method="GET" id="MoreContentForm1" name="MoreContentForm1" action="https://steamcommunity.com/app/1245620/homecontent/">
  <input type="hidden" name="userreviewscursor" value="AoIIP3XTJHe8gNQD">
  <input type="hidden" name="userreviewsoffset" value="10">
  <input type="hidden" name="p" value="2">
  <input type="hidden" name="browsefilter" value="toprated">
</form>
`;

describe("parseReviewsHtml", () => {
  it("解析推荐/不推荐、正文、时长、日期与互动数", () => {
    const page = parseReviewsHtml(REVIEWS_HTML);
    expect(page.reviews).toHaveLength(2);

    const [positive, negative] = page.reviews;
    expect(positive).toMatchObject({
      author: "shawnpeat",
      votedUp: true,
      playtimeHours: 157.6,
      helpful: 2669,
      funny: 2851,
      comments: 16,
      postedText: "19 January, 2023",
    });
    expect(positive!.text).toContain("这是一条用于测试的评价文本");
    expect(positive!.text).toContain("嵌套标签");
    expect(positive!.text).toContain("以及 HTML 实体 & 换行");
    expect(positive!.postedAt).toBe(Date.UTC(2023, 0, 19, 12));

    expect(negative).toMatchObject({ author: "暴躁老哥", votedUp: false, playtimeHours: 3.2, helpful: 12 });
    expect(negative!.text).toBe("优化太差，帧数不稳。\n等打折再买。");
  });

  it("解析下一页表单参数", () => {
    const page = parseReviewsHtml(REVIEWS_HTML);
    expect(page.hasMore).toBe(true);
    expect(page.next).toMatchObject({ userreviewscursor: "AoIIP3XTJHe8gNQD", userreviewsoffset: "10", p: "2" });
  });

  it("没有表单时 hasMore 为 false，空 HTML 安全返回", () => {
    const page = parseReviewsHtml(REVIEWS_HTML.replace(/<form[\s\S]*?<\/form>/, ""));
    expect(page.hasMore).toBe(false);
    expect(parseReviewsHtml("")).toEqual({ reviews: [], next: undefined, hasMore: false });
  });
});

describe("parsePostedDate", () => {
  it("解析英文日期", () => {
    expect(parsePostedDate("19 January, 2023")).toBe(Date.UTC(2023, 0, 19, 12));
    expect(parsePostedDate("2 March, 2024")).toBe(Date.UTC(2024, 2, 2, 12));
    expect(parsePostedDate("not a date")).toBeUndefined();
    expect(parsePostedDate(undefined)).toBeUndefined();
  });
});
