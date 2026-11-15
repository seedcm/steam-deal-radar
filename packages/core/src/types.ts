/**
 * 共享领域模型：桌面端 (Electron)、鸿蒙端 (ArkTS WebView) 与 Web UI 都消费这些结构。
 * 价格以「最小货币单位（分）」整数存储，避免浮点误差；展示时使用 Steam 返回的格式化文本优先。
 */

export type SortKey = "discount" | "price" | "name" | "review";
export type PlatformFilter = "all" | "windows" | "linux";
export type ThemeMode = "dark" | "light";
export type NotifyKind = "target" | "newlow" | "sale" | "digest";

export interface Platforms {
  windows: boolean;
  mac: boolean;
  linux: boolean;
}

export interface Deal {
  appId: number;
  name: string;
  image?: string;
  discountPercent: number;
  /** 原价（分） */
  originalPrice?: number;
  /** 折后价（分） */
  finalPrice?: number;
  originalPriceText?: string;
  finalPriceText?: string;
  currency?: string;
  platforms: Platforms;
  releaseDate?: string;
  reviewSummary?: string;
  reviewPercent?: number;
  /** 折扣结束时间戳（毫秒），部分数据源提供 */
  discountEndsAt?: number;
  storeUrl: string;
  tags?: string[];
  /** 详情页宣传语，仅在打开详情时按需获取 */
  description?: string;
  developers?: string[];
}

export interface PricePoint {
  at: number;
  price: number;
  discount: number;
}

export interface WatchQuote {
  appId: number;
  name: string;
  price: number;
  originalPrice?: number;
  discount: number;
  at: number;
  image?: string;
  storeUrl: string;
  priceText?: string;
}

export interface WatchEntry {
  appId: number;
  name: string;
  addedAt: number;
  /** 目标价（分）：低于此价时优先提醒；null 表示已清除 */
  targetPrice?: number | null;
  note?: string;
  /** 任意折扣都提醒，否则只在达到 notifyMinDiscount 时提醒 */
  notifyAny: boolean;
  image?: string;
  lastNotified?: { price: number; discount: number; at: number; kind: NotifyKind };
  lastSeen?: { price: number; discount: number; at: number };
}

export interface QuietHours {
  enabled: boolean;
  /** 0-23 */
  start: number;
  end: number;
}

export interface Settings {
  /** Steam 区域代码，如 cn / us / hk / jp */
  country: string;
  /** Steam 语言，如 schinese / english */
  language: string;
  /** 自动刷新间隔（分钟） */
  refreshMinutes: number;
  /** 每页 100 个，抓取页数（1-6） */
  fetchPages: number;
  minDiscount: number;
  sort: SortKey;
  notifyEnabled: boolean;
  notifyMinDiscount: number;
  notifyNewLow: boolean;
  quietHours: QuietHours;
  onlyPlatform: PlatformFilter;
  theme: ThemeMode;
  closeToTray: boolean;
  autoLaunch: boolean;
  autoUpdateApp: boolean;
}

export interface AppNotification {
  kind: NotifyKind;
  appId: number;
  title: string;
  body: string;
  storeUrl: string;
  image?: string;
}

export interface Meta {
  lastRefreshAt: number | null;
  lastRefreshError: string | null;
  source: "live" | "cache" | "empty";
  dealCount: number;
  appVersion: string;
  platform: "electron" | "harmony" | "web";
  nextRefreshAt: number | null;
  refreshing: boolean;
}

export interface Snapshot {
  deals: Deal[];
  watchlist: WatchEntry[];
  watchQuotes: Record<string, WatchQuote>;
  settings: Settings;
  meta: Meta;
  /** appId -> 历史最低折后价（分） */
  lowest: Record<string, number>;
  history: Record<string, PricePoint[]>;
}

export interface RefreshResult {
  ok: boolean;
  error?: string;
  dealCount: number;
  newLowCount: number;
  notifications: AppNotification[];
  finishedAt: number;
}

export interface StorageAdapter {
  read(): Promise<string | null>;
  write(data: string): Promise<void>;
}

export interface HttpClient {
  (url: string): Promise<string>;
}

export type ReviewType = "positive" | "negative";

/** 单条 Steam 评测（来自社区页面，保持官方「最有帮助」排序） */
export interface GameReview {
  id: string;
  author: string;
  profileUrl?: string;
  votedUp: boolean;
  text: string;
  postedAt?: number;
  postedText?: string;
  playtimeHours?: number;
  helpful: number;
  funny: number;
  comments: number;
}

export interface ReviewPage {
  reviews: GameReview[];
  /** Steam 分页表单参数，原样带回用于加载下一页 */
  next?: Record<string, string>;
  hasMore: boolean;
}

export interface SearchHit {
  appId: number;
  name: string;
  image?: string;
  price?: number;
  originalPrice?: number;
  discountPercent: number;
  currency?: string;
  platforms: Platforms;
  storeUrl: string;
  reviewPercent?: number;
}

export const REGIONS: Array<{ code: string; label: string; currency: string; language: string }> = [
  { code: "cn", label: "中国", currency: "CNY", language: "schinese" },
  { code: "hk", label: "中国香港", currency: "HKD", language: "tchinese" },
  { code: "tw", label: "中国台湾", currency: "TWD", language: "tchinese" },
  { code: "us", label: "美国", currency: "USD", language: "english" },
  { code: "jp", label: "日本", currency: "JPY", language: "japanese" },
  { code: "de", label: "德国", currency: "EUR", language: "german" },
  { code: "gb", label: "英国", currency: "GBP", language: "english" },
  { code: "ru", label: "俄罗斯", currency: "RUB", language: "russian" },
  { code: "br", label: "巴西", currency: "BRL", language: "brazilian" },
];

export const SORT_LABELS: Record<SortKey, string> = {
  discount: "折扣力度",
  price: "价格由低到高",
  name: "名称",
  review: "好评率",
};
