/**
 * Steam 数据抓取与解析。
 *
 * 规则逐条移植自 packages/core/src/steam.ts：
 * - 折扣列表没有官方 JSON 接口，解析 search/results 返回的 results_html；
 * - 每日特惠用 featuredcategories，补齐 discountEndsAt；
 * - 单个游戏用 appdetails（关注列表里不在折扣页的游戏要靠它刷新价格）；
 * - 搜索用 storesearch。
 *
 * 网络层使用 @ohos.net.http，20 秒超时，带桌面端一致的 UA 与中文 Accept-Language。
 */

import http from '@ohos.net.http';
import {
  Deal,
  GameReview,
  Platforms,
  regionCurrency,
  ReviewPage,
  SearchHit,
  Settings,
  TranslationResult
} from './Types';

const STORE: string = 'https://store.steampowered.com';
const COMMUNITY: string = 'https://steamcommunity.com';
const USER_AGENT: string =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const ACCEPT_LANGUAGE: string = 'zh-CN,zh;q=0.9';
const ACCEPT: string = 'application/json,text/html;q=0.9,*/*;q=0.8';
const TIMEOUT_MS: number = 20_000;

/* ---------- HTML 实体与文本处理 ---------- */

function entityValue(name: string): string | undefined {
  switch (name) {
    case 'amp':
      return '&';
    case 'lt':
      return '<';
    case 'gt':
      return '>';
    case 'quot':
      return '"';
    case 'apos':
      return "'";
    case 'nbsp':
      return ' ';
    case '#39':
      return "'";
    case 'hellip':
      return '…';
    case 'mdash':
      return '—';
    case 'ndash':
      return '–';
    case 'rsquo':
      return '’';
    case 'lsquo':
      return '‘';
    case 'ldquo':
      return '“';
    case 'rdquo':
      return '”';
    case 'middot':
      return '·';
    case 'yen':
      return '¥';
    case 'euro':
      return '€';
    case 'pound':
      return '£';
    case 'cent':
      return '¢';
    case 'copy':
      return '©';
    case 'reg':
      return '®';
    case 'trade':
      return '™';
    case 'times':
      return '×';
    default:
      return undefined;
  }
}

/** 与 core/steam.ts 的 decodeEntities 一致（额外覆盖数字实体） */
export function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (match: string, code: string): string => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (match: string, code: string): string =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replace(/&([a-zA-Z#0-9]+);/g, (match: string, name: string): string => {
      const value = entityValue(name);
      return value !== undefined ? value : match;
    });
}

