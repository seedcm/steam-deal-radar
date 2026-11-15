/**
 * 数据引擎：刷新、合并、历史最低价、提醒规划、通知与快照。
 *
 * 刷新流程逐条对应 packages/core/src/service.ts：
 * 1. 并发抓取 1~6 页折扣（并发度 3）；
 * 2. 抓 featuredcategories，合并 discountEndsAt；
 * 3. 关注列表里不在折扣页的游戏逐个查 appdetails 补价格；
 * 4. recordPrice 记录 lowest/history；
 * 5. 用「本轮之前」的最低价计算新史低与提醒；
 * 6. 发布系统通知、更新 lastRefreshAt/lastRefreshError 并落盘。
 *
 * 前台 WebView 与后台 WorkSchedulerExtensionAbility 共用这一个类。
 */

import { planNotifications } from './Reminders';
import { StateStore } from './StateStore';
import { mapLimit, SteamClient } from './SteamClient';
import { Notifier } from '../notify/Notifier';
import {
  AppNotification,
  Deal,
  EventSink,
  mergeDeal,
  Meta,
  MetaSource,
  notificationEvent,
  RefreshResult,
  refreshingEvent,
  regionCurrency,
  ReviewPage,
  SearchHit,
  Settings,
  SettingsPatch,
  Snapshot,
  snapshotEvent,
  toMessage,
  TranslationResult,
  WatchEntry,
  WatchPatch,
  WatchQuote
} from './Types';

/** 与 core/service.ts 一致：单轮最多补查 40 个关注项 */
const MAX_WATCH_PRICE_CHECKS: number = 40;
/** 折扣页并发度 */
const PAGE_CONCURRENCY: number = 3;
/** 关注项补价并发度 */
const WATCH_CONCURRENCY: number = 3;

export class RadarEngine {
  private store: StateStore;
  private client: SteamClient;
  private notifier: Notifier;
  private version: string;
  private emit: EventSink;
  private inflight: Promise<RefreshResult> | null = null;
  private refreshing: boolean = false;
  private succeeded: boolean = false;
  private lastError: string | null = null;

  constructor(store: StateStore, client: SteamClient, notifier: Notifier, version: string, emit: EventSink) {
    this.store = store;
    this.client = client;
    this.notifier = notifier;
    this.version = version;
    this.emit = emit;
  }

  async init(): Promise<void> {
    await this.store.init();
    this.lastError = this.store.state.lastRefreshError;
  }

  get settings(): Settings {
    return this.store.settings;
  }

  get deals(): Deal[] {
    return this.store.deals;
  }

  snapshot(): Snapshot {
    const settings = this.store.settings;
    const lastRefreshAt = this.store.state.lastRefreshAt;
    const base = lastRefreshAt !== null ? lastRefreshAt : Date.now();
    let source: MetaSource = 'empty';
    if (this.store.state.deals.length > 0) {
      source = this.succeeded ? 'live' : 'cache';
    }
    const meta: Meta = {
      lastRefreshAt: lastRefreshAt,
      lastRefreshError: this.lastError,
      source: source,
      dealCount: this.store.state.deals.length,
      appVersion: this.version,
      platform: 'harmony',
      nextRefreshAt: base + settings.refreshMinutes * 60_000,
      refreshing: this.refreshing
    };
    const snapshot: Snapshot = {
      deals: this.store.state.deals,
      watchlist: this.store.state.watchlist,
      watchQuotes: this.store.state.watchQuotes,
      settings: settings,
      meta: meta,
      lowest: this.store.state.lowest,
      history: this.store.state.history
    };
    return snapshot;
  }

  /**
   * 手动/定时/启动刷新。并发调用会复用同一个进行中的任务，
   * 与 core/service.ts 的 inflight 去重逻辑一致。
   */
  refresh(): Promise<RefreshResult> {
    if (this.inflight !== null) {
      return this.inflight;
    }
    this.refreshing = true;
    this.emit(refreshingEvent(true));

    const task: Promise<RefreshResult> = this.doRefresh()
      .catch((err: Object): RefreshResult => {
        this.lastError = toMessage(err);
        this.store.state.lastRefreshError = this.lastError;
        this.store.flush();
        const failure: RefreshResult = {
          ok: false,
          error: this.lastError,
          dealCount: this.store.deals.length,
          newLowCount: 0,
          notifications: [],
          finishedAt: Date.now()
        };
        return failure;
      })
      .finally((): void => {
        this.inflight = null;
        this.refreshing = false;
        // 成功或失败都推一次快照，保证 UI 的 meta.lastRefreshError / refreshing 状态同步
        this.emit(snapshotEvent(this.snapshot()));
        this.emit(refreshingEvent(false));
      });

    this.inflight = task;
    return task;
  }

