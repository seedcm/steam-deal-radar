import { formatMoney, sanitizeSettings } from "./format";
import type {
  AppNotification,
  Deal,
  Meta,
  NotifyKind,
  Settings,
  Snapshot,
  StorageAdapter,
  WatchEntry,
  PricePoint,
  WatchQuote,
} from "./types";

export const STATE_VERSION = 1;
export const STATE_FILE = "radar-state.json";

export const DEFAULT_SETTINGS: Settings = {
  country: "cn",
  language: "schinese",
  refreshMinutes: 60,
  fetchPages: 3,
  minDiscount: 0,
  sort: "discount",
  sortDirection: "desc",
  notifyEnabled: true,
  notifyMinDiscount: 25,
  notifyNewLow: true,
  quietHours: { enabled: false, start: 23, end: 8 },
  onlyPlatform: "all",
  theme: "dark",
  closeToTray: true,
  autoLaunch: false,
  autoUpdateApp: true,
  translationProvider: "builtin",
  translationEndpoint: "",
  translationApiKey: "",
  translationModel: "",
  translationTarget: "zh-CN",
  uiScale: 0,
  allowInsecureCert: false,
  proxyMode: "system",
  proxyRules: "",
};

export interface PersistedState {
  version: number;
  settings: Settings;
  watchlist: WatchEntry[];
  deals: Deal[];
  watchQuotes: Record<string, WatchQuote>;
  lowest: Record<string, number>;
  history: Record<string, PricePoint[]>;
  lastRefreshAt: number | null;
  lastRefreshError: string | null;
}

export function createEmptyState(): PersistedState {
  return {
    version: STATE_VERSION,
    settings: { ...DEFAULT_SETTINGS, quietHours: { ...DEFAULT_SETTINGS.quietHours } },
    watchlist: [],
    deals: [],
    watchQuotes: {},
    lowest: {},
    history: {},
    lastRefreshAt: null,
    lastRefreshError: null,
  };
}

/** 内存状态 + 原子落盘。桌面端用文件，鸿蒙端用 preferences。 */
export class RadarStore {
  state: PersistedState = createEmptyState();
  private adapter: StorageAdapter;
  private now: () => number;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveChain: Promise<void> = Promise.resolve();

  constructor(adapter: StorageAdapter, now: () => number = Date.now) {
    this.adapter = adapter;
    this.now = now;
  }