/** 去标签 + 解实体 + 折叠空白 */
export function stripTags(input: string): string {
  return decodeEntities(input.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function firstGroup(source: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(source);
  if (match === null || match.length < 2) {
    return undefined;
  }
  return match[1];
}

/* ---------- JSON 字段安全读取 ---------- */

function asString(value: Object | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: Object | undefined, fallback: number): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function asOptionalNumber(value: Object | undefined): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asBoolean(value: Object | undefined, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return fallback;
}

function asStringArray(value: Object | undefined): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const source = value as Object[];
  const result: string[] = [];
  for (const item of source) {
    if (typeof item === 'string') {
      result.push(item);
    }
  }
  return result;
}

function readObject(value: Object | undefined): Record<string, Object> | null {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, Object>;
}

function parsePlatforms(source: string): Platforms {
  const platforms: Platforms = {
    windows: /platform_img win\b/.test(source),
    mac: /platform_img mac\b/.test(source),
    linux: /platform_img linux\b/.test(source)
  };
  return platforms;
}

/* ---------- 折扣列表 ---------- */

/**
 * 解析 search/results/?specials=1&infinite=1 返回的 results_html。
 * 每条折扣是一段以 data-ds-appid="ID" 开头的 HTML 片段。
 */
export function parseSearchResults(html: string, currency: string): Deal[] {
  const deals: Deal[] = [];
  if (html.length === 0) {
    return deals;
  }
  const seen = new Set<number>();
  const blocks = html.split('data-ds-appid="');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    if (block === undefined) {
      continue;
    }
    const appIdText = firstGroup(block, /^(\d+)/);
    if (appIdText === undefined) {
      continue;
    }
    const appId = Number(appIdText);
    if (seen.has(appId)) {
      continue;
    }

    const name = stripTags(firstGroup(block, /<span class="title">([\s\S]*?)<\/span>/) ?? '');
    if (name.length === 0) {
      continue;
    }

    const discountText = firstGroup(block, /data-discount="(-?\d+)"/);
    const discountPercent = discountText === undefined ? 0 : Number(discountText);
    if (!Number.isFinite(discountPercent) || discountPercent <= 0) {
      continue;
    }

    const finalText = firstGroup(block, /data-price-final="(\d+)"/);
    const finalCents = finalText === undefined ? NaN : Number(finalText);
    const originalText = firstGroup(block, /discount_original_price[^"]*">([^<]*)</);
    const discountFinalText = firstGroup(block, /discount_final_price[^"]*">([^<]*)</);

    const tooltipRaw = firstGroup(block, /data-tooltip-html="([^"]*)"/);
    const tooltip = decodeEntities(tooltipRaw ?? '');
    let reviewSummary: string | undefined = undefined;
    let reviewPercent: number | undefined = undefined;
    if (tooltip.length > 0) {
      const parts = tooltip.split(/<br\s*\/?>/i);
      const summary = stripTags(parts.length > 0 ? (parts[0] ?? tooltip) : tooltip);
      reviewSummary = summary.length > 0 ? summary : undefined;
      const percentText = firstGroup(tooltip, /(\d+)\s*%/);
      const percent = percentText === undefined ? NaN : Number(percentText);
      reviewPercent = Number.isFinite(percent) ? percent : undefined;
    }

    const releaseRaw = firstGroup(block, /search_released[^"]*">([\s\S]*?)<\/div>/);
    const releaseDate = releaseRaw !== undefined ? stripTags(releaseRaw) : undefined;
    // Steam 实际输出是 <div class="col search_capsule"><img ...>，这里兼容带其他 class 的写法
    const image = firstGroup(block, /class="[^"]*search_capsule[^"]*"[^>]*>\s*<img[^>]*\ssrc="([^"]+)"/);

    // data-price-final 是最小货币单位（分）。原价按折扣反推，100% 折扣时不反推，避免除以 0。
    let originalPrice: number | undefined = undefined;
    if (Number.isFinite(finalCents) && discountPercent < 100) {
      originalPrice = Math.round(finalCents / (1 - discountPercent / 100));
    }

    const deal: Deal = {
      appId: appId,
      name: name,
      image: image,
      discountPercent: discountPercent,
      originalPrice: originalPrice,
      finalPrice: Number.isFinite(finalCents) ? finalCents : undefined,
      originalPriceText: originalText !== undefined ? decodeEntities(originalText).trim() : undefined,
      finalPriceText: discountFinalText !== undefined ? decodeEntities(discountFinalText).trim() : undefined,
      currency: currency,
      platforms: parsePlatforms(block),
      releaseDate: releaseDate !== undefined && releaseDate.length > 0 ? releaseDate : undefined,
      reviewSummary: reviewSummary,
      reviewPercent: reviewPercent,
      storeUrl: `${STORE}/app/${appId}`
    };

    seen.add(appId);
    deals.push(deal);
  }
  return deals;
}

/** 解析 search/results 的 JSON 包装（infinite=1 时返回 { results_html }） */
export function parseSearchPayload(body: string, currency: string): Deal[] {
  try {
    const json = JSON.parse(body) as Record<string, Object>;
    const html = json['results_html'];
    if (typeof html === 'string') {
      return parseSearchResults(html, currency);
    }
    return parseSearchResults(body, currency);
  } catch (err) {
    return parseSearchResults(body, currency);
  }
}

/* ---------- 每日特惠 ---------- */

/** 解析 featuredcategories：遍历所有分组里的 items，补上 discountEndsAt */
export function parseFeaturedSpecials(payload: Object): Deal[] {
  const byId = new Map<number, Deal>();
  if (payload === null || typeof payload !== 'object') {
    return [];
  }
  const root = payload as Record<string, Object>;
  for (const sectionKey of Object.keys(root)) {
    const section = readObject(root[sectionKey]);
    if (section === null) {
      continue;
    }
    const itemsValue = section['items'];
    if (itemsValue === undefined || !Array.isArray(itemsValue)) {
      continue;
    }
    const items = itemsValue as Object[];
    for (const itemValue of items) {
      const item = readObject(itemValue);
      if (item === null) {
        continue;
      }
      const appId = asNumber(item['id'], 0);
      if (!Number.isFinite(appId) || appId <= 0) {
        continue;
      }
      const discountPercent = asNumber(item['discount_percent'], 0);
      if (discountPercent <= 0) {
        continue;
      }
      const expiration = asNumber(item['discount_expiration'], 0);
      const platforms: Platforms = {
        windows: asBoolean(item['windows_available'], true),
        mac: asBoolean(item['mac_available'], false),
        linux: asBoolean(item['linux_available'], false)
      };
      const headerImage = asString(item['header_image']);
      const capsuleImage = asString(item['large_capsule_image']);
      const deal: Deal = {
        appId: appId,
        name: asString(item['name']) ?? '',
        image: headerImage !== undefined ? headerImage : capsuleImage,
        discountPercent: discountPercent,
        originalPrice: asOptionalNumber(item['original_price']),
        finalPrice: asOptionalNumber(item['final_price']),
        currency: asString(item['currency']),
        platforms: platforms,
        discountEndsAt: expiration > 0 ? expiration * 1000 : undefined,
        storeUrl: `${STORE}/app/${appId}`
      };
      byId.set(appId, deal);
    }
  }
  const result: Deal[] = [];
  byId.forEach((deal: Deal) => {
    result.push(deal);
  });
  return result;
}

/* ---------- 单个游戏详情 ---------- */

/** 解析 appdetails（单个 appid），用于关注列表补价与详情展示 */
export function parseAppDetails(body: string, appId: number): Deal | null {
  let parsed: Record<string, Object>;
  try {
    parsed = JSON.parse(body) as Record<string, Object>;
  } catch (err) {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return null;
  }
  const entry = readObject(parsed[String(appId)]);
  if (entry === null) {
    return null;
  }
  if (!asBoolean(entry['success'], false)) {
    return null;
  }
  const data = readObject(entry['data']);
  if (data === null) {
    return null;
  }

  const price = readObject(data['price_overview']);
  const platformsValue = readObject(data['platforms']);
  const platforms: Platforms = {
    windows: platformsValue !== null ? asBoolean(platformsValue['windows'], false) : false,
    mac: platformsValue !== null ? asBoolean(platformsValue['mac'], false) : false,
    linux: platformsValue !== null ? asBoolean(platformsValue['linux'], false) : false
  };
  const release = readObject(data['release_date']);

  const deal: Deal = {
    appId: appId,
    name: asString(data['name']) ?? `App ${appId}`,
    image: asString(data['header_image']),
    discountPercent: price !== null ? asNumber(price['discount_percent'], 0) : 0,
    originalPrice: price !== null ? asOptionalNumber(price['initial']) : undefined,
    finalPrice: price !== null ? asOptionalNumber(price['final']) : undefined,
    originalPriceText: price !== null ? asString(price['initial_formatted']) : undefined,
    finalPriceText: price !== null ? asString(price['final_formatted']) : undefined,
    currency: price !== null ? asString(price['currency']) : undefined,
    platforms: platforms,
    releaseDate: release !== null ? asString(release['date']) : undefined,
    description: asString(data['short_description']),
    developers: asStringArray(data['developers']),
    storeUrl: `${STORE}/app/${appId}`
  };
  return deal;
}

/* ---------- 全站搜索 ---------- */

/** 解析 storesearch，返回 SearchHit[] */
export function parseStoreSearch(payload: Object): SearchHit[] {
  const hits: SearchHit[] = [];
  if (payload === null || typeof payload !== 'object') {
    return hits;
  }
  const root = payload as Record<string, Object>;
  const itemsValue = root['items'];
  if (itemsValue === undefined || !Array.isArray(itemsValue)) {
    return hits;
  }
  const items = itemsValue as Object[];
  for (const itemValue of items) {
    const item = readObject(itemValue);
    if (item === null) {
      continue;
    }
    const type = asString(item['type']);
    if (type !== undefined && type !== 'app') {
      continue;
    }
    const appId = asNumber(item['id'], 0);
    if (!Number.isFinite(appId) || appId <= 0) {
      continue;
    }

    const price = readObject(item['price']);
    const initial = price !== null ? asNumber(price['initial'], NaN) : NaN;
    const final = price !== null ? asNumber(price['final'], NaN) : NaN;
    let discountPercent = 0;
    if (Number.isFinite(initial) && initial > 0 && Number.isFinite(final) && final >= 0) {
      discountPercent = Math.round(((initial - final) / initial) * 100);
    }

    const platformsValue = readObject(item['platforms']);
    const platforms: Platforms = {
      windows: platformsValue !== null ? asBoolean(platformsValue['windows'], false) : false,
      mac: platformsValue !== null ? asBoolean(platformsValue['mac'], false) : false,
      linux: platformsValue !== null ? asBoolean(platformsValue['linux'], false) : false
    };

    const hit: SearchHit = {
      appId: appId,
      name: decodeEntities(asString(item['name']) ?? ''),
      image: asString(item['tiny_image']),
      price: Number.isFinite(final) ? final : undefined,
      originalPrice: Number.isFinite(initial) ? initial : undefined,
      discountPercent: Math.max(0, discountPercent),
      currency: price !== null ? asString(price['currency']) : undefined,
      platforms: platforms,
      storeUrl: `${STORE}/app/${appId}`,
      reviewPercent: asOptionalNumber(item['metascore'])
    };
    hits.push(hit);
  }
  return hits;
}

/* ---------- 评测详情（社区页面，按官方「最有帮助」排序） ---------- */

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
  december: 11
};

