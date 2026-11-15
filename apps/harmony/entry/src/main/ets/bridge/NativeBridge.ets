/**
 * WebView 原生桥。
 *
 * 渲染层通过 javaScriptProxy 注入的 window.nativeBridge 调用：
 *   invoke(method, payloadJson, callbackId): void
 * 原生端异步处理完成后，用 webviewController.runJavaScript 回调：
 *   window.__radarResolve(callbackId, ok, payloadJson)
 * 失败时 payloadJson 为 {"message":"..."}。
 *
 * 事件通过 window.__radarEvent(eventJson) 推送；页面未加载完成时先入队，
 * onPageEnd 后统一补发，避免启动阶段的 snapshot 丢失。
 */

import common from '@ohos.app.ability.common';
import Want from '@ohos.app.ability.Want';
import webview from '@ohos.web.webview';
import url from '@ohos.url';
import pasteboard from '@ohos.pasteboard';
import deviceInfo from '@ohos.deviceInfo';
import { BusinessError } from '@ohos.base';
import { RadarEngine } from '../data/RadarEngine';
import { StateStore } from '../data/StateStore';
import { SteamClient } from '../data/SteamClient';
import {
  APP_VERSION,
  AppInfo,
  Capabilities,
  Deal,
  ErrorPayload,
  QuietHoursPatch,
  RadarEvent,
  SettingsPatch,
  snapshotEvent,
  SortKey,
  ThemeMode,
  PlatformFilter,
  toMessage,
  TranslationResult,
  UpdateStatus,
  updateEvent,
  WatchPatch
} from '../data/Types';
import { Notifier } from '../notify/Notifier';
import { scheduleBackgroundRefresh } from '../work/RefreshWork';

/** 允许 openExternal 打开的白名单域名，与 core/controller.ts 一致 */
const ALLOWED_HOSTS: string[] = ['store.steampowered.com', 'steamcommunity.com', 'help.steampowered.com'];
/** 页面未就绪时最多缓存的事件数量 */
const EVENT_QUEUE_LIMIT: number = 32;
/** 页面未就绪时最多缓存的回调数量 */
const REPLY_QUEUE_LIMIT: number = 64;

interface PendingReply {
  callbackId: string;
  ok: boolean;
  payloadJson: string;
}

export class NativeBridge {
  private context: common.UIAbilityContext | null = null;
  private controller: webview.WebviewController | null = null;
  private engine: RadarEngine | null = null;
  private ready: Promise<void> = Promise.resolve();
  private pageReady: boolean = false;
  private pendingEvents: string[] = [];
  private pendingReplies: PendingReply[] = [];
  /** 已注册的后台刷新间隔，避免改主题等无关设置时重置 WorkScheduler 计时 */
  private scheduledMinutes: number = 0;

  /**
   * 由 Index 在 aboutToAppear 中调用。
   * 引擎在这里创建，随后 javaScriptProxy 会把本对象注入为 window.nativeBridge。
   */
  attach(context: common.UIAbilityContext, controller: webview.WebviewController): void {
    this.context = context;
    this.controller = controller;
    if (this.engine !== null) {
      return;
    }
    const store = new StateStore(context);
    const engine = new RadarEngine(
      store,
      new SteamClient(),
      new Notifier(),
      APP_VERSION,
      (event: RadarEvent): void => {
        this.emitEvent(event);
      }
    );
    this.engine = engine;
    this.ready = engine
      .init()
      .then((): void => {
        // 已保存设置可能是 15/30/120 分钟，读取后重新注册后台任务
        this.syncSchedule(engine.settings.refreshMinutes);
      })
      .catch((err: Object): void => {
        console.error(`[radar] 数据引擎初始化失败: ${toMessage(err)}`);
      });
  }

  /** window.nativeBridge.platform() */
  platform(): string {
    return 'harmony';
  }

  /** window.nativeBridge.version() */
  version(): string {
    return APP_VERSION;
  }

  /** 页面开始加载：重新进入未就绪状态，并丢弃上一页未送达的回调 */
  onPageBegin(): void {
    this.pageReady = false;
    this.pendingReplies = [];
  }

