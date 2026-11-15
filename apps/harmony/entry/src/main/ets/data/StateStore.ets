/**
 * 状态持久化：用 @ohos.data.preferences 保存一条 JSON 字符串（key = radar-state）。
 *
 * 该 JSON 与桌面端 packages/core/src/store.ts 的 PersistedState 结构完全一致，
 * 因此：
 * - 桌面端导出的备份可以直接 importData；
 * - 鸿蒙端 exportData 的结果也能被桌面端导入。
 */

import preferences from '@ohos.data.preferences';
import common from '@ohos.app.ability.common';
import { BusinessError } from '@ohos.base';
import {
  createEmptyState,
  Deal,
  mergeDeal,
  NotifiedMark,
  NotifyKind,
  PersistedState,
  PricePoint,
  sanitizeSettings,
  Settings,
  SettingsPatch,
  STATE_VERSION,
  WatchEntry,
  WatchPatch,
  WatchQuote
} from './Types';

/** preferences 实例名 */
const PREF_STORE_NAME: string = 'radar';
/** 与需求约定的键名一致：桌面端文件叫 radar-state.json，这里用 radar-state */
const STATE_KEY: string = 'radar-state';

interface ExportedState extends PersistedState {
  exportedAt: number;
}

export class StateStore {
  state: PersistedState = createEmptyState();
  private context: common.Context;
  private prefs: preferences.Preferences | null = null;
  private saveTimer: number = -1;

  constructor(context: common.Context) {
    this.context = context;
  }

  /** 首次读取本地状态；重复调用会直接返回 */
  async init(): Promise<void> {
    if (this.prefs !== null) {
      return;
    }
    try {
      const options: preferences.Options = { name: PREF_STORE_NAME };
      const prefs = await preferences.getPreferences(this.context, options);
      this.prefs = prefs;
      const raw = await prefs.get(STATE_KEY, '');
      if (typeof raw === 'string' && raw.length > 0) {
        try {
          const parsed = JSON.parse(raw) as PersistedState;
          if (parsed !== null && typeof parsed === 'object') {
            this.state = normalizeState(parsed, false);
          }
        } catch (parseError) {
          console.error('[radar] 本地状态 JSON 损坏，已重置缓存');
          this.state = createEmptyState();
        }
      }
    } catch (err) {
      const error = err as BusinessError;
      console.error(`[radar] 读取本地状态失败: code=${error.code} message=${error.message}`);
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

  /** 防抖保存，避免高频写入 preferences */
  scheduleSave(delay: number = 400): void {
    if (this.saveTimer !== -1) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = -1;
      this.flush();
    }, delay);
  }

  /** 立即落盘。flush 内部已捕获异常，不会向调用方抛出。 */
  async flush(): Promise<void> {
    if (this.saveTimer !== -1) {
      clearTimeout(this.saveTimer);
      this.saveTimer = -1;
    }
    if (this.prefs === null) {
      await this.init();
    }
    if (this.prefs === null) {
      return;
    }
    try {
      const payload = JSON.stringify(this.state);
      await this.prefs.put(STATE_KEY, payload);
      await this.prefs.flush();
    } catch (err) {
      const error = err as BusinessError;
      console.error(`[radar] 保存状态失败: code=${error.code} message=${error.message}`);
    }
  }

  updateSettings(patch: SettingsPatch): Settings {
    this.state.settings = sanitizeSettings(patch, this.state.settings);
    this.scheduleSave();
    return this.state.settings;
  }

  isWatched(appId: number): boolean {
    return this.findWatch(appId) !== undefined;
  }

  private findWatch(appId: number): WatchEntry | undefined {
    for (const entry of this.state.watchlist) {
      if (entry.appId === appId) {
        return entry;
      }
    }
    return undefined;
  }

  addWatch(appId: number, name: string, image: string | undefined, targetPrice: number | undefined): WatchEntry {
    const existing = this.findWatch(appId);
    if (existing !== undefined) {
      return existing;
    }
    const entry: WatchEntry = {
      appId: appId,
      name: name,
      addedAt: Date.now(),
      notifyAny: true
    };
    if (targetPrice !== undefined) {
      entry.targetPrice = targetPrice;
    }
    if (image !== undefined) {
      entry.image = image;
    }
    this.state.watchlist.unshift(entry);
    this.scheduleSave();
    return entry;
  }

  updateWatch(appId: number, patch: WatchPatch): WatchEntry | undefined {
    const entry = this.findWatch(appId);
    if (entry === undefined) {
      return undefined;
    }
    if (patch.name !== undefined) {
      entry.name = patch.name;
    }
    if (patch.image !== undefined) {
      entry.image = patch.image;
    }
    if (patch.note !== undefined) {
      entry.note = patch.note;
    }
    if (patch.notifyAny !== undefined) {
      entry.notifyAny = patch.notifyAny;
    }
    if (patch.targetPrice !== undefined) {
      if (patch.targetPrice === null) {
        entry.targetPrice = undefined;
      } else {
        entry.targetPrice = patch.targetPrice;
      }
    }
    this.scheduleSave();
    return entry;
  }

  removeWatch(appId: number): boolean {
    const before = this.state.watchlist.length;
    const next: WatchEntry[] = [];
    for (const entry of this.state.watchlist) {
      if (entry.appId !== appId) {
        next.push(entry);
      }
    }
    this.state.watchlist = next;
    const removed = this.state.watchlist.length !== before;
    if (removed) {
      this.scheduleSave();
    }
    return removed;
  }