/** 去掉千分位后取数字；与 core/steam.ts 的 numberFrom 一致 */
function numberFrom(value: string | undefined): number {
  if (value === undefined || value.length === 0) {
    return 0;
  }
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length === 0) {
    return 0;
  }
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** "19 January, 2023" -> UTC 时间戳（取当天中午，与桌面端一致） */
function parsePostedDate(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const match = /(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/.exec(value);
  if (match === null) {
    return undefined;
  }
  const dayText = match[1];
  const monthText = match[2];
  const yearText = match[3];
  if (dayText === undefined || monthText === undefined || yearText === undefined) {
    return undefined;
  }
  const month = MONTHS[monthText.toLowerCase()];
  if (month === undefined) {
    return undefined;
  }
  return Date.UTC(Number(yearText), month, Number(dayText), 12);
}

/**
 * 取从 contentStart 开始的那个 div 的完整内部 HTML。
 * 必须做标签配对：评测正文里可能嵌套 div，不能直接找第一个 </div>。
 */
function sliceDiv(html: string, contentStart: number): string {
  let depth = 1;
  const tag = /<\/?div\b[^>]*>/gi;
  tag.lastIndex = contentStart;
  let match: RegExpExecArray | null = tag.exec(html);
  while (match !== null) {
    if (match[0].startsWith('</')) {
      depth -= 1;
    } else {
      depth += 1;
    }
    if (depth === 0) {
      return html.slice(contentStart, match.index);
    }
    match = tag.exec(html);
  }
  return html.slice(contentStart);
}

/** 评测正文：<br> 转换行，去掉标签与实体，但保留换行 */
function reviewTextFromHtml(raw: string): string {
  const withBreaks = raw.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
  return decodeEntities(withBreaks.replace(/<[^>]*>/g, ' '))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** 解析社区评测页（第一页）或 homecontent 分页片段 */
export function parseReviewsHtml(html: string): ReviewPage {
  const reviews: GameReview[] = [];
  if (html.length > 0) {
    const blocks = html.split('class="apphub_Card ');
    for (let index = 1; index < blocks.length; index++) {
      const block = blocks[index];
      if (block === undefined || !block.includes('apphub_CardTextContent')) {
        continue;
      }
      // split 后第 0 段是卡片之前的页面内容，卡片序号从 0 开始（与桌面端 slice(1) 后一致）
      const cardIndex = index - 1;

      // 作者主页 URL 既用于 profileUrl，也与发布日期一起拼出稳定的评测 id
      const profileMatch =
        /data-modal-content-url="https:\/\/steamcommunity\.com\/(profiles|id)\/([^/"?]+)\/recommended\/(\d+)\/"/.exec(block);
      let profileKey = `anon-${cardIndex}`;
      if (profileMatch !== null && profileMatch[1] !== undefined && profileMatch[2] !== undefined) {
        profileKey = `${profileMatch[1]}/${profileMatch[2]}`;
      }

      const authorMatch = /apphub_CardContentAuthorName[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
      let author = 'Steam 用户';
      let profileUrl: string | undefined = undefined;
      if (authorMatch !== null && authorMatch[2] !== undefined) {
        author = stripTags(authorMatch[2]);
        profileUrl = authorMatch[1];
      }

      const titleMatch = /<div class="title">([^<]+)<\/div>/.exec(block);
      const title = titleMatch !== null && titleMatch[1] !== undefined ? titleMatch[1] : 'Recommended';
      const votedUp = !/Not Recommended/i.test(title);

      const hoursMatch = /class="hours">([\d.,]+)\s*hrs on record/.exec(block);
      let playtimeHours: number | undefined = undefined;
      if (hoursMatch !== null && hoursMatch[1] !== undefined) {
        playtimeHours = Number(hoursMatch[1].replace(/,/g, '.'));
      }

      const dateMatch = /class="date_posted">\s*Posted:\s*([^<]+)<\/div>/.exec(block);
      const postedText = dateMatch !== null && dateMatch[1] !== undefined ? dateMatch[1].trim() : undefined;
      const postedAt = parsePostedDate(postedText);

      const helpfulText = firstGroup(block, /([\d,]+)\s+people found this review helpful/);
      const funnyText = firstGroup(block, /([\d,]+)\s+people found this review funny/);
      const commentsText = firstGroup(block, /apphub_CardCommentCount[^>]*>\s*([\d,]+)\s*</);

      // 正文从 apphub_CardTextContent"> 之后开始，按 div 配对截取；再剥掉其中的 date_posted
      const contentTag: string = 'apphub_CardTextContent">';
      const contentIndex = block.indexOf(contentTag);
      const rawText = contentIndex >= 0 ? sliceDiv(block, contentIndex + contentTag.length) : '';
      const text = reviewTextFromHtml(rawText.replace(/<div class="date_posted">[\s\S]*?<\/div>/, ''));

      const postedSuffix = postedAt !== undefined ? String(postedAt) : String(cardIndex);
      const review: GameReview = {
        id: `${profileKey}:${postedSuffix}`,
        author: author,
        profileUrl: profileUrl,
        votedUp: votedUp,
        text: text,
        postedAt: postedAt,
        postedText: postedText,
        playtimeHours: playtimeHours,
        helpful: numberFrom(helpfulText),
        funny: numberFrom(funnyText),
        comments: numberFrom(commentsText)
      };
      reviews.push(review);
    }
  }

  // 下一页参数来自 Steam 自己的「更多内容」表单；没有 userreviewscursor 说明没有下一页
  let next: Record<string, string> | undefined = undefined;
  const formMatch = /<form[^>]*id="MoreContentForm\d+"[\s\S]*?<\/form>/.exec(html);
  if (formMatch !== null) {
    const params: Record<string, string> = {};
    const inputPattern = /<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g;
    let inputMatch: RegExpExecArray | null = inputPattern.exec(formMatch[0]);
    while (inputMatch !== null) {
      const name = inputMatch[1];
      const value = inputMatch[2];
      if (name !== undefined) {
        params[name] = decodeEntities(value !== undefined ? value : '');
      }
      inputMatch = inputPattern.exec(formMatch[0]);
    }
    const cursor = params['userreviewscursor'];
    if (cursor !== undefined && cursor.length > 0) {
      next = params;
    }
  }

  const page: ReviewPage = {
    reviews: reviews,
    next: next,
    hasMore: next !== undefined
  };
  return page;
}

/* ---------- URL 构造 ---------- */

export function buildDealsUrl(settings: Settings, page: number): string {
  return (
    `${STORE}/search/results/?query=&start=${page * 100}&count=100&specials=1&infinite=1` +
    `&sort_by=Reviews_DESC&cc=${settings.country}&l=${settings.language}`
  );
}

export function buildFeaturedUrl(settings: Settings): string {
  return `${STORE}/api/featuredcategories?cc=${settings.country}&l=${settings.language}`;
}

export function buildAppDetailsUrl(appId: number, settings: Settings): string {
  return `${STORE}/api/appdetails?appids=${appId}&cc=${settings.country}&l=${settings.language}`;
}

export function buildStoreSearchUrl(term: string, settings: Settings): string {
  return `${STORE}/api/storesearch/?term=${encodeURIComponent(term)}&cc=${settings.country}&l=${settings.language}`;
}

/**
 * 第一页：社区评测页（Steam 官方「最有帮助」排序）。
 * l 固定 english，否则日期/推荐文案会被本地化，parseReviewsHtml 会解析失败；
 * language 为 undefined / 空串 / "all" 时不带 filterLanguage，Steam 返回全部语言。
 */
export function buildReviewsUrl(appId: number, language?: string): string {
  let url = `${COMMUNITY}/app/${appId}/reviews/?browsefilter=toprated&l=english&snr=1_5_100010_`;
  if (language !== undefined && language.length > 0 && language !== 'all') {
    url += `&filterLanguage=${encodeFormComponent(language)}`;
  }
  return url;
}

/** 后续页：拼接上一页返回的 next 表单参数 */
export function buildReviewsMoreUrl(appId: number, next: Record<string, string>): string {
  const parts: string[] = [];
  for (const key of Object.keys(next)) {
    const value = next[key];
    if (value !== undefined) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return `${COMMUNITY}/app/${appId}/homecontent/?${parts.join('&')}`;
}

/* ---------- 免费在线翻译（规则移植自 packages/core/src/translate.ts） ---------- */

export const MYMEMORY_ENDPOINT: string = 'https://api.mymemory.translated.net/get';
export const GOOGLE_ENDPOINT: string = 'https://translate.googleapis.com/translate_a/single';
export const MAX_TRANSLATE_CHUNK: number = 450;
export const MAX_TRANSLATE_CHUNKS: number = 8;

/** 与 URLSearchParams 的序列化结果一致（空格转 +，! ' ( ) ~ 也转义） */
function encodeFormComponent(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/[!'()~]/g, (ch: string): string => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** MyMemory：单次最多 500 字符，自动识别源语言 */
export function buildMyMemoryUrl(text: string, target: string = 'zh-CN'): string {
  return `${MYMEMORY_ENDPOINT}?q=${encodeFormComponent(text)}&langpair=${encodeFormComponent(`Autodetect|${target}`)}`;
}

/** Google gtx 接口：备用，长文本一次性发送（最多 4500 字符） */
export function buildGoogleUrl(text: string, target: string = 'zh-CN'): string {
  return (
    `${GOOGLE_ENDPOINT}?client=gtx&sl=auto&tl=${encodeFormComponent(target)}` +
    `&dt=t&q=${encodeFormComponent(text)}`
  );
}

/** 按换行/句号切成不超过 limit 的片段，尽量不截断句子（与 TS 版逐行一致） */
export function splitForTranslation(text: string, limit: number = MAX_TRANSLATE_CHUNK): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let rest = normalized;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) {
      cut = Math.max(
        rest.lastIndexOf('. ', limit),
        rest.lastIndexOf('。', limit),
        rest.lastIndexOf('! ', limit),
        rest.lastIndexOf('? ', limit),
        rest.lastIndexOf('！', limit),
        rest.lastIndexOf('？', limit)
      );
    }
    if (cut < limit * 0.3) {
      cut = limit;
    }
    if (cut <= 0) {
      cut = limit;
    }
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) {
    chunks.push(rest);
  }
  return chunks.filter((chunk: string): boolean => chunk.length > 0);
}

/** 解析 MyMemory 响应；额度/长度错误与非法 JSON 都返回 null */
export function parseMyMemory(body: string): string | null {
  try {
    const json = JSON.parse(body) as Record<string, Object>;
    if (json === null || typeof json !== 'object') {
      return null;
    }
    const status = Number(json['responseStatus']);
    const data = readObject(json['responseData']);
    const raw = data !== null ? asString(data['translatedText']) : undefined;
    if (status !== 200 || raw === undefined) {
      return null;
    }
    if (/QUERY LENGTH LIMIT|INVALID SOURCE LANGUAGE|MYMEMORY WARNING|ALL AVAILABLE FREE/i.test(raw)) {
      return null;
    }
    const text = raw.trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    return null;
  }
}

/** 解析 Google gtx 响应：[[["译文","原文",...],...],...] */
export function parseGoogleTranslate(body: string): string | null {
  try {
    const json = JSON.parse(body) as Object;
    if (!Array.isArray(json)) {
      return null;
    }
    const root = json as Object[];
    if (root.length === 0) {
      return null;
    }
    const segmentsValue = root[0];
    if (!Array.isArray(segmentsValue)) {
      return null;
    }
    const parts: string[] = [];
    for (const segmentValue of segmentsValue as Object[]) {
      if (!Array.isArray(segmentValue)) {
        continue;
      }
      const segment = segmentValue as Object[];
      if (segment.length === 0) {
        continue;
      }
      const piece = segment[0];
      if (typeof piece === 'string') {
        parts.push(piece);
      }
    }
    const text = parts.join('').trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    return null;
  }
}

/**
 * 免费在线翻译：MyMemory 为主，Google 备用（都需要联网）。
 * 先按 <=450 字符分段逐段翻译再拼接；两者都失败时抛统一提示。
 */
export async function translate(text: string, target: string = 'zh-CN'): Promise<TranslationResult> {
  const source = text.trim();
  if (source.length === 0) {
    const empty: TranslationResult = { text: '', engine: 'none' };
    return empty;
  }
  const chunks = splitForTranslation(source).slice(0, MAX_TRANSLATE_CHUNKS);

  try {
    const parts: string[] = [];
    for (const chunk of chunks) {
      const parsed = parseMyMemory(await requestText(buildMyMemoryUrl(chunk, target)));
      if (parsed === null) {
        throw new Error('MyMemory 返回异常');
      }
      parts.push(parsed);
    }
    const result: TranslationResult = { text: parts.join('\n'), engine: 'MyMemory' };
    return result;
  } catch (primaryError) {
    try {
      const parsed = parseGoogleTranslate(await requestText(buildGoogleUrl(source.slice(0, 4500), target)));
      if (parsed !== null) {
        const result: TranslationResult = { text: parsed, engine: 'Google' };
        return result;
      }
    } catch (fallbackError) {
      /* 两个都失败时抛出统一提示 */
    }
    console.warn(`[radar] 翻译失败: ${String(primaryError)}`);
    throw new Error('免费翻译服务暂时不可用，请检查网络后再试');
  }
}

/* ---------- HTTP ---------- */

async function requestText(url: string): Promise<string> {
  const request = http.createHttp();
  try {
    const header: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Accept-Language': ACCEPT_LANGUAGE,
      'Accept': ACCEPT
    };
    const options: http.HttpRequestOptions = {
      method: http.RequestMethod.GET,
      header: header,
      expectDataType: http.HttpDataType.STRING,
      connectTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
      usingCache: false
    };
    const response = await request.request(url, options);
    if (response.responseCode !== 200) {
      throw new Error(`Steam 返回 HTTP ${response.responseCode}`);
    }
    if (typeof response.result !== 'string') {
      throw new Error('Steam 返回了非文本响应');
    }
    return response.result;
  } finally {
    request.destroy();
  }
}