  /** onPageEnd：标记页面就绪，补发缓存事件，并触发启动自动刷新 */
  onPageReady(controller: webview.WebviewController): void {
    this.controller = controller;
    this.pageReady = true;
    // 先补发页面加载期间累积的调用回调，再补发事件
    const replies = this.pendingReplies;
    this.pendingReplies = [];
    for (const reply of replies) {
      this.dispatchResolve(reply.callbackId, reply.ok, reply.payloadJson);
    }
    const queued = this.pendingEvents;
    this.pendingEvents = [];
    for (const json of queued) {
      this.dispatchEvent(json);
    }
    this.ready
      .then((): void => {
        const engine = this.engine;
        if (engine === null) {
          return;
        }
        const idle: UpdateStatus = { phase: 'idle' };
        this.emitEvent(updateEvent(idle));
        this.emitEvent(snapshotEvent(engine.snapshot()));
        // 启动时数据为空或超过 refreshMinutes 才自动刷新
        engine.refreshIfStale().catch((err: Object): void => {
          console.warn(`[radar] 启动刷新失败: ${toMessage(err)}`);
        });
      })
      .catch((err: Object): void => {
        console.error(`[radar] 页面就绪初始化失败: ${toMessage(err)}`);
      });
  }

  /** 从后台回到前台时检查数据是否过期 */
  onForeground(): void {
    this.ready
      .then((): void => {
        const engine = this.engine;
        if (engine === null) {
          return;
        }
        // 回到前台先推一份当前快照，避免后台期间 UI 没有合并到最新状态
        this.emitEvent(snapshotEvent(engine.snapshot()));
        engine.refreshIfStale().catch((err: Object): void => {
          console.warn(`[radar] 前台刷新失败: ${toMessage(err)}`);
        });
      })
      .catch((err: Object): void => {
        console.warn(`[radar] 前台检查失败: ${toMessage(err)}`);
      });
  }

  /** window.nativeBridge.invoke(method, payloadJson, callbackId) */
  invoke(method: string, payloadJson: string, callbackId: string): void {
    this.handle(method, payloadJson, callbackId).catch((err: Object): void => {
      const payload: ErrorPayload = { message: toMessage(err) };
      this.resolve(callbackId, false, encodeJson(payload));
    });
  }

  /* ---------- 方法分发 ---------- */

