import { regionCurrency } from "./format";
import {
  MAX_TRANSLATE_CHUNKS,
  buildGoogleUrl,
  buildMyMemoryUrl,
  parseGoogleTranslate,
  parseMyMemory,
  splitForTranslation,
  type TranslationResult,
} from "./translate";
import { planNotifications, markNotified } from "./reminders";
import {
  buildAppDetailsUrl,
  buildDealsUrl,
  buildFeaturedUrl,
  buildReviewsMoreUrl,
  buildReviewsUrl,
  buildStoreSearchUrl,
  parseAppDetails,
  parseFeaturedSpecials,
  parseSearchPayload,
  parseReviewsHtml,
  parseStoreSearch,
} from "./steam";
import type { RadarStore } from "./store";
import type {
  AppNotification,
  Deal,
  HttpClient,
  Meta,
  RefreshResult,
  ReviewPage,
  SearchHit,
  Settings,
  Snapshot,
  WatchEntry,
  WatchQuote,
} from "./types";
import { mapLimit } from "./util";

export interface RadarServiceOptions {
  http: HttpClient;
  store: RadarStore;
  notify?: (notification: AppNotification) => void | Promise<void>;
  now?: () => number;
  version?: string;
  platform?: Meta["platform"];
}

const MAX_WATCH_PRICE_CHECKS = 40;