  /** 记录本轮已提醒，用于 12 小时内同价去重 */
  markNotified(appId: number, price: number, discount: number, kind: NotifyKind, at: number): void {
    const entry = this.findWatch(appId);
    if (entry === undefined) {
      return;
    }
    const mark: NotifiedMark = {
      price: price,
      discount: discount,
      at: at,
      kind: kind
    };
    entry.lastNotified = mark;
    this.scheduleSave();
  }

  /** 合并抓取结果：保留旧对象里新结果未覆盖的字段 */
  mergeDeals(incoming: Deal[]): Deal[] {
    const byId = new Map<number, Deal>();
    for (const deal of this.state.deals) {
      byId.set(deal.appId, deal);
    }
    for (const deal of incoming) {
      const previous = byId.get(deal.appId);
      byId.set(deal.appId, previous !== undefined ? mergeDeal(previous, deal) : deal);
    }
    const merged: Deal[] = [];
    byId.forEach((deal: Deal) => {
      merged.push(deal);
    });
    this.state.deals = merged;
    return this.state.deals;
  }

  setDeals(deals: Deal[]): void {
    this.state.deals = deals;
  }

  setQuote(quote: WatchQuote): void {
    this.state.watchQuotes[String(quote.appId)] = quote;
  }

  deleteQuote(appId: number): void {
    const key = String(appId);
    const next: Record<string, WatchQuote> = {};
    for (const currentKey of Object.keys(this.state.watchQuotes)) {
      const quote = this.state.watchQuotes[currentKey];
      if (currentKey !== key && quote !== undefined) {
        next[currentKey] = quote;
      }
    }
    this.state.watchQuotes = next;
  }

  /**
   * 记录价格历史与历史最低价。
   * 规则与 core/store.ts 的 recordPrice 一致：价格相同且 6 小时内不重复打点，最多保留 90 个点。
   */
  recordPrice(appId: number, price: number, discount: number): void {
    if (!Number.isFinite(price) || price <= 0) {
      return;
    }
    const key = String(appId);
    const previousLow = this.state.lowest[key];
    if (previousLow === undefined || price < previousLow) {
      this.state.lowest[key] = price;
    }
    const existingHistory = this.state.history[key];
    const history: PricePoint[] = existingHistory !== undefined ? existingHistory : [];
    const last = history.length > 0 ? history[history.length - 1] : undefined;
    const now = Date.now();
    if (last === undefined || last.price !== price || now - last.at > 6 * 3_600_000) {
      const point: PricePoint = { at: now, price: price, discount: discount };
      history.push(point);
      if (history.length > 90) {
        history.splice(0, history.length - 90);
      }
      this.state.history[key] = history;
    }
  }

  /** 导出为与桌面端一致的 JSON 字符串（多一个 exportedAt 字段，导入时会被忽略） */
  exportState(): string {
    const payload: ExportedState = {
      version: this.state.version,
      settings: this.state.settings,
      watchlist: this.state.watchlist,
      deals: this.state.deals,
      watchQuotes: this.state.watchQuotes,
      lowest: this.state.lowest,
      history: this.state.history,
      lastRefreshAt: this.state.lastRefreshAt,
      lastRefreshError: this.state.lastRefreshError,
      exportedAt: Date.now()
    };
    return JSON.stringify(payload, null, 2);
  }

  /** 用导入的 JSON 覆盖本地状态（与 core/store.ts 的 importState 语义一致） */
  async importState(json: string): Promise<void> {
    let parsed: PersistedState | null = null;
    try {
      parsed = JSON.parse(json) as PersistedState;
    } catch (parseError) {
      throw new Error('文件格式不正确');
    }
    if (parsed === null || typeof parsed !== 'object') {
      throw new Error('文件格式不正确');
    }
    this.state = normalizeState(parsed, true);
    await this.flush();
  }
}

/**
 * 把任意来源的状态 JSON 归一化成完整 PersistedState。
 * 缺字段补默认值，设置项走 sanitizeSettings，避免旧备份导致崩溃。
 */
function normalizeState(parsed: PersistedState, imported: boolean): PersistedState {
  const base = createEmptyState();
  const settingsPatch: SettingsPatch =
    parsed.settings !== undefined && parsed.settings !== null ? parsed.settings : {};
  const watchlist: WatchEntry[] = Array.isArray(parsed.watchlist) ? parsed.watchlist : [];
  const deals: Deal[] = Array.isArray(parsed.deals) ? parsed.deals : [];
  const watchQuotes: Record<string, WatchQuote> =
    parsed.watchQuotes !== undefined && parsed.watchQuotes !== null ? parsed.watchQuotes : {};
  const lowest: Record<string, number> =
    parsed.lowest !== undefined && parsed.lowest !== null ? parsed.lowest : {};
  const history: Record<string, PricePoint[]> =
    parsed.history !== undefined && parsed.history !== null ? parsed.history : {};
  const lastRefreshError = imported
    ? null
    : parsed.lastRefreshError !== undefined
      ? parsed.lastRefreshError
      : null;

  const state: PersistedState = {
    version: STATE_VERSION,
    settings: sanitizeSettings(settingsPatch, base.settings),
    watchlist: watchlist,
    deals: deals,
    watchQuotes: watchQuotes,
    lowest: lowest,
    history: history,
    lastRefreshAt: parsed.lastRefreshAt !== undefined ? parsed.lastRefreshAt : null,
    lastRefreshError: lastRefreshError
  };
  return state;
}