  private async handle(method: string, payloadJson: string, callbackId: string): Promise<void> {
    await this.ready;
    const engine = this.engine;
    if (engine === null) {
      throw new Error('原生桥尚未初始化');
    }
    const payload = parsePayload(payloadJson);

    switch (method) {
      case 'snapshot': {
        this.resolve(callbackId, true, encodeJson(engine.snapshot()));
        return;
      }
      case 'refresh': {
        const result = await engine.refresh();
        this.resolve(callbackId, true, encodeJson(result));
        return;
      }
      case 'watch': {
        const appId = readNumber(payload, 'appId', 0);
        const name = readString(payload, 'name') ?? '';
        if (appId <= 0 || name.length === 0) {
          throw new Error('关注参数不完整');
        }
        const entry = engine.watch(appId, name, readString(payload, 'image'), readOptionalNumber(payload, 'targetPrice'));
        this.emitEvent(snapshotEvent(engine.snapshot()));
        this.resolve(callbackId, true, encodeJson(entry));
        return;
      }
      case 'unwatch': {
        const appId = readNumber(payload, 'appId', 0);
        const removed = engine.unwatch(appId);
        this.emitEvent(snapshotEvent(engine.snapshot()));
        this.resolve(callbackId, true, removed ? 'true' : 'false');
        return;
      }
      case 'updateWatch': {
        const appId = readNumber(payload, 'appId', 0);
        let patch: WatchPatch = {};
        const rawPatch = payload['patch'];
        if (rawPatch !== undefined && rawPatch !== null && typeof rawPatch === 'object') {
          patch = parseWatchPatch(rawPatch as Record<string, Object>);
        }
        const entry = engine.updateWatch(appId, patch);
        this.emitEvent(snapshotEvent(engine.snapshot()));
        this.resolve(callbackId, true, entry !== undefined ? encodeJson(entry) : 'null');
        return;
      }
      case 'updateSettings': {
        let patch: SettingsPatch = {};
        const rawPatch = payload['patch'];
        if (rawPatch !== undefined && rawPatch !== null && typeof rawPatch === 'object') {
          patch = parseSettingsPatch(rawPatch as Record<string, Object>);
        }
        const settings = engine.updateSettings(patch);
        // 刷新间隔变化后同步后台任务
        this.syncSchedule(settings.refreshMinutes);
        this.emitEvent(snapshotEvent(engine.snapshot()));
        this.resolve(callbackId, true, encodeJson(settings));
        return;
      }
      case 'search': {
        const term = readString(payload, 'term') ?? '';
        const hits = await engine.search(term);
        this.resolve(callbackId, true, encodeJson(hits));
        return;
      }
      case 'details': {
        const appId = readNumber(payload, 'appId', 0);
        const deal: Deal | null = await engine.loadDetails(appId);
        this.emitEvent(snapshotEvent(engine.snapshot()));
        this.resolve(callbackId, true, deal !== null ? encodeJson(deal) : 'null');
        return;
      }
      case 'reviews': {
        const appId = readNumber(payload, 'appId', 0);
        if (appId <= 0) {
          throw new Error('appId 不合法');
        }
        const next = readStringRecord(payload, 'next');
        // language 可选：payload 里没有该字段时 readString 返回 undefined，表示全部语言
        const language = readString(payload, 'language');
        const page = await engine.reviews(appId, next, language);
        this.resolve(callbackId, true, encodeJson(page));
        return;
      }
      case 'translate': {
        const text = readString(payload, 'text') ?? '';
        if (text.trim().length === 0) {
          throw new Error('翻译内容为空');
        }
        const target = readString(payload, 'target');
        const result: TranslationResult = await engine.translate(text, target);
        this.resolve(callbackId, true, encodeJson(result));
        return;
      }
      case 'openExternal': {
        const target = readString(payload, 'url') ?? '';
        await this.openExternal(target);
        this.resolve(callbackId, true, '');
        return;
      }
      case 'openStore': {
        const appId = readNumber(payload, 'appId', 0);
        if (appId <= 0) {
          throw new Error('appId 不合法');
        }
        await this.openExternal(`https://store.steampowered.com/app/${appId}`);
        this.resolve(callbackId, true, '');
        return;
      }
      case 'testNotification': {
        await engine.testNotification();
        this.resolve(callbackId, true, '');
        return;
      }
      case 'checkUpdate': {
        const status: UpdateStatus = { phase: 'unsupported' };
        this.resolve(callbackId, true, encodeJson(status));
        return;
      }
      case 'installUpdate': {
        // 鸿蒙由应用市场负责更新
        this.resolve(callbackId, true, '');
        return;
      }
      case 'exportData': {
        const json = engine.exportData();
        // 结果本身是 JSON 字符串，需要再 JSON 编码一次作为 JS 字符串参数
        this.resolve(callbackId, true, encodeJsonString(json));
        return;
      }
      case 'importData': {
        const json = readString(payload, 'json') ?? '';
        if (json.length === 0) {
          throw new Error('导入内容为空');
        }
        await engine.importData(json);
        this.syncSchedule(engine.settings.refreshMinutes);
        this.emitEvent(snapshotEvent(engine.snapshot()));
        this.resolve(callbackId, true, '');
        return;
      }
      case 'copyText': {
        const text = readString(payload, 'text') ?? '';
        await this.copyText(text);
        // 与渲染层约定：成功返回 JSON 的 null
        this.resolve(callbackId, true, 'null');
        return;
      }
      case 'quit': {
        await this.quitApp();
        this.resolve(callbackId, true, '');
        return;
      }
      case 'appInfo': {
        this.resolve(callbackId, true, encodeJson(this.buildAppInfo()));
        return;
      }
      default:
        throw new Error(`未知方法: ${method}`);
    }
  }

  /** 仅在刷新间隔真的变化时重注册，避免无谓地重置后台任务计时 */
  private syncSchedule(minutes: number): void {
    if (this.scheduledMinutes === minutes) {
      return;
    }
    this.scheduledMinutes = minutes;
    scheduleBackgroundRefresh(minutes);
  }

  /* ---------- 平台能力 ---------- */

  private buildAppInfo(): AppInfo {
    const capabilities: Capabilities = {
      notifications: true,
      autoUpdate: false,
      tray: false,
      background: true,
      importExport: true
    };
    const info: AppInfo = {
      version: APP_VERSION,
      platform: 'harmony',
      os: `${deviceInfo.osFullName} (${deviceInfo.productModel})`,
      capabilities: capabilities
    };
    if (this.context !== null) {
      info.dataDir = this.context.preferencesDir;
    }
    return info;
  }

  /**
   * 只允许 https 且域名在白名单内的链接，与桌面端 controller.ts 的 safeUrl 一致。
   * 用系统浏览器打开：startAbility + viewData + browsable。
   */
  private async openExternal(raw: string): Promise<void> {
    if (raw.length === 0) {
      throw new Error('不支持打开的链接');
    }
    const parsed = parseSafeUrl(raw);
    if (parsed.protocol !== 'https:') {
      throw new Error('不支持打开的链接');
    }
    const host = parsed.hostname.toLowerCase();
    let allowed = false;
    for (const item of ALLOWED_HOSTS) {
      if (host === item || host.endsWith(`.${item}`)) {
        allowed = true;
        break;
      }
    }
    if (!allowed) {
      throw new Error('不支持打开的链接');
    }
    const context = this.context;
    if (context === null) {
      throw new Error('应用上下文未就绪');
    }
    const want: Want = {
      action: 'ohos.want.action.viewData',
      entities: ['entity.system.browsable'],
      uri: parsed.toString()
    };
    await context.startAbility(want);
  }

