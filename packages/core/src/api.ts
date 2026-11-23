import type { TranslationResult } from "./translate";
import type {
  AppNotification,
  Deal,
  LibraryGame,
  RefreshResult,
  ReviewPage,
  SearchHit,
  Settings,
  Snapshot,
  SteamAccount,
  WatchEntry,
  WishlistItem,
} from "./types";

/**
 * 渲染层与宿主（Electron 主进程 / 鸿蒙 ArkTS）之间的统一调用契约。
 * Electron 通过 preload 暴露 window.radar.invoke，鸿蒙通过 javaScriptProxy 暴露 nativeBridge.invoke。
 */
export interface RadarInvokeMap {
  snapshot: { payload: void; result: Snapshot };
  refresh: { payload: void; result: RefreshResult };
  watch: { payload: { appId: number; name: string; image?: string; targetPrice?: number }; result: WatchEntry };
  unwatch: { payload: { appId: number }; result: boolean };
  updateWatch: { payload: { appId: number; patch: Partial<WatchEntry> }; result: WatchEntry | null };
  updateSettings: { payload: { patch: Partial<Settings> }; result: Settings };
  search: { payload: { term: string }; result: SearchHit[] };
  details: { payload: { appId: number }; result: Deal | null };
  reviews: { payload: { appId: number; next?: Record<string, string>; language?: string }; result: ReviewPage };
  translate: { payload: { text: string; target?: string }; result: TranslationResult };
  openExternal: { payload: { url: string }; result: void };
  openStore: { payload: { appId: number }; result: void };
  testNotification: { payload: void; result: void };
  checkUpdate: { payload: void; result: UpdateStatus };
  installUpdate: { payload: void; result: void };
  exportData: { payload: void; result: string };
  catalog: { payload: { term?: string; page?: number }; result: Deal[] };
  steamLogin: { payload: void; result: SteamAccount };
  steamLogout: { payload: void; result: void };
  steamProfile: { payload: { steamId: string }; result: SteamAccount };
  steamLibrary: { payload: { steamId: string }; result: LibraryGame[] };
  steamWishlist: { payload: { steamId: string }; result: WishlistItem[] };
  saveExport: { payload: void; result: { saved: boolean; path?: string; copied?: boolean } };
  copyText: { payload: { text: string }; result: void };
  importData: { payload: { json: string }; result: void };
  quit: { payload: void; result: void };
  appInfo: { payload: void; result: AppInfo };
}

export type RadarMethod = keyof RadarInvokeMap;
export type RadarPayload<M extends RadarMethod> = RadarInvokeMap[M]["payload"];
export type RadarResult<M extends RadarMethod> = RadarInvokeMap[M]["result"];

export type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "ready" | "none" | "error" | "unsupported";

export interface UpdateStatus {
  phase: UpdatePhase;
  version?: string;
  percent?: number;
  message?: string;
}

export interface AppInfo {
  version: string;
  platform: "electron" | "harmony" | "web";
  os: string;
  dataDir?: string;
  capabilities: {
    notifications: boolean;
    autoUpdate: boolean;
    tray: boolean;
    background: boolean;
    importExport: boolean;
  };
}

export type RadarEvent =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "refreshing"; value: boolean }
  | { type: "toast"; message: string; tone: "info" | "error" | "success" }
  | { type: "notification"; notification: AppNotification }
  | { type: "update"; status: UpdateStatus };

/** 宿主注入到 window 上的对象 */
export interface RadarBridge {
  invoke(method: RadarMethod, payload?: unknown): Promise<unknown>;
  onEvent(callback: (event: RadarEvent) => void): () => void;
  platform: "electron" | "harmony" | "web";
  version: string;
}

/** 鸿蒙 javaScriptProxy 的同步签名（参数/返回值均为 JSON 字符串） */
export interface NativeBridge {
  invoke(method: string, payloadJson: string, callbackId: string): void;
  platform(): string;
  version(): string;
}