  private async doRefresh(): Promise<RefreshResult> {
    const startedAt = Date.now();
    const settings = this.store.settings;
    const currency = regionCurrency(settings.country);
    const lowestBefore = cloneNumberRecord(this.store.state.lowest);

    /* 1. 折扣页 */
    const pages: number[] = [];
    for (let i = 0; i < settings.fetchPages; i++) {
      pages.push(i);
    }
    const pageResults: Deal[][] = await mapLimit<number, Deal[]>(
      pages,
      PAGE_CONCURRENCY,
      async (page: number): Promise<Deal[]> => {
        try {
          return await this.client.fetchDealsPage(page, settings);
        } catch (err) {
          console.warn(`[radar] 抓取第 ${page + 1} 页失败: ${toMessage(err as Object)}`);
          return [];
        }
      }
    );
    let deals: Deal[] = [];
    for (const pageDeals of pageResults) {
      for (const deal of pageDeals) {
        deals.push(deal);
      }
    }

    /* 2. 每日特惠 */
    let featured: Deal[] = [];
    try {
      featured = await this.client.fetchFeatured(settings);
    } catch (err) {
      console.warn(`[radar] 抓取每日特惠失败: ${toMessage(err as Object)}`);
    }
    if (deals.length === 0) {
      deals = featured;
    }
    deals = this.decorate(deals, featured);

    if (deals.length === 0) {
      this.lastError = '无法从 Steam 获取折扣数据，请检查网络或稍后重试';
      this.store.state.lastRefreshError = this.lastError;
      await this.store.flush();
      const failure: RefreshResult = {
        ok: false,
        error: this.lastError,
        dealCount: this.store.deals.length,
        newLowCount: 0,
        notifications: [],
        finishedAt: Date.now()
      };
      return failure;
    }

    /* 3. 关注项报价：先在折扣列表里找，找不到再查 appdetails */
    const quotes: Record<string, WatchQuote> = {};
    const dealById = new Map<number, Deal>();
    for (const deal of deals) {
      dealById.set(deal.appId, deal);
    }
    const watchlist = this.store.watchlist;
    for (const entry of watchlist) {
      const deal = dealById.get(entry.appId);
      if (deal !== undefined && deal.finalPrice !== undefined && deal.finalPrice !== null) {
        quotes[String(entry.appId)] = toQuote(deal, startedAt);
      }
    }

    const missing: WatchEntry[] = [];
    for (const entry of watchlist) {
      if (quotes[String(entry.appId)] === undefined) {
        missing.push(entry);
      }
    }
    const checks = missing.slice(0, MAX_WATCH_PRICE_CHECKS);
    await mapLimit<WatchEntry, boolean>(
      checks,
      WATCH_CONCURRENCY,
      async (entry: WatchEntry): Promise<boolean> => {
        try {
          const deal = await this.client.fetchAppDetails(entry.appId, settings);
          if (deal === null) {
            return false;
          }
          this.store.mergeDeals([deal]);
          if (deal.finalPrice !== undefined && deal.finalPrice !== null) {
            quotes[String(entry.appId)] = toQuote(deal, Date.now());
          }
          return true;
        } catch (err) {
          console.warn(`[radar] 刷新关注项 ${entry.appId} 失败: ${toMessage(err as Object)}`);
          return false;
        }
      }
    );

    /* 4. 历史价格：先记录本轮价格，再合并 deals / quotes */
    for (const deal of deals) {
      if (deal.finalPrice !== undefined && deal.finalPrice !== null && deal.finalPrice > 0) {
        this.store.recordPrice(deal.appId, deal.finalPrice, deal.discountPercent);
      }
    }
    for (const quoteKey of Object.keys(quotes)) {
      const quote = quotes[quoteKey];
      if (quote === undefined) {
        continue;
      }
      this.store.recordPrice(quote.appId, quote.price, quote.discount);
      this.store.setQuote(quote);
    }

    const previous = new Map<number, Deal>();
    for (const oldDeal of this.store.deals) {
      previous.set(oldDeal.appId, oldDeal);
    }
    const merged: Deal[] = [];
    for (const deal of deals) {
      const oldDeal = previous.get(deal.appId);
      merged.push(oldDeal !== undefined ? mergeDeal(oldDeal, deal) : deal);
    }
    this.store.setDeals(merged);

    /* 5. 提醒：lowestBefore 是本轮开始前的快照，用于判断新史低 */
    const notifications = planNotifications(watchlist, quotes, lowestBefore, settings, startedAt);
    for (const notification of notifications) {
      const quote = quotes[String(notification.appId)];
      if (quote !== undefined) {
        this.store.markNotified(
          notification.appId,
          quote.price,
          quote.discount,
          notification.kind,
          startedAt
        );
      }
      await this.notifier.publish(notification);
      this.emit(notificationEvent(notification));
    }

    /* 6. 新史低计数（与 core/service.ts 相同：只看还在折扣页里的 deal） */
    let newLowCount = 0;
    for (const deal of deals) {
      const low = lowestBefore[String(deal.appId)];
      if (deal.finalPrice !== undefined && deal.finalPrice !== null && low !== undefined && deal.finalPrice < low) {
        newLowCount += 1;
      }
    }

    this.succeeded = true;
    this.lastError = null;
    this.store.state.lastRefreshAt = startedAt;
    this.store.state.lastRefreshError = null;
    await this.store.flush();

    const result: RefreshResult = {
      ok: true,
      dealCount: deals.length,
      newLowCount: newLowCount,
      notifications: notifications,
      finishedAt: startedAt
    };
    return result;
  }