  /** 写系统剪贴板；失败统一映射为「剪贴板不可用」 */
  private async copyText(text: string): Promise<void> {
    try {
      const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
      const board = pasteboard.getSystemPasteboard();
      await board.setData(data);
    } catch (err) {
      throw new Error('剪贴板不可用');
    }
  }

  /** 退出当前 UIAbility */
  private async quitApp(): Promise<void> {
    const context = this.context;
    if (context === null) {
      return;
    }
    await context.terminateSelf();
  }

  /* ---------- JS 回调与事件推送 ---------- */

  /** 处理完成/失败后回传结果；调用前统一 try/catch，页面未加载时忽略 */
  private resolve(callbackId: string, ok: boolean, payloadJson: string): void {
    // 页面还没到 onPageEnd 时先入队：runJavaScript 在部分版本上要等页面加载完成后才可靠
    if (!this.pageReady || this.controller === null) {
      const reply: PendingReply = {
        callbackId: callbackId,
        ok: ok,
        payloadJson: payloadJson
      };
      this.pendingReplies.push(reply);
      if (this.pendingReplies.length > REPLY_QUEUE_LIMIT) {
        this.pendingReplies.shift();
      }
      return;
    }
    this.dispatchResolve(callbackId, ok, payloadJson);
  }

  private dispatchResolve(callbackId: string, ok: boolean, payloadJson: string): void {
    const controller = this.controller;
    if (controller === null) {
      return;
    }
    const idLiteral = encodeJsonString(callbackId);
    const payloadLiteral = encodeJsonString(payloadJson);
    const script =
      `try{if(window.__radarResolve){window.__radarResolve(${idLiteral},${ok ? 'true' : 'false'},${payloadLiteral});}}catch(e){}`;
    controller.runJavaScript(script).catch((err: BusinessError): void => {
      console.warn(`[radar] __radarResolve 调用失败: ${err.message}`);
    });
  }

  private emitEvent(event: RadarEvent): void {
    const json = JSON.stringify(event);
    if (json === undefined) {
      return;
    }
    if (!this.pageReady || this.controller === null) {
      this.pendingEvents.push(json);
      if (this.pendingEvents.length > EVENT_QUEUE_LIMIT) {
        this.pendingEvents.shift();
      }
      return;
    }
    this.dispatchEvent(json);
  }

  private dispatchEvent(json: string): void {
    const controller = this.controller;
    if (controller === null) {
      return;
    }
    const eventLiteral = encodeJsonString(json);
    const script = `try{if(window.__radarEvent){window.__radarEvent(${eventLiteral});}}catch(e){}`;
    controller.runJavaScript(script).catch((err: BusinessError): void => {
      console.warn(`[radar] __radarEvent 调用失败: ${err.message}`);
    });
  }
}

/* ---------- 工具函数 ---------- */

function encodeJson(value: Object): string {
  const text = JSON.stringify(value);
  return text !== undefined ? text : 'null';
}

function encodeJsonString(value: string): string {
  const text = JSON.stringify(value);
  return text !== undefined ? text : '""';
}

function parseSafeUrl(raw: string): url.URL {
  try {
    return url.URL.parseURL(raw);
  } catch (err) {
    throw new Error('不支持打开的链接');
  }
}