  async load(): Promise<void> {
    const raw = await this.adapter.read();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      const base = createEmptyState();
      this.state = {
        ...base,
        ...parsed,
        version: STATE_VERSION,
        settings: sanitizeSettings({ ...base.settings, ...(parsed.settings ?? {}) }, base.settings),
        watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
        deals: Array.isArray(parsed.deals) ? parsed.deals : [],
        watchQuotes: parsed.watchQuotes ?? {},
        lowest: parsed.lowest ?? {},
        history: parsed.history ?? {},
      };
    } catch (error) {
      console.error("[radar] 状态文件损坏，已重置缓存", error);
      this.state = createEmptyState();
    }
  }

  get settings(): Settings {
    return this.state.settings;
  }

  get deals(): Deal[] {
    return this.state.deals;
  }

  get watchlist(): WatchEntry[] {
    return this.state.watchlist;
  }

  /** 防抖保存，避免高频写入 */
  scheduleSave(delay = 400): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, delay);
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const payload = JSON.stringify(this.state);
    this.saveChain = this.saveChain.then(() => this.adapter.write(payload)).catch((error) => {
      console.error("[radar] 保存失败", error);
    });
    return this.saveChain;
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.state.settings = sanitizeSettings(patch, this.state.settings);
    this.scheduleSave();
    return this.state.settings;
  }

  isWatched(appId: number): boolean {
    return this.state.watchlist.some((item) => item.appId === appId);
  }

  addWatch(deal: Pick<Deal, "appId" | "name" | "image">, targetPrice?: number): WatchEntry {
    const existing = this.state.watchlist.find((item) => item.appId === deal.appId);
    if (existing) return existing;
    const entry: WatchEntry = {
      appId: deal.appId,
      name: deal.name,
      addedAt: this.now(),
      targetPrice,
      notifyAny: true,
      image: deal.image,
    };
    this.state.watchlist.unshift(entry);
    this.scheduleSave();
    return entry;
  }

  updateWatch(appId: number, patch: Partial<WatchEntry>): WatchEntry | undefined {
    const entry = this.state.watchlist.find((item) => item.appId === appId);
    if (!entry) return undefined;
    Object.assign(entry, patch, { appId: entry.appId });
    this.scheduleSave();
    return entry;
  }

  removeWatch(appId: number): boolean {
    const before = this.state.watchlist.length;
    this.state.watchlist = this.state.watchlist.filter((item) => item.appId !== appId);
    const removed = this.state.watchlist.length !== before;
    if (removed) this.scheduleSave();
    return removed;
  }

  mergeDeals(incoming: Deal[]): Deal[] {
    const byId = new Map<number, Deal>();
    for (const deal of this.state.deals) byId.set(deal.appId, deal);
    for (const deal of incoming) {
      const previous = byId.get(deal.appId);
      byId.set(deal.appId, previous ? { ...previous, ...stripUndefined(deal) } : deal);
    }
    this.state.deals = [...byId.values()];
    return this.state.deals;
  }

  setDeals(deals: Deal[]): void {
    this.state.deals = deals;
  }

  setQuote(quote: WatchQuote): void {
    this.state.watchQuotes[String(quote.appId)] = quote;
  }

  deleteQuote(appId: number): void {
    delete this.state.watchQuotes[String(appId)];
  }

  recordPrice(appId: number, price: number, discount: number): void {
    if (!Number.isFinite(price) || price <= 0) return;
    const key = String(appId);
    const previousLow = this.state.lowest[key];
    if (previousLow == null || price < previousLow) this.state.lowest[key] = price;
    const history = this.state.history[key] ?? [];
    const last = history[history.length - 1];
    if (!last || last.price !== price || this.now() - last.at > 6 * 3_600_000) {
      history.push({ at: this.now(), price, discount });
      if (history.length > 90) history.splice(0, history.length - 90);
      this.state.history[key] = history;
    }
  }

  snapshot(meta: Partial<Meta> = {}): Snapshot {
    return {
      deals: this.state.deals,
      watchlist: this.state.watchlist,
      watchQuotes: this.state.watchQuotes,
      settings: this.state.settings,
      lowest: this.state.lowest,
      history: this.state.history,
      meta: {
        lastRefreshAt: this.state.lastRefreshAt,
        lastRefreshError: this.state.lastRefreshError,
        source: this.state.deals.length ? "cache" : "empty",
        dealCount: this.state.deals.length,
        appVersion: "",
        platform: "web",
        nextRefreshAt: null,
        refreshing: false,
        ...meta,
      },
    };
  }

  exportState(): string {
    // 导出备份不包含翻译 API Key，避免把密钥写进文件/剪贴板
    return JSON.stringify(
      { ...this.state, settings: { ...this.state.settings, translationApiKey: "" }, exportedAt: this.now() },
      null,
      2,
    );
  }

  async importState(json: string): Promise<void> {
    const parsed = JSON.parse(json) as Partial<PersistedState>;
    if (!parsed || typeof parsed !== "object") throw new Error("文件格式不正确");
    const base = createEmptyState();
    this.state = {
      ...base,
      settings: sanitizeSettings({ ...base.settings, ...(parsed.settings ?? {}) }, base.settings),
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      deals: Array.isArray(parsed.deals) ? parsed.deals : [],
      watchQuotes: parsed.watchQuotes ?? {},
      lowest: parsed.lowest ?? {},
      history: parsed.history ?? {},
      lastRefreshAt: parsed.lastRefreshAt ?? null,
      lastRefreshError: null,
    };
    await this.flush();
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) (out as Record<string, unknown>)[key] = item;
  }
  return out;
}

export function buildNotification(
  kind: NotifyKind,
  entry: WatchEntry,
  quote: WatchQuote,
  extra: { targetPrice?: number; previousLow?: number; currency: string },
): AppNotification {
  const priceText = quote.priceText ?? formatMoney(quote.price, extra.currency);
  const originalText = quote.originalPrice ? formatMoney(quote.originalPrice, extra.currency) : undefined;
  const off = quote.discount > 0 ? `−${quote.discount}%` : "";
  let title: string;
  let body: string;

  if (kind === "target") {
    title = `到价提醒 · ${entry.name}`;
    body = `现价 ${priceText}${off ? `（${off}）` : ""}，已经达到你设置的目标价 ${formatMoney(extra.targetPrice, extra.currency)}。`;
  } else if (kind === "newlow") {
    title = `新史低 · ${entry.name}`;
    body = `现价 ${priceText}${off ? `（${off}）` : ""}，低于此前记录的最低价格 ${formatMoney(extra.previousLow, extra.currency)}。`;
  } else if (kind === "digest") {
    title = `关注列表有 ${entry.name} 等游戏在打折`;
    body = `现价 ${priceText}${off ? `（${off}）` : ""}。`;
  } else {
    title = `折扣提醒 · ${entry.name}`;
    body = `现价 ${priceText}${off ? `（${off}）` : ""}${originalText ? `，原价 ${originalText}` : ""}。`;
  }

  return { kind, appId: entry.appId, title, body, storeUrl: quote.storeUrl, image: quote.image ?? entry.image };
}
