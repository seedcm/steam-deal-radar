import type {
  AppInfo,
  Deal,
  RadarMethod,
  RefreshResult,
  ReviewPage,
  SearchHit,
  TranslationResult,
  Settings,
  Snapshot,
  UpdateStatus,
  WatchEntry,
} from "@radar/core";
import { invoke } from "./bridge";

export const api = {
  snapshot: () => invoke("snapshot") as Promise<Snapshot>,
  refresh: () => invoke("refresh") as Promise<RefreshResult>,
  watch: (input: { appId: number; name: string; image?: string; targetPrice?: number }) =>
    invoke("watch", input) as Promise<WatchEntry>,
  unwatch: (appId: number) => invoke("unwatch", { appId }) as Promise<boolean>,
  updateWatch: (appId: number, patch: Partial<WatchEntry>) =>
    invoke("updateWatch", { appId, patch }) as Promise<WatchEntry | null>,
  updateSettings: (patch: Partial<Settings>) => invoke("updateSettings", { patch }) as Promise<Settings>,
  search: (term: string) => invoke("search", { term }) as Promise<SearchHit[]>,
  details: (appId: number) => invoke("details", { appId }) as Promise<Deal | null>,
  reviews: (appId: number, next?: Record<string, string>, language?: string) =>
    invoke("reviews", { appId, next, language }) as Promise<ReviewPage>,
  translate: (text: string, target = "zh-CN") => invoke("translate", { text, target }) as Promise<TranslationResult>,
  openStore: (appId: number) => invoke("openStore", { appId }) as Promise<void>,
  openExternal: (url: string) => invoke("openExternal", { url }) as Promise<void>,
  testNotification: () => invoke("testNotification") as Promise<void>,
  checkUpdate: () => invoke("checkUpdate") as Promise<UpdateStatus>,
  installUpdate: () => invoke("installUpdate") as Promise<void>,
  exportData: () => invoke("exportData") as Promise<string>,
  saveExport: () =>
    invoke("saveExport") as Promise<{ saved: boolean; path?: string; copied?: boolean }>,
  copyText: (text: string) => invoke("copyText", { text }) as Promise<void>,
  importData: (json: string) => invoke("importData", { json }) as Promise<void>,
  quit: () => invoke("quit") as Promise<void>,
  appInfo: () => invoke("appInfo") as Promise<AppInfo>,
};

export type Api = typeof api;
export type { RadarMethod };
