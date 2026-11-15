/**
 * 领域模型与纯函数工具。
 *
 * 这里的接口与 packages/core/src/types.ts、store.ts 一一对应：
 * - 键名、可空性、单位（价格以「分」为整数）完全保持一致；
 * - 因此桌面端导出的备份 JSON 可以直接导入鸿蒙端，反之亦然。
 */

/** 与 AppScope/app.json5 中的 versionName 保持一致 */
export const APP_VERSION: string = '1.2.0';
/** 与 AppScope/app.json5 中的 bundleName 保持一致 */
export const BUNDLE_NAME: string = 'com.steamdealradar.app';
/** 与 packages/core/src/store.ts 的 STATE_VERSION 保持一致 */
export const STATE_VERSION: number = 1;

export type SortKey = 'discount' | 'price' | 'name' | 'review';
export type PlatformFilter = 'all' | 'windows' | 'linux';
export type ThemeMode = 'dark' | 'light';
export type NotifyKind = 'target' | 'newlow' | 'sale' | 'digest';
export type ToastTone = 'info' | 'error' | 'success';
export type MetaSource = 'live' | 'cache' | 'empty';
export type AppPlatform = 'electron' | 'harmony' | 'web';
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'none'
  | 'error'
  | 'unsupported';

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

export interface NotifiedMark {
  price: number;
  discount: number;
  at: number;
  kind: NotifyKind;
}

export interface SeenMark {
  price: number;
  discount: number;
  at: number;
}