function parsePayload(json: string): Record<string, Object> {
  if (json.length === 0 || json === 'null') {
    return {};
  }
  try {
    const parsed = JSON.parse(json) as Record<string, Object>;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (err) {
    return {};
  }
}

function readString(record: Record<string, Object>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(record: Record<string, Object>, key: string, fallback: number): number {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

/** next 是上一页返回的分页参数；只接受字符串值，非法结构视为没有下一页 */
function readStringRecord(record: Record<string, Object>, key: string): Record<string, string> | undefined {
  const value = record[key];
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, Object>;
  const result: Record<string, string> = {};
  for (const field of Object.keys(source)) {
    const item = source[field];
    if (typeof item === 'string') {
      result[field] = item;
    }
  }
  return result;
}

function readOptionalNumber(record: Record<string, Object>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function parseWatchPatch(record: Record<string, Object>): WatchPatch {
  const patch: WatchPatch = {};

  // 渲染层清除目标价时显式发送 { targetPrice: null }；空 patch 则保持无变化
  const targetPrice = record['targetPrice'];
  if (targetPrice !== undefined) {
    if (targetPrice === null) {
      patch.targetPrice = null;
    } else if (typeof targetPrice === 'number' && Number.isFinite(targetPrice) && targetPrice >= 0) {
      patch.targetPrice = targetPrice;
    }
  }
  const note = record['note'];
  if (typeof note === 'string') {
    patch.note = note;
  }
  const notifyAny = record['notifyAny'];
  if (typeof notifyAny === 'boolean') {
    patch.notifyAny = notifyAny;
  }
  const name = record['name'];
  if (typeof name === 'string') {
    patch.name = name;
  }
  const image = record['image'];
  if (typeof image === 'string') {
    patch.image = image;
  }
  return patch;
}

function parseSettingsPatch(record: Record<string, Object>): SettingsPatch {
  const patch: SettingsPatch = {};

  const country = readString(record, 'country');
  if (country !== undefined) {
    patch.country = country;
  }
  const language = readString(record, 'language');
  if (language !== undefined) {
    patch.language = language;
  }
  const refreshMinutes = readOptionalNumber(record, 'refreshMinutes');
  if (refreshMinutes !== undefined) {
    patch.refreshMinutes = refreshMinutes;
  }
  const fetchPages = readOptionalNumber(record, 'fetchPages');
  if (fetchPages !== undefined) {
    patch.fetchPages = fetchPages;
  }
  const minDiscount = readOptionalNumber(record, 'minDiscount');
  if (minDiscount !== undefined) {
    patch.minDiscount = minDiscount;
  }

  const sort = parseSortKey(readString(record, 'sort'));
  if (sort !== undefined) {
    patch.sort = sort;
  }
  const notifyEnabled = record['notifyEnabled'];
  if (typeof notifyEnabled === 'boolean') {
    patch.notifyEnabled = notifyEnabled;
  }
  const notifyMinDiscount = readOptionalNumber(record, 'notifyMinDiscount');
  if (notifyMinDiscount !== undefined) {
    patch.notifyMinDiscount = notifyMinDiscount;
  }
  const notifyNewLow = record['notifyNewLow'];
  if (typeof notifyNewLow === 'boolean') {
    patch.notifyNewLow = notifyNewLow;
  }
  const onlyPlatform = parsePlatformFilter(readString(record, 'onlyPlatform'));
  if (onlyPlatform !== undefined) {
    patch.onlyPlatform = onlyPlatform;
  }
  const theme = parseTheme(readString(record, 'theme'));
  if (theme !== undefined) {
    patch.theme = theme;
  }
  const closeToTray = record['closeToTray'];
  if (typeof closeToTray === 'boolean') {
    patch.closeToTray = closeToTray;
  }
  const autoLaunch = record['autoLaunch'];
  if (typeof autoLaunch === 'boolean') {
    patch.autoLaunch = autoLaunch;
  }
  const autoUpdateApp = record['autoUpdateApp'];
  if (typeof autoUpdateApp === 'boolean') {
    patch.autoUpdateApp = autoUpdateApp;
  }

  const quietValue = record['quietHours'];
  if (quietValue !== undefined && quietValue !== null && typeof quietValue === 'object') {
    const quietRecord = quietValue as Record<string, Object>;
    const quiet: QuietHoursPatch = {};
    const enabled = quietRecord['enabled'];
    if (typeof enabled === 'boolean') {
      quiet.enabled = enabled;
    }
    const start = readOptionalNumber(quietRecord, 'start');
    if (start !== undefined) {
      quiet.start = start;
    }
    const end = readOptionalNumber(quietRecord, 'end');
    if (end !== undefined) {
      quiet.end = end;
    }
    patch.quietHours = quiet;
  }
  return patch;
}

function parseSortKey(value: string | undefined): SortKey | undefined {
  if (value === 'discount' || value === 'price' || value === 'name' || value === 'review') {
    return value;
  }
  return undefined;
}

function parsePlatformFilter(value: string | undefined): PlatformFilter | undefined {
  if (value === 'all' || value === 'windows' || value === 'linux') {
    return value;
  }
  return undefined;
}

function parseTheme(value: string | undefined): ThemeMode | undefined {
  if (value === 'dark' || value === 'light') {
    return value;
  }
  return undefined;
}
