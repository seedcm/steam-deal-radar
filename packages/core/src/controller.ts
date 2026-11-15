import type { AppInfo, RadarEvent, RadarMethod, UpdateStatus } from "./api";
import type { RadarService } from "./service";
import type { AppNotification, Deal, Settings, WatchEntry } from "./types";

export interface ControllerHost {
  /** 用系统浏览器打开链接 */
  openExternal(url: string): void | Promise<void>;
  /** 系统级通知（桌面托盘通知 / 鸿蒙通知栏） */
  notify?(notification: AppNotification): void | Promise<void>;
  checkUpdate?(): Promise<UpdateStatus>;
  installUpdate?(): void | Promise<void>;
  quit?(): void;
  /** 写入系统剪贴板（用于导出备份） */
  copyText?(text: string): void | Promise<void>;
  /** 宿主向渲染层广播事件（刷新完成、更新进度等） */
  emit?(event: RadarEvent): void;
  dataDir?: string;
  os: string;
  capabilities?: Partial<AppInfo["capabilities"]>;
}

const ALLOWED_HOSTS = ["store.steampowered.com", "steamcommunity.com", "help.steampowered.com"];

function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    return ALLOWED_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * 把平台能力（通知、外链、更新、退出）与数据引擎组装成统一的 invoke 接口。
 * Electron 主进程与 Web 预览共用它，鸿蒙端在 ArkTS 里实现同样的方法名。
 */
export class RadarController {
  constructor(
    private service: RadarService,
    private host: ControllerHost,
    private identity: { version: string; platform: AppInfo["platform"] },
  ) {}

  appInfo(): AppInfo {
    return {
      version: this.identity.version,
      platform: this.identity.platform,
      os: this.host.os,
      dataDir: this.host.dataDir,
      capabilities: {
        notifications: Boolean(this.host.notify),
        autoUpdate: Boolean(this.host.checkUpdate),
        tray: false,
        background: false,
        importExport: true,
        ...this.host.capabilities,
      },
    };
  }

  async invoke(method: RadarMethod, payload: unknown = null): Promise<unknown> {
    switch (method) {
      case "snapshot":
        return this.service.snapshot();
      case "refresh": {
        const result = await this.service.refresh();
        this.emit({ type: "snapshot", snapshot: this.service.snapshot() });
        return result;
      }
      case "watch": {
        const input = payload as { appId: number; name: string; image?: string; targetPrice?: number };
        const entry = this.service.watch(input);
        this.emit({ type: "snapshot", snapshot: this.service.snapshot() });
        return entry;
      }
      case "unwatch": {
        const { appId } = payload as { appId: number };
        const removed = this.service.unwatch(appId);
        this.emit({ type: "snapshot", snapshot: this.service.snapshot() });
        return removed;
      }
      case "updateWatch": {
        const { appId, patch } = payload as { appId: number; patch: Partial<WatchEntry> };
        const entry = this.service.updateWatch(appId, patch) ?? null;
        this.emit({ type: "snapshot", snapshot: this.service.snapshot() });
        return entry;
      }
      case "updateSettings": {
        const { patch } = payload as { patch: Partial<Settings> };
        const settings = this.service.updateSettings(patch);
        this.emit({ type: "snapshot", snapshot: this.service.snapshot() });
        return settings;
      }
      case "search": {
        const { term } = payload as { term: string };
        return this.service.search(term);
      }
      case "details": {
        const { appId } = payload as { appId: number };
        const deal: Deal | null = await this.service.loadDetails(appId);
        this.emit({ type: "snapshot", snapshot: this.service.snapshot() });
        return deal;
      }
      case "reviews": {
        const { appId, next, language } = payload as { appId: number; next?: Record<string, string>; language?: string };
        return this.service.reviews(appId, next, language);
      }
      case "translate": {
        const { text, target } = payload as { text: string; target?: string };
        return this.service.translate(text, target);
      }
      case "openExternal": {
        const { url } = payload as { url: string };
        const target = safeUrl(url);
        if (!target) throw new Error("不支持打开的链接");
        await this.host.openExternal(target);
        return undefined;
      }
      case "openStore": {
        const { appId } = payload as { appId: number };
        await this.host.openExternal(`https://store.steampowered.com/app/${appId}`);
        return undefined;
      }
      case "testNotification": {
        const notification: AppNotification = {
          kind: "digest",
          appId: 0,
          title: "Steam 折扣雷达",
          body: "通知通道正常，关注列表里的游戏打折时会在这里提醒你。",
          storeUrl: "https://store.steampowered.com",
        };
        await this.host.notify?.(notification);
        this.emit({ type: "notification", notification });
        return undefined;
      }
      case "checkUpdate":
        return this.host.checkUpdate ? await this.host.checkUpdate() : { phase: "unsupported" };
      case "installUpdate":
        await this.host.installUpdate?.();
        return undefined;
      case "exportData":
        return this.service.store.exportState();
      case "copyText": {
        const { text } = payload as { text: string };
        if (!this.host.copyText) throw new Error("当前平台不支持复制到剪贴板");
        await this.host.copyText(text);
        return undefined;
      }
      case "importData": {
        const { json } = payload as { json: string };
        await this.service.store.importState(json);
        this.emit({ type: "snapshot", snapshot: this.service.snapshot() });
        return undefined;
      }
      case "quit":
        this.host.quit?.();
        return undefined;
      case "appInfo":
        return this.appInfo();
      default:
        throw new Error(`未知方法: ${String(method)}`);
    }
  }

  emit(event: RadarEvent): void {
    this.host.emit?.(event);
  }
}