/** 限制并发的 map，和 core/util.ts 的 mapLimit 行为一致（结果保持输入顺序） */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Map<number, R>();
  let cursor = 0;
  const runnerCount = Math.max(1, Math.min(limit, items.length));
  const runners: Array<Promise<void>> = [];
  const run = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      const value = await worker(item, index);
      results.set(index, value);
    }
  };
  for (let i = 0; i < runnerCount; i++) {
    runners.push(run());
  }
  await Promise.all(runners);

  const output: R[] = [];
  for (let i = 0; i < items.length; i++) {
    const value = results.get(i);
    if (value !== undefined) {
      output.push(value);
    }
  }
  return output;
}

/* ---------- 客户端 ---------- */

export class SteamClient {
  /** 第 page 页（从 0 开始）折扣列表，每页 100 个 */
  async fetchDealsPage(page: number, settings: Settings): Promise<Deal[]> {
    const body = await requestText(buildDealsUrl(settings, page));
    return parseSearchPayload(body, regionCurrency(settings.country));
  }

  /** 每日特惠 / 首页特惠，用于补充 discountEndsAt */
  async fetchFeatured(settings: Settings): Promise<Deal[]> {
    const body = await requestText(buildFeaturedUrl(settings));
    const payload = JSON.parse(body) as Object;
    return parseFeaturedSpecials(payload);
  }

  /** 单个游戏详情与价格 */
  async fetchAppDetails(appId: number, settings: Settings): Promise<Deal | null> {
    const body = await requestText(buildAppDetailsUrl(appId, settings));
    return parseAppDetails(body, appId);
  }

  /** 全站搜索 */
  async search(term: string, settings: Settings): Promise<SearchHit[]> {
    const body = await requestText(buildStoreSearchUrl(term, settings));
    const payload = JSON.parse(body) as Object;
    return parseStoreSearch(payload);
  }

  /** 评价详情：next 为空时取第一页，否则按上一页的分页参数请求 homecontent */
  async fetchReviews(appId: number, next?: Record<string, string>, language?: string): Promise<ReviewPage> {
    const url = next !== undefined ? buildReviewsMoreUrl(appId, next) : buildReviewsUrl(appId, language);
    const body = await requestText(url);
    return parseReviewsHtml(body);
  }

  /** 免费在线翻译：MyMemory 为主，Google 备用 */
  async translate(text: string, target: string = 'zh-CN'): Promise<TranslationResult> {
    return translate(text, target);
  }
}
