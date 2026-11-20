import {
  RadarController,
  RadarService,
  RadarStore,
  type RadarBridge,
  type RadarEvent,
  type RadarMethod,
  type RadarResult,
  type StorageAdapter,
  type UpdateStatus,
} from "@radar/core";

declare global {
  interface Window {
    radar?: RadarBridge;
    nativeBridge?: {
      invoke(method: string, payloadJson: string, callbackId: string): void;
      platform(): string;
      version(): string;
    };
    __radarResolve?: (id: string, ok: boolean, payloadJson: string) => void;
    __radarEvent?: (eventJson: string) => void;
  }
}

type Listener = (event: RadarEvent) => void;

class Emitter {
  private listeners = new Set<Listener>();
  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event: RadarEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[radar] 事件处理失败", error);
      }
    }
  }
}

/** 鸿蒙：把 javaScriptProxy 的回调式接口包装成 Promise */
class HarmonyBridge implements RadarBridge {
  readonly platform = "harmony" as const;
  readonly version = "1.2.0";
  private emitter = new Emitter();
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private seq = 0;

  constructor() {
    window.__radarResolve = (id, ok, payloadJson) => {
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (!ok) {
        entry.reject(new Error(parseError(payloadJson)));
        return;
      }
      try {
        entry.resolve(payloadJson ? JSON.parse(payloadJson) : undefined);
      } catch (error) {
        entry.reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    window.__radarEvent = (eventJson) => {
      try {
        this.emitter.emit(JSON.parse(eventJson) as RadarEvent);
      } catch {
        /* 忽略非法事件 */
      }
    };
  }

  invoke(method: RadarMethod, payload?: unknown): Promise<unknown> {
    const native = window.nativeBridge;
    if (!native) return Promise.reject(new Error("鸿蒙原生桥未就绪"));
    const id = `r${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          if (this.pending.delete(id)) reject(new Error("原生端响应超时，请稍后重试"));
        },
        method === "refresh" ? 90_000 : 20_000,
      );
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      try {
        native.invoke(method, JSON.stringify(payload ?? null), id);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  onEvent(listener: Listener): () => void {
    return this.emitter.on(listener);
  }
}

function parseError(payloadJson: string): string {
  try {
    const parsed = JSON.parse(payloadJson) as { message?: string } | string;
    if (typeof parsed === "string") return parsed;
    return parsed?.message ?? "操作失败";
  } catch {
    return payloadJson || "操作失败";
  }
}

/**
 * 浏览器 / 开发预览：在渲染进程里直接跑数据引擎，用 localStorage 持久化，
 * Steam 请求走 vite 代理（Steam 商店接口没有开放 CORS）。
 */
class WebBridge implements RadarBridge {
  readonly platform = "web" as const;
  readonly version = "1.2.0-web";
  private emitter = new Emitter();
  private controller: RadarController;
  private ready: Promise<void>;

  constructor() {
    const adapter: StorageAdapter = {
      read: async () => localStorage.getItem("radar-state"),
      write: async (data) => localStorage.setItem("radar-state", data),
    };
    const http = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<string> => {
      const target = url
        .replace("https://store.steampowered.com", "/steam-proxy")
        .replace("https://steamcommunity.com", "/community-proxy")
        .replace("https://api.steampowered.com", "/steam-proxy-api")
        .replace("https://api.mymemory.translated.net", "/translate-proxy")
        .replace("https://translate.googleapis.com", "/google-translate-proxy");
      const response = await fetch(target, {
        method: init?.method ?? "GET",
        body: init?.body,
        headers: { "accept-language": "zh-CN,zh;q=0.9", ...(init?.headers ?? {}) },
      });
      if (!response.ok) throw new Error(`Steam 返回 HTTP ${response.status}`);
      return await response.text();
    };
    const service = new RadarService({
      http,
      store: new RadarStore(adapter),
      platform: "web",
      version: this.version,
      notify: (notification) => this.emitter.emit({ type: "notification", notification }),
    });
    this.ready = service.init();
    this.controller = new RadarController(
      service,
      {
        os: navigator.platform || "web",
        openExternal: (url) => {
          window.open(url, "_blank", "noopener,noreferrer");
        },
        saveFile: async (data, suggestedName) => {
          const blob = new Blob([data], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = suggestedName;
          anchor.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          return suggestedName;
        },
        copyText: async (text) => {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
          }
          const area = document.createElement("textarea");
          area.value = text;
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          document.execCommand("copy");
          area.remove();
        },
        emit: (event) => this.emitter.emit(event),
        capabilities: { notifications: false, autoUpdate: false, importExport: true },
      },
      { version: this.version, platform: "web" },
    );
  }

  async invoke(method: RadarMethod, payload?: unknown): Promise<unknown> {
    await this.ready;
    if (method === "checkUpdate") return { phase: "unsupported" } satisfies UpdateStatus;
    return this.controller.invoke(method, payload);
  }

  onEvent(listener: Listener): () => void {
    return this.emitter.on(listener);
  }
}

let cached: RadarBridge | null = null;

export function getBridge(): RadarBridge {
  if (cached) return cached;
  if (window.radar) {
    cached = window.radar;
  } else if (window.nativeBridge) {
    cached = new HarmonyBridge();
  } else {
    cached = new WebBridge();
  }
  return cached;
}

export const isDesktop = (): boolean => getBridge().platform === "electron";
export const isHarmony = (): boolean => getBridge().platform === "harmony";

export async function invoke<M extends RadarMethod>(method: M, payload?: unknown): Promise<RadarResult<M>> {
  return (await getBridge().invoke(method, payload)) as RadarResult<M>;
}

export function onEvent(listener: Listener): () => void {
  return getBridge().onEvent(listener);
}

/** 封面图地址：桌面端改写到本地缓存协议，鸿蒙端由 Web 组件拦截缓存 */
export function imageSrc(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const bridge = getBridge();
  if (bridge.platform === "electron") return `radarimg://img/${encodeURIComponent(url)}`;
  return url;
}