  /** 合并首页特惠里的截止时间，并保留搜索结果里更完整的评价/平台字段 */
  private decorate(deals: Deal[], featured: Deal[]): Deal[] {
    const featuredById = new Map<number, Deal>();
    for (const deal of featured) {
      featuredById.set(deal.appId, deal);
    }
    const seen = new Set<number>();
    const out: Deal[] = [];
    for (const deal of deals) {
      if (seen.has(deal.appId)) {
        continue;
      }
      seen.add(deal.appId);
      const extra = featuredById.get(deal.appId);
      if (extra !== undefined && extra.discountEndsAt !== undefined) {
        deal.discountEndsAt = extra.discountEndsAt;
      }
      out.push(deal);
    }
    for (const deal of featured) {
      if (seen.has(deal.appId) || deal.discountPercent === 0) {
        continue;
      }
      seen.add(deal.appId);
      out.push(deal);
    }
    return out;
  }

  /** 前台/定时启动时：数据为空或超过 refreshMinutes 才刷新 */
  async refreshIfStale(): Promise<void> {
    const settings = this.store.settings;
    const last = this.store.state.lastRefreshAt;
    const fresh = last !== null && Date.now() - last < settings.refreshMinutes * 60_000;
    if (fresh && this.store.deals.length > 0) {
      return;
    }
    await this.refresh();
  }

  async search(term: string): Promise<SearchHit[]> {
    const query = term.trim();
    if (query.length < 2) {
      return [];
    }
    return this.client.search(query, this.store.settings);
  }

  /**
   * 评价详情：Steam 官方「最有帮助」排序。
   * next 为上一页返回的分页参数；不传则加载第一页。
   * language 为可选语言筛选（schinese / english / …，all 或不传为全部语言）。
   */
  async reviews(appId: number, next?: Record<string, string>, language?: string): Promise<ReviewPage> {
    return this.client.fetchReviews(appId, next, language);
  }

  /** 免费在线翻译：MyMemory 为主，Google 备用 */
  async translate(text: string, target: string = 'zh-CN'): Promise<TranslationResult> {
    return this.client.translate(text, target);
  }

  /** 打开详情时按需拉取简介、开发商等信息 */
  async loadDetails(appId: number): Promise<Deal | null> {
    const deal = await this.client.fetchAppDetails(appId, this.store.settings);
    if (deal === null) {
      return null;
    }
    this.store.mergeDeals([deal]);
    this.store.scheduleSave();
    return deal;
  }

  watch(appId: number, name: string, image: string | undefined, targetPrice: number | undefined): WatchEntry {
    return this.store.addWatch(appId, name, image, targetPrice);
  }

  unwatch(appId: number): boolean {
    this.store.deleteQuote(appId);
    return this.store.removeWatch(appId);
  }

  updateWatch(appId: number, patch: WatchPatch): WatchEntry | undefined {
    return this.store.updateWatch(appId, patch);
  }

  updateSettings(patch: SettingsPatch): Settings {
    return this.store.updateSettings(patch);
  }

  /** 测试通知，与 core/controller.ts 的 testNotification 文案一致 */
  async testNotification(): Promise<void> {
    const notification: AppNotification = {
      kind: 'digest',
      appId: 0,
      title: 'Steam 折扣雷达',
      body: '通知通道正常，关注列表里的游戏打折时会在这里提醒你。',
      storeUrl: 'https://store.steampowered.com'
    };
    await this.notifier.publish(notification);
    this.emit(notificationEvent(notification));
  }

  exportData(): string {
    return this.store.exportState();
  }

  async importData(json: string): Promise<void> {
    await this.store.importState(json);
    this.lastError = null;
    this.succeeded = false;
  }
}

function cloneNumberRecord(source: Record<string, number>): Record<string, number> {
  const copy: Record<string, number> = {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value !== undefined) {
      copy[key] = value;
    }
  }
  return copy;
}

function toQuote(deal: Deal, at: number): WatchQuote {
  const quote: WatchQuote = {
    appId: deal.appId,
    name: deal.name,
    price: deal.finalPrice !== undefined ? deal.finalPrice : 0,
    discount: deal.discountPercent,
    at: at,
    storeUrl: deal.storeUrl
  };
  if (deal.originalPrice !== undefined) {
    quote.originalPrice = deal.originalPrice;
  }
  if (deal.image !== undefined) {
    quote.image = deal.image;
  }
  if (deal.finalPriceText !== undefined) {
    quote.priceText = deal.finalPriceText;
  }
  return quote;
}