function toQuote(deal: Deal, at: number): WatchQuote {
  return {
    appId: deal.appId,
    name: deal.name,
    price: deal.finalPrice ?? 0,
    originalPrice: deal.originalPrice,
    discount: deal.discountPercent,
    at,
    image: deal.image,
    storeUrl: deal.storeUrl,
    priceText: deal.finalPriceText,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * 折扣数据引擎：负责抓取、合并、历史最低价、提醒规划与持久化。
 * 与平台无关 —— Electron 主进程和鸿蒙 ArkTS 端都复用同一套逻辑。
 */
export class RadarService {
  readonly store: RadarStore;
  private http: HttpClient;
  private notify: (notification: AppNotification) => void | Promise<void>;
  private now: () => number;
  private version: string;
  private platform: Meta["platform"];
  private inflight: Promise<RefreshResult> | null = null;
  private refreshing = false;
  private succeeded = false;
  private lastError: string | null = null;

  constructor(options: RadarServiceOptions) {
    this.store = options.store;
    this.http = options.http;
    this.notify = options.notify ?? (() => {});
    this.now = options.now ?? Date.now;
    this.version = options.version ?? "0.0.0";
    this.platform = options.platform ?? "web";
  }

  async init(): Promise<void> {
    await this.store.load();
    this.lastError = this.store.state.lastRefreshError;
  }

  snapshot(): Snapshot {
    const settings = this.store.settings;
    const base = this.store.state.lastRefreshAt ?? this.now();
    return this.store.snapshot({
      appVersion: this.version,
      platform: this.platform,
      refreshing: this.refreshing,
      source: this.store.deals.length ? (this.succeeded ? "live" : "cache") : "empty",
      lastRefreshError: this.lastError,
      nextRefreshAt: base + settings.refreshMinutes * 60_000,
    });
  }

  /** 手动/定时/启动刷新。并发调用会复用同一个进行中的任务。 */
  refresh(): Promise<RefreshResult> {
    if (this.inflight) return this.inflight;
    this.refreshing = true;
    this.inflight = this.doRefresh()
      .catch((error) => {
        this.lastError = errorMessage(error);
        return {
          ok: false,
          error: this.lastError,
          dealCount: this.store.deals.length,
          newLowCount: 0,
          notifications: [],
          finishedAt: this.now(),
        } satisfies RefreshResult;
      })
      .finally(() => {
        this.inflight = null;
        this.refreshing = false;
      });
    return this.inflight;
  }

  private async doRefresh(): Promise<RefreshResult> {
    const startedAt = this.now();
    const settings = this.store.settings;
    const opts = { country: settings.country, language: settings.language };
    const currency = regionCurrency(settings.country);
    const lowestBefore = { ...this.store.state.lowest };

    const pages = Array.from({ length: settings.fetchPages }, (_, index) => index);
    const pageResults = await mapLimit(pages, 3, async (page) => {
      try {
        const body = await this.http(buildDealsUrl(opts, page));
        return parseSearchPayload(body, currency);
      } catch (error) {
        console.warn(`[radar] 抓取第 ${page + 1} 页失败: ${errorMessage(error)}`);
        return [] as Deal[];
      }
    });

    let deals = pageResults.flat();
    const featured = await this.http(buildFeaturedUrl(opts))
      .then((body) => parseFeaturedSpecials(JSON.parse(body)))
      .catch(() => [] as Deal[]);

    if (deals.length === 0) deals = featured;
    deals = this.decorate(deals, featured);

    if (deals.length === 0) {
      this.lastError = "无法从 Steam 获取折扣数据，请检查网络或稍后重试";
      this.store.state.lastRefreshError = this.lastError;
      await this.store.flush();
      return {
        ok: false,
        error: this.lastError,
        dealCount: this.store.deals.length,
        newLowCount: 0,
        notifications: [],
        finishedAt: this.now(),
      };
    }

    const quotes: Record<string, WatchQuote> = {};
    const dealById = new Map(deals.map((deal) => [deal.appId, deal]));
    const watchlist = this.store.watchlist;

    for (const entry of watchlist) {
      const deal = dealById.get(entry.appId);
      if (deal && deal.finalPrice != null) quotes[entry.appId] = toQuote(deal, startedAt);
    }

    // 不在当页折扣列表里的关注项，逐个查询详情以刷新价格
    const missing = watchlist.filter((entry) => !quotes[entry.appId]).slice(0, MAX_WATCH_PRICE_CHECKS);
    await mapLimit(missing, 3, async (entry) => {
      try {
        const body = await this.http(buildAppDetailsUrl(entry.appId, opts));
        const deal = parseAppDetails(body, entry.appId);
        if (!deal) return;
        this.store.mergeDeals([deal]);
        if (deal.finalPrice != null) quotes[entry.appId] = toQuote(deal, this.now());
      } catch (error) {
        console.warn(`[radar] 刷新关注项 ${entry.appId} 失败: ${errorMessage(error)}`);
      }
    });

    for (const deal of deals) {
      if (deal.finalPrice != null && deal.finalPrice > 0) this.store.recordPrice(deal.appId, deal.finalPrice, deal.discountPercent);
    }
    for (const quote of Object.values(quotes)) this.store.recordPrice(quote.appId, quote.price, quote.discount);

    for (const quote of Object.values(quotes)) this.store.setQuote(quote);

    const previous = new Map(this.store.deals.map((deal) => [deal.appId, deal]));
    this.store.setDeals(
      deals.map((deal) => {
        const old = previous.get(deal.appId);
        return old ? { ...old, ...compact(deal) } : deal;
      }),
    );

    const notifications = planNotifications({ watchlist, quotes, lowestBefore, settings, now: startedAt });
    for (const notification of notifications) {
      const quote = quotes[notification.appId];
      const entry = watchlist.find((item) => item.appId === notification.appId);
      if (entry && quote) this.store.updateWatch(entry.appId, markNotified(entry, notification, quote, startedAt));
      try {
        await this.notify(notification);
      } catch (error) {
        console.warn("[radar] 系统通知发送失败", error);
      }
    }

    let newLowCount = 0;
    for (const deal of deals) {
      const low = lowestBefore[String(deal.appId)];
      if (deal.finalPrice != null && low != null && deal.finalPrice < low) newLowCount += 1;
    }

    this.succeeded = true;
    this.lastError = null;
    this.store.state.lastRefreshAt = startedAt;
    this.store.state.lastRefreshError = null;
    await this.store.flush();

    return {
      ok: true,
      dealCount: deals.length,
      newLowCount,
      notifications,
      finishedAt: startedAt,
    };
  }

  /** 合并首页特惠里的截止时间，并补全缺失的平台/价格字段 */
  private decorate(deals: Deal[], featured: Deal[]): Deal[] {
    const featuredById = new Map(featured.map((deal) => [deal.appId, deal]));
    const seen = new Set<number>();
    const out: Deal[] = [];
    for (const deal of deals) {
      if (seen.has(deal.appId)) continue;
      seen.add(deal.appId);
      const extra = featuredById.get(deal.appId);
      out.push(extra ? { ...deal, discountEndsAt: extra.discountEndsAt ?? deal.discountEndsAt } : deal);
    }
    for (const deal of featured) {
      if (seen.has(deal.appId) || !deal.discountPercent) continue;
      seen.add(deal.appId);
      out.push(deal);
    }
    return out;
  }

  async search(term: string): Promise<SearchHit[]> {
    const query = term.trim();
    if (query.length < 2) return [];
    const opts = { country: this.store.settings.country, language: this.store.settings.language };
    const body = await this.http(buildStoreSearchUrl(query, opts));
    return parseStoreSearch(JSON.parse(body));
  }

  /** 评价详情：Steam 官方「最有帮助」排序，next 为上一页返回的分页参数 */
  async reviews(appId: number, next?: Record<string, string>, language?: string): Promise<ReviewPage> {
    const url = next ? buildReviewsMoreUrl(appId, next) : buildReviewsUrl(appId, language);
    const html = await this.http(url);
    return parseReviewsHtml(html);
  }

  /** 免费在线翻译：MyMemory 为主，Google 备用（都需要联网） */
  async translate(text: string, target = "zh-CN"): Promise<TranslationResult> {
    const source = text.trim();
    if (!source) return { text: "", engine: "none" };
    const chunks = splitForTranslation(source).slice(0, MAX_TRANSLATE_CHUNKS);

    try {
      const parts: string[] = [];
      for (const chunk of chunks) {
        const parsed = parseMyMemory(await this.http(buildMyMemoryUrl(chunk, target)));
        if (!parsed) throw new Error("MyMemory 返回异常");
        parts.push(parsed);
      }
      return { text: parts.join("\n"), engine: "MyMemory" };
    } catch (primaryError) {
      try {
        const parsed = parseGoogleTranslate(await this.http(buildGoogleUrl(source.slice(0, 4500), target)));
        if (parsed) return { text: parsed, engine: "Google" };
      } catch {
        /* 两个都失败时抛出统一提示 */
      }
      console.warn("[radar] 翻译失败", primaryError);
      throw new Error("免费翻译服务暂时不可用，请检查网络后再试");
    }
  }

  /** 打开详情时按需拉取简介等信息 */
  async loadDetails(appId: number): Promise<Deal | null> {
    const opts = { country: this.store.settings.country, language: this.store.settings.language };
    const body = await this.http(buildAppDetailsUrl(appId, opts));
    const deal = parseAppDetails(body, appId);
    if (!deal) return null;
    this.store.mergeDeals([deal]);
    this.store.scheduleSave();
    return deal;
  }

  watch(input: { appId: number; name: string; image?: string; targetPrice?: number }): WatchEntry {
    return this.store.addWatch({ appId: input.appId, name: input.name, image: input.image }, input.targetPrice);
  }

  updateWatch(appId: number, patch: Partial<WatchEntry>): WatchEntry | undefined {
    return this.store.updateWatch(appId, patch);
  }

  unwatch(appId: number): boolean {
    this.store.deleteQuote(appId);
    return this.store.removeWatch(appId);
  }

  updateSettings(patch: Partial<Settings>): Settings {
    return this.store.updateSettings(patch);
  }

  quotes(): Record<string, WatchQuote> {
    return this.store.state.watchQuotes;
  }

  hasFreshData(maxAgeMs: number): boolean {
    const last = this.store.state.lastRefreshAt;
    return Boolean(last && Date.now() - last < maxAgeMs);
  }
}

function compact<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

export { MAX_WATCH_PRICE_CHECKS };
export type { HttpClient };