export interface WatchEntry {
  appId: number;
  name: string;
  addedAt: number;
  /** 目标价（分）：低于此价时优先提醒 */
  targetPrice?: number;
  note?: string;
  /** 任意折扣都提醒，否则只在达到 notifyMinDiscount 时提醒 */
  notifyAny: boolean;
  image?: string;
  lastNotified?: NotifiedMark;
  lastSeen?: SeenMark;
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

/** 设置补丁：桥协议里 updateSettings 的 patch 字段 */
export interface QuietHoursPatch {
  enabled?: boolean;
  start?: number;
  end?: number;
}

export interface SettingsPatch {
  country?: string;
  language?: string;
  refreshMinutes?: number;
  fetchPages?: number;
  minDiscount?: number;
  sort?: SortKey;
  notifyEnabled?: boolean;
  notifyMinDiscount?: number;
  notifyNewLow?: boolean;
  quietHours?: QuietHoursPatch;
  onlyPlatform?: PlatformFilter;
  theme?: ThemeMode;
  closeToTray?: boolean;
  autoLaunch?: boolean;
  autoUpdateApp?: boolean;
}

/**
 * 关注项补丁。
 * targetPrice 允许显式传 null，表示清除目标价（见 NativeBridge 里的空 patch 兼容处理）。
 */
export interface WatchPatch {
  name?: string;
  image?: string;
  targetPrice?: number | null;
  note?: string;
  notifyAny?: boolean;
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
  source: MetaSource;
  dealCount: number;
  appVersion: string;
  platform: AppPlatform;
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

/** 免费在线翻译结果，与 packages/core/src/translate.ts 的 TranslationResult 一致 */
export interface TranslationResult {
  text: string;
  /** MyMemory / Google；空文本时为 none */
  engine: string;
}

export interface Capabilities {
  notifications: boolean;
  autoUpdate: boolean;
  tray: boolean;
  background: boolean;
  importExport: boolean;
}

export interface AppInfo {
  version: string;
  platform: AppPlatform;
  os: string;
  dataDir?: string;
  capabilities: Capabilities;
}

export interface UpdateStatus {
  phase: UpdatePhase;
  version?: string;
  percent?: number;
  message?: string;
}

export interface ErrorPayload {
  message: string;
}

/* ---------- 宿主 -> 渲染层事件（与 packages/core/src/api.ts 对齐） ---------- */

export interface SnapshotEvent {
  type: 'snapshot';
  snapshot: Snapshot;
}

export interface RefreshingEvent {
  type: 'refreshing';
  value: boolean;
}

export interface ToastEvent {
  type: 'toast';
  message: string;
  tone: ToastTone;
}

export interface NotificationEvent {
  type: 'notification';
  notification: AppNotification;
}

export interface UpdateEvent {
  type: 'update';
  status: UpdateStatus;
}

export type RadarEvent =
  | SnapshotEvent
  | RefreshingEvent
  | ToastEvent
  | NotificationEvent
  | UpdateEvent;

export type EventSink = (event: RadarEvent) => void;

export function snapshotEvent(snapshot: Snapshot): SnapshotEvent {
  const event: SnapshotEvent = { type: 'snapshot', snapshot: snapshot };
  return event;
}

export function refreshingEvent(value: boolean): RefreshingEvent {
  const event: RefreshingEvent = { type: 'refreshing', value: value };
  return event;
}

export function toastEvent(message: string, tone: ToastTone): ToastEvent {
  const event: ToastEvent = { type: 'toast', message: message, tone: tone };
  return event;
}

export function notificationEvent(notification: AppNotification): NotificationEvent {
  const event: NotificationEvent = { type: 'notification', notification: notification };
  return event;
}

export function updateEvent(status: UpdateStatus): UpdateEvent {
  const event: UpdateEvent = { type: 'update', status: status };
  return event;
}

/* ---------- 持久化状态（键名与 desktop 的 radar-state.json 完全一致） ---------- */

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

/** 与 packages/core/src/store.ts 的 DEFAULT_SETTINGS 完全一致 */
export function defaultSettings(): Settings {
  const quiet: QuietHours = { enabled: false, start: 23, end: 8 };
  const settings: Settings = {
    country: 'cn',
    language: 'schinese',
    refreshMinutes: 60,
    fetchPages: 3,
    minDiscount: 0,
    sort: 'discount',
    notifyEnabled: true,
    notifyMinDiscount: 25,
    notifyNewLow: true,
    quietHours: quiet,
    onlyPlatform: 'all',
    theme: 'dark',
    closeToTray: true,
    autoLaunch: false,
    autoUpdateApp: true
  };
  return settings;
}

export function createEmptyState(): PersistedState {
  const state: PersistedState = {
    version: STATE_VERSION,
    settings: defaultSettings(),
    watchlist: [],
    deals: [],
    watchQuotes: {},
    lowest: {},
    history: {},
    lastRefreshAt: null,
    lastRefreshError: null
  };
  return state;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 设置归一化，语义与 packages/core/src/format.ts 的 sanitizeSettings 相同：
 * 先合并 patch，再按范围裁剪，最后保证 quietHours 完整。
 */
export function sanitizeSettings(patch: SettingsPatch, current: Settings): Settings {
  const quietPatch: QuietHoursPatch =
    patch.quietHours !== undefined && patch.quietHours !== null ? patch.quietHours : {};
  const startValue = quietPatch.start !== undefined ? quietPatch.start : current.quietHours.start;
  const endValue = quietPatch.end !== undefined ? quietPatch.end : current.quietHours.end;
  const enabledValue = quietPatch.enabled !== undefined ? quietPatch.enabled : current.quietHours.enabled;
  const quiet: QuietHours = {
    enabled: enabledValue,
    start: clamp(Math.round(startValue), 0, 23),
    end: clamp(Math.round(endValue), 0, 23)
  };

  const rawRefresh = patch.refreshMinutes !== undefined ? patch.refreshMinutes : current.refreshMinutes;
  const rawFetch = patch.fetchPages !== undefined ? patch.fetchPages : current.fetchPages;
  const rawLowDiscount = patch.minDiscount !== undefined ? patch.minDiscount : current.minDiscount;
  const rawNotifyDiscount =
    patch.notifyMinDiscount !== undefined ? patch.notifyMinDiscount : current.notifyMinDiscount;

  const settings: Settings = {
    country: patch.country !== undefined ? patch.country : current.country,
    language: patch.language !== undefined ? patch.language : current.language,
    refreshMinutes: clamp(Math.round(rawRefresh > 0 ? rawRefresh : 60), 15, 24 * 60),
    fetchPages: clamp(Math.round(rawFetch > 0 ? rawFetch : 3), 1, 6),
    minDiscount: clamp(Math.round(rawLowDiscount), 0, 95),
    sort: patch.sort !== undefined ? patch.sort : current.sort,
    notifyEnabled: patch.notifyEnabled !== undefined ? patch.notifyEnabled : current.notifyEnabled,
    notifyMinDiscount: clamp(Math.round(rawNotifyDiscount), 0, 95),
    notifyNewLow: patch.notifyNewLow !== undefined ? patch.notifyNewLow : current.notifyNewLow,
    quietHours: quiet,
    onlyPlatform: patch.onlyPlatform !== undefined ? patch.onlyPlatform : current.onlyPlatform,
    theme: patch.theme !== undefined ? patch.theme : current.theme,
    closeToTray: patch.closeToTray !== undefined ? patch.closeToTray : current.closeToTray,
    autoLaunch: patch.autoLaunch !== undefined ? patch.autoLaunch : current.autoLaunch,
    autoUpdateApp: patch.autoUpdateApp !== undefined ? patch.autoUpdateApp : current.autoUpdateApp
  };
  return settings;
}

/** 区域 -> 货币，与 core/format.ts 的映射保持一致 */
export function regionCurrency(country: string): string {
  switch (country.toLowerCase()) {
    case 'cn':
      return 'CNY';
    case 'hk':
      return 'HKD';
    case 'tw':
      return 'TWD';
    case 'us':
      return 'USD';
    case 'jp':
      return 'JPY';
    case 'de':
    case 'fr':
      return 'EUR';
    case 'gb':
      return 'GBP';
    case 'ru':
      return 'RUB';
    case 'br':
      return 'BRL';
    case 'kr':
      return 'KRW';
    case 'ca':
      return 'CAD';
    case 'au':
      return 'AUD';
    case 'sg':
      return 'SGD';
    case 'in':
      return 'INR';
    case 'tr':
      return 'TRY';
    case 'ar':
      return 'ARS';
    case 'mx':
      return 'MXN';
    case 'pl':
      return 'PLN';
    case 'ua':
      return 'UAH';
    default:
      return 'USD';
  }
}

export function currencySymbol(currency: string): string {
  switch (currency) {
    case 'CNY':
      return '¥';
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    case 'JPY':
      return '¥';
    case 'HKD':
      return 'HK$';
    case 'TWD':
      return 'NT$';
    case 'RUB':
      return '₽';
    case 'BRL':
      return 'R$';
    case 'KRW':
      return '₩';
    default:
      return currency + ' ';
  }
}

function hasZeroDecimal(currency: string): boolean {
  return currency === 'JPY' || currency === 'KRW' || currency === 'VND' || currency === 'CLP';
}

/**
 * 金额格式化。ArkTS 对 Intl 的支持因设备而异，这里用固定规则实现，
 * 展示效果与 core 的 formatMoney 基本一致（如 ¥73.00 / HK$78.00 / ¥ 1200）。
 * 通知文案优先使用 Steam 返回的 finalPriceText，因此不会影响原价/现价文本。
 */
export function formatMoney(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) {
    return '—';
  }
  const digits = hasZeroDecimal(currency) ? 0 : 2;
  const value = minor / 100;
  return currencySymbol(currency) + value.toFixed(digits);
}

/** 与 core/store.ts 的 buildNotification 文案保持一致 */
export function buildNotification(
  kind: NotifyKind,
  entry: WatchEntry,
  quote: WatchQuote,
  targetPrice: number | undefined,
  previousLow: number | undefined,
  currency: string
): AppNotification {
  const priceText = quote.priceText !== undefined ? quote.priceText : formatMoney(quote.price, currency);
  const originalText = quote.originalPrice !== undefined ? formatMoney(quote.originalPrice, currency) : undefined;
  const off = quote.discount > 0 ? `−${quote.discount}%` : '';
  const priceWithOff = off.length > 0 ? `${priceText}（${off}）` : priceText;

  let title = '';
  let body = '';
  if (kind === 'target') {
    title = `到价提醒 · ${entry.name}`;
    body = `现价 ${priceWithOff}，已经达到你设置的目标价 ${formatMoney(targetPrice, currency)}。`;
  } else if (kind === 'newlow') {
    title = `新史低 · ${entry.name}`;
    body = `现价 ${priceWithOff}，低于此前记录的最低价格 ${formatMoney(previousLow, currency)}。`;
  } else if (kind === 'digest') {
    title = `关注列表有 ${entry.name} 等游戏在打折`;
    body = `现价 ${priceWithOff}。`;
  } else {
    title = `折扣提醒 · ${entry.name}`;
    body = `现价 ${priceWithOff}${originalText !== undefined ? `，原价 ${originalText}` : ''}。`;
  }

  const notification: AppNotification = {
    kind: kind,
    appId: entry.appId,
    title: title,
    body: body,
    storeUrl: quote.storeUrl,
    image: quote.image !== undefined ? quote.image : entry.image
  };
  return notification;
}

/**
 * 合并「旧 Deal」与「新抓到的 Deal」。
 * 语义等价于 core/store.ts 里的 { ...previous, ...stripUndefined(incoming) }：
 * incoming 中未提供的可选字段保留旧值（例如详情页才有的 description / developers）。
 */
export function mergeDeal(previous: Deal, incoming: Deal): Deal {
  const merged: Deal = {
    appId: incoming.appId,
    name: incoming.name,
    image: incoming.image !== undefined ? incoming.image : previous.image,
    discountPercent: incoming.discountPercent,
    originalPrice: incoming.originalPrice !== undefined ? incoming.originalPrice : previous.originalPrice,
    finalPrice: incoming.finalPrice !== undefined ? incoming.finalPrice : previous.finalPrice,
    originalPriceText:
      incoming.originalPriceText !== undefined ? incoming.originalPriceText : previous.originalPriceText,
    finalPriceText: incoming.finalPriceText !== undefined ? incoming.finalPriceText : previous.finalPriceText,
    currency: incoming.currency !== undefined ? incoming.currency : previous.currency,
    platforms: incoming.platforms,
    releaseDate: incoming.releaseDate !== undefined ? incoming.releaseDate : previous.releaseDate,
    reviewSummary: incoming.reviewSummary !== undefined ? incoming.reviewSummary : previous.reviewSummary,
    reviewPercent: incoming.reviewPercent !== undefined ? incoming.reviewPercent : previous.reviewPercent,
    discountEndsAt: incoming.discountEndsAt !== undefined ? incoming.discountEndsAt : previous.discountEndsAt,
    storeUrl: incoming.storeUrl,
    tags: incoming.tags !== undefined ? incoming.tags : previous.tags,
    description: incoming.description !== undefined ? incoming.description : previous.description,
    developers: incoming.developers !== undefined ? incoming.developers : previous.developers
  };
  return merged;
}

/** 仅用于从错误对象里安全读取 message 字段 */
interface MessageBearer {
  message?: string;
}

/** 统一的错误文案提取，避免 ArkTS 里到处写 any/unknown */
export function toMessage(error: Object): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  // 部分 @ohos 接口抛出的 BusinessError 在跨语言边界时不一定是 Error 实例
  const bearer = error as MessageBearer;
  const carried = bearer.message;
  if (typeof carried === 'string' && carried.length > 0) {
    return carried;
  }
  const text = String(error);
  if (text.length === 0 || text === 'undefined' || text === '[object Object]') {
    return '操作失败';
  }
  return text;
}
