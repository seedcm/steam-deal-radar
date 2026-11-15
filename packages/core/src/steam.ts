import { regionCurrency } from "./format";
import type { Deal, GameReview, Platforms, ReviewPage, SearchHit, Settings } from "./types";

const STORE = "https://store.steampowered.com";
const API = "https://api.steampowered.com";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-zA-Z#0-9]+);/g, (m, name: string) => ENTITIES[name] ?? m);
}

export function stripTags(input: string): string {
  return decodeEntities(input.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function firstGroup(source: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(source);
  return match ? match[1] : undefined;
}

function parsePlatforms(source: string): Platforms {
  return {
    windows: /platform_img win\b/.test(source),
    mac: /platform_img mac\b/.test(source),
    linux: /platform_img linux\b/.test(source),
  };
}

/**
 * 解析 https://store.steampowered.com/search/results/?specials=1&infinite=1 返回的 results_html。
 * Steam 未提供官方 JSON 折扣列表接口，这里解析稳定的服务端渲染片段。
 */
export function parseSearchResults(html: string, currency = "CNY"): Deal[] {
  if (!html) return [];
  const deals: Deal[] = [];
  const seen = new Set<number>();
  const blocks = html.split('data-ds-appid="').slice(1);

  for (const block of blocks) {
    const appIdRaw = /^(\d+)/.exec(block)?.[1];
    if (!appIdRaw) continue;
    const appId = Number(appIdRaw);
    if (seen.has(appId)) continue;

    const name = stripTags(firstGroup(block, /<span class="title">([\s\S]*?)<\/span>/) ?? "");
    if (!name) continue;

    const discountPercent = Number(firstGroup(block, /data-discount="(-?\d+)"/) ?? 0);
    if (!Number.isFinite(discountPercent) || discountPercent <= 0) continue;

    const finalCents = Number(firstGroup(block, /data-price-final="(\d+)"/) ?? NaN);
    const originalText = firstGroup(block, /discount_original_price[^"]*">([^<]*)</);
    const finalText = firstGroup(block, /discount_final_price[^"]*">([^<]*)</);
    const tooltip = decodeEntities(firstGroup(block, /data-tooltip-html="([^"]*)"/) ?? "");
    const reviewSummary = tooltip ? stripTags(tooltip.split(/<br\s*\/?>/i)[0] ?? "") : undefined;
    const reviewPercent = tooltip ? Number(firstGroup(tooltip, /(\d+)\s*%/) ?? NaN) : NaN;

    seen.add(appId);
    deals.push({
      appId,
      name,
      image: firstGroup(block, /<div class="search_capsule">\s*<img src="([^"]+)"/),
      discountPercent,
      originalPrice: Number.isFinite(finalCents)
        ? Math.round(finalCents / (1 - discountPercent / 100))
        : undefined,
      finalPrice: Number.isFinite(finalCents) ? finalCents : undefined,
      originalPriceText: originalText ? decodeEntities(originalText).trim() : undefined,
      finalPriceText: finalText ? decodeEntities(finalText).trim() : undefined,
      currency,
      platforms: parsePlatforms(block),
      releaseDate: stripTags(firstGroup(block, /search_released[^"]*">([\s\S]*?)<\/div>/) ?? "") || undefined,
      reviewSummary: reviewSummary || undefined,
      reviewPercent: Number.isFinite(reviewPercent) ? reviewPercent : undefined,
      storeUrl: `${STORE}/app/${appId}`,
    });
  }

  return deals;
}

/** 解析 search/results 的 JSON 包装（infinite=1 时返回 { results_html }） */
export function parseSearchPayload(body: string, currency = "CNY"): Deal[] {
  try {
    const json = JSON.parse(body) as { results_html?: string };
    return parseSearchResults(json.results_html ?? "", currency);
  } catch {
    return parseSearchResults(body, currency);
  }
}

/** 解析首页特惠 / 每日特惠接口，补充折扣截止时间等信息 */
export function parseFeaturedSpecials(payload: unknown): Deal[] {
  if (!payload || typeof payload !== "object") return [];
  const deals = new Map<number, Deal>();
  const push = (item: Record<string, unknown>) => {
    const appId = Number(item.id);
    if (!Number.isFinite(appId) || appId <= 0) return;
    const discountPercent = Number(item.discount_percent ?? 0);
    if (!discountPercent) return;
    const expiration = Number(item.discount_expiration ?? 0);
    const deal: Deal = {
      appId,
      name: String(item.name ?? ""),
      image: (item.header_image as string) ?? (item.large_capsule_image as string) ?? undefined,
      discountPercent,
      originalPrice: Number.isFinite(Number(item.original_price)) ? Number(item.original_price) : undefined,
      finalPrice: Number.isFinite(Number(item.final_price)) ? Number(item.final_price) : undefined,
      currency: (item.currency as string) ?? undefined,
      platforms: {
        windows: Boolean(item.windows_available ?? true),
        mac: Boolean(item.mac_available ?? false),
        linux: Boolean(item.linux_available ?? false),
      },
      discountEndsAt: expiration > 0 ? expiration * 1000 : undefined,
      storeUrl: `${STORE}/app/${appId}`,
    };
    deals.set(appId, deal);
  };

  for (const value of Object.values(payload as Record<string, unknown>)) {
    const section = value as { items?: Array<Record<string, unknown>> } | undefined;
    if (!section?.items) continue;
    for (const item of section.items) push(item);
  }
  return [...deals.values()];
}

/** 解析 appdetails（单个 appid），用于关注列表的价格刷新与详情补充 */
export function parseAppDetails(body: string, appId: number): Deal | null {
  let json: Record<string, { success?: boolean; data?: unknown }>;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const entry = json?.[String(appId)];
  if (!entry?.success || !entry.data || Array.isArray(entry.data)) return null;
  const data = entry.data as Record<string, any>;
  const price = data.price_overview as Record<string, any> | undefined;
  const storeUrl = `${STORE}/app/${appId}`;
  return {
    appId,
    name: String(data.name ?? `App ${appId}`),
    image: data.header_image as string | undefined,
    discountPercent: Number(price?.discount_percent ?? 0),
    originalPrice: price ? Number(price.initial) : undefined,
    finalPrice: price ? Number(price.final) : undefined,
    originalPriceText: price?.initial_formatted as string | undefined,
    finalPriceText: price?.final_formatted as string | undefined,
    currency: price?.currency as string | undefined,
    platforms: {
      windows: Boolean(data.platforms?.windows),
      mac: Boolean(data.platforms?.mac),
      linux: Boolean(data.platforms?.linux),
    },
    releaseDate: data.release_date?.date as string | undefined,
    description: data.short_description as string | undefined,
    developers: data.developers as string[] | undefined,
    storeUrl,
  };
}

/** 解析 storesearch，用于「全站搜索」 */
export function parseStoreSearch(payload: unknown): SearchHit[] {
  const items = (payload as { items?: Array<Record<string, any>> })?.items ?? [];
  const hits: SearchHit[] = [];
  for (const item of items) {
    if (item.type && item.type !== "app") continue;
    const appId = Number(item.id);
    if (!Number.isFinite(appId)) continue;
    const price = item.price as { initial?: number; final?: number; currency?: string } | undefined;
    const initial = Number(price?.initial ?? NaN);
    const final = Number(price?.final ?? NaN);
    const discountPercent = initial > 0 && final >= 0 ? Math.round(((initial - final) / initial) * 100) : 0;
    hits.push({
      appId,
      name: decodeEntities(String(item.name ?? "")),
      image: item.tiny_image as string | undefined,
      price: Number.isFinite(final) ? final : undefined,
      originalPrice: Number.isFinite(initial) ? initial : undefined,
      discountPercent: Math.max(0, discountPercent),
      currency: price?.currency,
      platforms: {
        windows: Boolean(item.platforms?.windows),
        mac: Boolean(item.platforms?.mac),
        linux: Boolean(item.platforms?.linux),
      },
      storeUrl: `${STORE}/app/${appId}`,
      reviewPercent: item.metascore ? Number(item.metascore) : undefined,
    });
  }
  return hits;
}

export interface DealQueryOptions {
  country: string;
  language: string;
}

export function buildDealsUrl(opts: DealQueryOptions, page: number, pageSize = 100): string {
  const params = new URLSearchParams({
    query: "",
    start: String(page * pageSize),
    count: String(pageSize),
    specials: "1",
    infinite: "1",
    sort_by: "Reviews_DESC",
    cc: opts.country,
    l: opts.language,
    infinite_scroll: "1",
  });
  return `${STORE}/search/results/?${params.toString()}`;
}

export function buildFeaturedUrl(opts: DealQueryOptions): string {
  const params = new URLSearchParams({ cc: opts.country, l: opts.language });
  return `${STORE}/api/featuredcategories?${params.toString()}`;
}

export function buildAppDetailsUrl(appId: number, opts: DealQueryOptions): string {
  const params = new URLSearchParams({ appids: String(appId), cc: opts.country, l: opts.language });
  return `${STORE}/api/appdetails?${params.toString()}`;
}

export function buildStoreSearchUrl(term: string, opts: DealQueryOptions): string {
  const params = new URLSearchParams({ term, cc: opts.country, l: opts.language });
  return `${STORE}/api/storesearch/?${params.toString()}`;
}

export function wishlistApiUrl(steamId: string): string {
  return `${API}/IWishlistService/GetWishlist/v1/?steamid=${encodeURIComponent(steamId)}`;
}

export function settingsCurrency(settings: Settings): string {
  return regionCurrency(settings.country);
}

/* ---------- 评测详情（社区页面，按官方「最有帮助」排序） ---------- */

const COMMUNITY = "https://steamcommunity.com";

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

export function buildReviewsUrl(appId: number, language?: string): string {
  const params = new URLSearchParams({ browsefilter: "toprated", l: "english", snr: "1_5_100010_" });
  // language 为 undefined / "all" 时不带 filterLanguage，Steam 会返回全部语言
  if (language && language !== "all") params.set("filterLanguage", language);
  return `${COMMUNITY}/app/${appId}/reviews/?${params.toString()}`;
}

export function buildReviewsMoreUrl(appId: number, next: Record<string, string>): string {
  return `${COMMUNITY}/app/${appId}/homecontent/?${new URLSearchParams(next).toString()}`;
}

function numberFrom(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** "19 January, 2023" -> 时间戳 */
export function parsePostedDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/.exec(value);
  if (!match) return undefined;
  const month = MONTHS[match[2]!.toLowerCase()];
  if (month == null) return undefined;
  return Date.UTC(Number(match[3]), month, Number(match[1]), 12);
}

/** 取从 contentStart 开始的那个 div 的完整内部 HTML（正确处理嵌套） */
function sliceDiv(html: string, contentStart: number): string {
  let depth = 1;
  const tag = /<\/?div\b[^>]*>/gi;
  tag.lastIndex = contentStart;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html))) {
    if (match[0].startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(contentStart, match.index);
  }
  return html.slice(contentStart);
}

/** 评测正文：保留换行，去掉标签与实体 */
export function reviewTextFromHtml(raw: string): string {
  const withBreaks = raw.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n");
  return decodeEntities(withBreaks.replace(/<[^>]*>/g, " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** 解析社区评测页（第一页）或 homecontent 分页片段 */
export function parseReviewsHtml(html: string): ReviewPage {
  const reviews: GameReview[] = [];
  const blocks = html.split('class="apphub_Card ').slice(1);

  blocks.forEach((block, index) => {
    if (!block.includes("apphub_CardTextContent")) return;

    const url = /data-modal-content-url="https:\/\/steamcommunity\.com\/(profiles|id)\/([^/"?]+)\/recommended\/(\d+)\/"/.exec(block);
    const author = /apphub_CardContentAuthorName[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    const title = /<div class="title">([^<]+)<\/div>/.exec(block);
    const hours = /class="hours">([\d.,]+)\s*hrs on record/.exec(block);
    const date = /class="date_posted">\s*Posted:\s*([^<]+)<\/div>/.exec(block);
    const helpful = /([\d,]+)\s+people found this review helpful/.exec(block);
    const funny = /([\d,]+)\s+people found this review funny/.exec(block);
    const comments = /apphub_CardCommentCount[^>]*>\s*([\d,]+)\s*</.exec(block);

    const contentTag = 'apphub_CardTextContent">';
    const contentIndex = block.indexOf(contentTag);
    const rawText = contentIndex >= 0 ? sliceDiv(block, contentIndex + contentTag.length) : "";
    const postedText = date?.[1]?.trim();
    const postedAt = parsePostedDate(postedText);
    const profileKey = url ? `${url[1]}/${url[2]}` : `anon-${index}`;

    reviews.push({
      id: `${profileKey}:${postedAt ?? index}`,
      author: stripTags(author?.[2] ?? "Steam 用户"),
      profileUrl: author?.[1],
      votedUp: !/Not Recommended/i.test(title?.[1] ?? "Recommended"),
      text: reviewTextFromHtml(rawText.replace(/<div class="date_posted">[\s\S]*?<\/div>/, "")),
      postedAt,
      postedText,
      playtimeHours: hours ? Number(hours[1].replace(/,/g, ".")) : undefined,
      helpful: numberFrom(helpful?.[1]),
      funny: numberFrom(funny?.[1]),
      comments: numberFrom(comments?.[1]),
    });
  });

  // 下一页参数来自 Steam 自己的「更多内容」表单
  let next: Record<string, string> | undefined;
  const form = /<form[^>]*id="MoreContentForm\d+"[\s\S]*?<\/form>/.exec(html);
  if (form) {
    const params: Record<string, string> = {};
    for (const match of form[0].matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)) {
      params[match[1]!] = decodeEntities(match[2] ?? "");
    }
    if (params.userreviewscursor) next = params;
  }

  return { reviews, next, hasMore: Boolean(next) };
}
