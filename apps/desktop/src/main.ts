import { app, BrowserWindow, Menu, Notification, Tray, clipboard, dialog, ipcMain, nativeImage, net, protocol, screen, session, shell } from "electron";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  RadarController,
  RadarService,
  RadarStore,
  buildOpenIdAuthUrl,
  type AppNotification,
  type RadarEvent,
  type HttpRequestInit,
  type Settings,
  type StorageAdapter,
  type UpdateStatus,
} from "@radar/core";

const APP_ID = "com.steamdealradar.app";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const isDev = !app.isPackaged;
const uiUrl = process.env.RADAR_UI_URL;

app.setName("Steam 折扣雷达");
Menu.setApplicationMenu(null);
app.setAppUserModelId(APP_ID);

protocol.registerSchemesAsPrivileged([
  { scheme: "radarimg", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let refreshTimer: NodeJS.Timeout | null = null;
let controller: RadarController;
let service: RadarService;
let currentSettings: Settings;
let updateStatus: UpdateStatus = { phase: "idle" };

const userData = app.getPath("userData");
const statePath = path.join(userData, "radar-state.json");
const imageDir = path.join(userData, "image-cache");

const storage: StorageAdapter = {
  read: async () => {
    try {
      return await fs.readFile(statePath, "utf8");
    } catch {
      return null;
    }
  },
  write: async (data: string) => {
    await fs.mkdir(userData, { recursive: true });
    const tmp = `${statePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, data, "utf8");
    await fs.rename(tmp, statePath);
  },
};

async function httpGet(url: string, init?: HttpRequestInit): Promise<string> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 25_000);
  try {
    // 用 Electron 的 net.fetch（Chromium 网络栈）：会走系统代理，并处理证书/双栈回退
    const response = await net.fetch(url, {
      method: init?.method ?? "GET",
      body: init?.body,
      headers: {
        "user-agent": UA,
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
        accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        ...(init?.headers ?? {}),
      },
      signal: abort.signal,
    });
    if (!response.ok) throw new Error(`Steam 返回 HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function emit(event: RadarEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("radar:event", event);
}

/** 系统通知：点击后唤起主窗口 */
function notify(notification: AppNotification): void {
  if (!Notification.isSupported()) return;
  const item = new Notification({
    title: notification.title,
    body: notification.body,
    icon: assetPath("icon.png"),
    silent: false,
  });
  item.on("click", () => {
    showWindow();
    emit({ type: "toast", message: `${notification.title} · ${notification.body}`, tone: "info" });
  });
  item.show();
}

/* ---------- 封面图本地缓存：断网也能看到封面 ---------- */

/** Steam 封面 CDN 在不同网络下可达性不同，按顺序回退 */
function imageCandidates(remote: string): string[] {
  const list = [remote];
  const add = (url: string) => {
    if (url !== remote && !list.includes(url)) list.push(url);
  };
  const hosts = ["shared.akamai.steamstatic.com", "cdn.akamai.steamstatic.com", "shared.cloudflare.steamstatic.com", "cdn.cloudflare.steamstatic.com"];
  const match = hosts.find((host) => remote.includes(host));
  if (match) {
    for (const host of hosts) add(remote.replace(match, host));
  }
  return list;
}

async function handleImageRequest(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const remote = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!/^https:\/\/[^/]*steamstatic\.com\//.test(remote) && !/^https:\/\/[^/]*steam\.com\//.test(remote)) {
      return new Response("blocked", { status: 403 });
    }
    await fs.mkdir(imageDir, { recursive: true });
    const key = createHash("sha1").update(remote).digest("hex");
    const file = path.join(imageDir, `${key}.img`);
    let bytes: Uint8Array;
    let contentType = "image/jpeg";
    try {
      bytes = new Uint8Array(await fs.readFile(file));
    } catch {
      let lastStatus = 0;
      for (const candidate of imageCandidates(remote)) {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 12_000);
        try {
          const response = await net.fetch(candidate, { headers: { "user-agent": UA }, signal: abort.signal }).finally(() => clearTimeout(timer));
          if (!response.ok) {
            lastStatus = response.status;
            continue;
          }
          contentType = response.headers.get("content-type") ?? "image/jpeg";
          bytes = new Uint8Array(await response.arrayBuffer());
          await fs.writeFile(file, bytes).catch(() => {});
          break;
        } catch (error) {
          console.warn("[img] 拉取失败", candidate, error instanceof Error ? error.message : error);
        }
      }
      if (!bytes!) {
        console.error("[img] 所有 CDN 均失败", lastStatus, remote);
        return new Response("not found", { status: 404 });
      }
    }
    // 运行时是 Uint8Array，TS 的 DOM 类型对 ArrayBufferLike 比较挑剔
    return new Response(bytes as unknown as BodyInit, {
      headers: { "content-type": contentType, "cache-control": "public, max-age=604800" },
    });
  } catch (error) {
    console.error("[img] fail", request.url.slice(0, 120), error);
    return new Response("error", { status: 502 });
  }
}

/* ---------- 窗口 / 托盘 ---------- */

/** 图标等资源在打包后位于 app.asar.unpacked/build，开发时位于 apps/desktop/build */
function assetPath(name: string): string {
  const base = app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked") : path.join(__dirname, "..");
  return path.join(base, "build", name);
}

function uiEntry(): string {
  if (isDev) return path.join(__dirname, "..", "ui", "index.html");
  return path.join(app.getAppPath(), "ui", "index.html");
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: "#0a0e13",
    title: "Steam 折扣雷达",
    icon: assetPath("icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (uiUrl) void win.loadURL(uiUrl);
  else void win.loadFile(uiEntry());

  win.setMenuBarVisibility(false);
  win.webContents.on("before-input-event", (_event, input) => {
    if (!app.isPackaged && input.type === "keyDown" && (input.key === "F12" || (input.control && input.shift && input.key === "I"))) {
      win.webContents.toggleDevTools();
    }
  });
  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    const target = uiUrl ?? "file://";
    if (!url.startsWith(target)) {
      event.preventDefault();
      if (url.startsWith("https://")) void shell.openExternal(url);
    }
  });

  win.on("close", (event) => {
    if (!quitting && currentSettings?.closeToTray) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  return win;
}

function showWindow(): void {
  if (!mainWindow) {
    mainWindow = createWindow();
  applyUiScale(currentSettings);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function buildTray(): void {
  try {
    buildTrayInner();
  } catch (error) {
    console.warn("[radar] 托盘不可用，继续以窗口模式运行", error);
    tray = null;
  }
}

function buildTrayInner(): void {
  const iconPath = assetPath("tray.png");
  const image = nativeImage.createFromPath(iconPath);
  const traySize = process.platform === "win32" ? 16 : 22;
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: traySize, height: traySize }));
  tray.setToolTip("Steam 折扣雷达");
  const refreshItem = { label: "立即刷新折扣", click: () => void refreshNow(true) };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示主窗口", click: showWindow },
      refreshItem,
      { type: "separator" },
      {
        label: "开机自动启动",
        type: "checkbox",
        checked: Boolean(app.getLoginItemSettings().openAtLogin),
        click: (item) => {
          const next = item.checked;
          applyAutoLaunch(next);
          void controller.invoke("updateSettings", { patch: { autoLaunch: next } });
        },
      },
      { label: "打开数据目录", click: () => void shell.openPath(userData) },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", showWindow);
}

/* ---------- 自动刷新调度 ---------- */

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  const minutes = Math.max(15, currentSettings?.refreshMinutes ?? 60);
  refreshTimer = setTimeout(() => {
    void refreshNow(false).finally(scheduleRefresh);
  }, minutes * 60_000);
}

async function refreshNow(manual: boolean): Promise<void> {
  emit({ type: "refreshing", value: true });
  try {
    const result = await service.refresh();
    emit({ type: "snapshot", snapshot: service.snapshot() });
    if (manual && !result.ok && mainWindow) {
      emit({ type: "toast", message: result.error ?? "更新失败", tone: "error" });
    }
  } finally {
    emit({ type: "refreshing", value: false });
  }
}

function applyAutoLaunch(enabled: boolean): void {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ["--hidden"] });
  } catch {
    /* Linux 上部分桌面环境不支持，忽略 */
  }
}

function applySettings(next: Settings): void {
  if (!next) return;
  const changedInterval = currentSettings?.refreshMinutes !== next.refreshMinutes;
  const changedLaunch = currentSettings?.autoLaunch !== next.autoLaunch;
  const changedProxy =
    currentSettings?.proxyMode !== next.proxyMode || currentSettings?.proxyRules !== next.proxyRules;
  const changedScale = currentSettings?.uiScale !== next.uiScale;
  const changedCert = currentSettings?.allowInsecureCert !== next.allowInsecureCert;
  currentSettings = next;
  if (changedInterval) scheduleRefresh();
  if (changedLaunch) applyAutoLaunch(next.autoLaunch);
  if (changedProxy) void applyProxy(next);
  if (changedScale) applyUiScale(next);
  if (changedCert) insecureCertAllowed = Boolean(next.allowInsecureCert);
}

/* ---------- 高分屏与字体缩放 ---------- */

/** uiScale=0 时按主屏物理分辨率与系统缩放自动选择 */
function effectiveUiScale(settings: Settings): number {
  if (settings.uiScale > 0) return settings.uiScale;
  const display = screen.getPrimaryDisplay();
  const scaleFactor = display.scaleFactor || 1;
  const physicalWidth = display.size.width;
  if (scaleFactor >= 2) return 1.2;
  if (scaleFactor >= 1.5 || physicalWidth >= 3200) return 1.1;
  if (physicalWidth <= 1400) return 0.95;
  return 1;
}

function applyUiScale(settings: Settings): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const scale = Math.min(1.8, Math.max(0.8, effectiveUiScale(settings)));
  mainWindow.webContents.setZoomFactor(scale);
}

/* ---------- 本地加速工具的自签名证书 ---------- */

let insecureCertAllowed = false;

function isSteamHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith("steampowered.com") ||
    host.endsWith("steamcommunity.com") ||
    host.endsWith("steamstatic.com") ||
    host.endsWith("steamcontent.com") ||
    host.endsWith("steam-chat.com")
  );
}

/** 安装一次；是否放行由 insecureCertAllowed 动态决定 */
function installCertPolicy(): void {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (insecureCertAllowed && isSteamHost(request.hostname)) {
      callback(0);
      return;
    }
    callback(-3);
  });
}

/** 让主进程的 HTTP 请求按设置使用系统代理 / 直连 / 手动代理 */
async function applyProxy(settings: Settings): Promise<void> {
  try {
    const ses = session.defaultSession;
    if (settings.proxyMode === "direct") {
      await ses.setProxy({ mode: "direct" });
    } else if (settings.proxyMode === "manual" && settings.proxyRules.trim()) {
      await ses.setProxy({ mode: "fixed_servers", proxyRules: settings.proxyRules.trim() });
    } else {
      await ses.setProxy({ mode: "system" });
    }
    console.log("[radar] 代理模式:", settings.proxyMode, settings.proxyRules || "");
  } catch (error) {
    console.warn("[radar] 设置代理失败", error);
  }
}

/* ---------- 自动更新 ---------- */

type Updater = import("electron-updater").AppUpdater;
let autoUpdater: Updater | null = null;
let updaterConfigured = false;

async function setupUpdater(): Promise<void> {
  if (!app.isPackaged) return;
  try {
    const mod = await import("electron-updater");
    autoUpdater = mod.autoUpdater;
  } catch (error) {
    console.warn("[radar] 自动更新不可用", error);
    return;
  }

  // 仓库还带着示例 publish 配置时不检查更新，避免每次启动打一个 404
  try {
    const config = await fs.readFile(path.join(process.resourcesPath, "app-update.yml"), "utf8");
    updaterConfigured = !config.includes("replace-with-your-github-name");
  } catch {
    updaterConfigured = false;
  }
  if (!updaterConfigured) {
    console.warn("[radar] 尚未配置更新源（electron-builder.yml 的 publish），客户端更新已禁用");
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => setUpdate({ phase: "checking" }));
  autoUpdater.on("update-available", (info) => setUpdate({ phase: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => setUpdate({ phase: "none" }));
  autoUpdater.on("download-progress", (progress) => setUpdate({ phase: "downloading", percent: progress.percent }));
  autoUpdater.on("update-downloaded", (info) => setUpdate({ phase: "ready", version: info.version }));
  autoUpdater.on("error", (error) => setUpdate({ phase: "error", message: error.message }));
}

function setUpdate(status: UpdateStatus): void {
  updateStatus = status;
  emit({ type: "update", status });
}

async function checkForUpdates(manual: boolean): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    return { phase: "unsupported", message: "开发模式下不检查更新" };
  }
  // Linux 解包安装（scripts/install-linux.sh）或系统包安装没有 APPIMAGE 环境变量，
  // electron-updater 无法自替换，给出明确提示而不是抛底层错误
  if (process.platform === "linux" && !process.env.APPIMAGE) {
    return {
      phase: "unsupported",
      message: "当前是解包/系统包安装，应用内无法自动替换，请从 Releases 下载新版本或用安装脚本更新",
    };
  }
  if (!autoUpdater || !updaterConfigured) {
    return { phase: "unsupported", message: "当前安装方式暂不支持应用内更新，请手动下载新版本" };
  }
  if (!currentSettings?.autoUpdateApp && !manual) return { phase: "idle" };
  try {
    await autoUpdater.checkForUpdates();
    await new Promise((resolve) => setTimeout(resolve, 400));
    return updateStatus;
  } catch (error) {
    const status: UpdateStatus = {
      phase: "error",
      message: "检查更新失败，请检查网络后重试，或手动下载新版本",
    };
    setUpdate(status);
    return status;
  }
}


/** 开发辅助：RADAR_SHOT=目录 时依次截取各视图，方便在无头/锁屏环境下检查界面 */
async function devCaptureSequence(): Promise<void> {
  const dir = process.env.RADAR_SHOT;
  if (!dir) return;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const shoot = async (name: string) => {
    if (!mainWindow) return;
    const image = await mainWindow.webContents.capturePage();
    await fs.writeFile(path.join(dir, `${name}.png`), image.toPNG());
  };
  const click = async (selector: string) => {
    if (!mainWindow) return;
    await mainWindow.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(selector)})?.click(); true;`,
      true,
    );
  };
  const clickText = async (text: string) => {
    if (!mainWindow) return;
    await mainWindow.webContents.executeJavaScript(
      `[...document.querySelectorAll("button")].find((b) => b.textContent && b.textContent.includes(${JSON.stringify(text)}))?.click(); true;`,
      true,
    );
  };

  await wait(Number(process.env.RADAR_SHOT_DELAY ?? 9000));
  await shoot("01-deals");
  await click(".sortmenu__trigger");
  await wait(500);
  await shoot("01b-sort-menu");
  await click(".topbar__title h1");
  await wait(300);
  await click(".card .star");
  await wait(900);
  await click(".rail__item:nth-child(2)");
  await wait(900);
  await shoot("02-watch");
  await click(".rail__item:nth-child(3)");
  await wait(4000);
  await shoot("02b-catalog");
  await click(".rail__item:nth-child(4)");
  await wait(900);
  await shoot("02c-account");
  await click(".rail__item:nth-child(5)");
  await wait(700);
  await shoot("03-settings");
  if (mainWindow) {
    await mainWindow.webContents.executeJavaScript(
      `(() => { const panels = document.querySelectorAll(".panel"); panels[2]?.scrollIntoView({ block: "start" }); return true; })()`,
      true,
    );
  }
  await wait(500);
  await shoot("03a-settings-translate");
  if (mainWindow) {
    await mainWindow.webContents.executeJavaScript(
      `(() => { const panels = document.querySelectorAll(".panel"); panels[3]?.scrollIntoView({ block: "start" }); return true; })()`,
      true,
    );
  }
  await wait(400);
  await shoot("03b-settings-network");
  if (mainWindow) {
    await mainWindow.webContents.executeJavaScript(
      `(() => { const panels = document.querySelectorAll(".panel"); panels[4]?.scrollIntoView({ block: "start" }); return true; })()`,
      true,
    );
  }
  await wait(400);
  await shoot("03c-settings-appearance");
  await click(".rail__item:nth-child(6)");
  await wait(700);
  await shoot("03b-about");
  await clickText("查看协议");
  await wait(400);
  await shoot("03c-license");
  await clickText("检查更新");
  await wait(3000);
  await shoot("03d-update-check");
  await click(".rail__item:nth-child(1)");
  await wait(500);
  await click(".card");
  await wait(1000);
  await shoot("04-detail");
  await clickText("查看评价详情");
  await wait(2500);
  await shoot("06-reviews");
  if (mainWindow) {
    await mainWindow.webContents.executeJavaScript('document.querySelector(".review-panel")?.scrollIntoView({block:"start"}); true;', true);
  }
  await wait(700);
  await shoot("06b-reviews-panel");
  await clickText("差评");
  await wait(800);
  await shoot("07-reviews-negative");
  await clickText("全部");
  await wait(500);
  await clickText("加载更多评价");
  await wait(2200);
  await shoot("08-reviews-more");

  // 切换评价语言到英语区，验证语言筛选与免费翻译
  if (mainWindow) {
    await mainWindow.webContents.executeJavaScript(
      `(() => {
         const select = document.querySelector(".review-panel select");
         if (!select) return false;
         const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
         setter.call(select, "english");
         select.dispatchEvent(new Event("change", { bubbles: true }));
         return true;
       })()`,
      true,
    );
  }
  await wait(2500);
  await shoot("09-reviews-english");
  await clickText("翻译为中文");
  await wait(10000);
  if (mainWindow) {
    const info = await mainWindow.webContents.executeJavaScript(
      `[...document.querySelectorAll(".review-item__translate")].map((b) => b.textContent.trim() + "|" + Math.round(b.getBoundingClientRect().x) + "," + Math.round(b.getBoundingClientRect().y)).join(" ; ")`,
      true,
    );
    console.log("[shot] translate buttons:", info);
  }
  await shoot("10-reviews-translated");

  // 中文评价翻译成英文
  if (mainWindow) {
    await mainWindow.webContents.executeJavaScript(
      `(() => {
         const selects = document.querySelectorAll(".review-panel select");
         if (selects.length < 2) return false;
         const setValue = (el, value) => {
           const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
           setter.call(el, value);
           el.dispatchEvent(new Event("change", { bubbles: true }));
         };
         setValue(selects[0], "schinese");
         setValue(selects[1], "en");
         return true;
       })()`,
      true,
    );
  }
  await wait(2500);
  await clickText("翻译为English");
  await wait(9000);
  await shoot("11-reviews-zh-to-en");
  await click(".drawer__close");
  await wait(400);
  if (mainWindow) {
    await mainWindow.webContents.executeJavaScript(
      `(() => {
         const input = document.querySelector(".search input");
         if (!input) return false;
         const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
         setter.call(input, "elden");
         input.dispatchEvent(new Event("input", { bubbles: true }));
         return true;
       })()`,
      true,
    );
  }
  await wait(2600);
  await shoot("05-search");
  quitting = true;
  app.quit();
}

/* ---------- 启动 ---------- */

/**
 * 用 Steam OpenID 在应用内窗口完成登录，回调用本机临时 HTTP 服务接收。
 * 登录窗口使用默认 session，登录后 Steam 的社区/商店 Cookie 会留在会话里，
 * 之后用 net.fetch 读取游戏库、愿望单时自动携带。
 */
function steamOpenIdLogin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let loginWindow: BrowserWindow | null = null;
    const html = (message: string) =>
      `<!doctype html><meta charset="utf-8"><title>Steam 登录</title><body style="font-family:sans-serif;padding:40px"><h2>${message}</h2><p>可以关闭本窗口并返回「Steam 折扣雷达」。</p></body>`;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      server.close();
      fn();
    };
    const server = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          response.writeHead(404).end();
          return;
        }
        const claimed = url.searchParams.get("openid.claimed_id") ?? "";
        const steamId = claimed.replace(/\/$/, "").split("/").pop() ?? "";
        if (!/^\d{17}$/.test(steamId)) {
          response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          response.end(html("登录失败：缺少 Steam 身份信息"));
          finish(() => reject(new Error("Steam 登录回调缺少身份信息")));
          return;
        }
        const verify = new URLSearchParams(url.searchParams);
        verify.set("openid.mode", "check_authentication");
        try {
          const body = await httpGet("https://steamcommunity.com/openid/login", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: verify.toString(),
          });
          if (!body.includes("is_valid:true")) {
            response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            response.end(html("登录验证失败，请重试"));
            finish(() => reject(new Error("Steam 登录验证失败，请重试")));
            return;
          }
        } catch (error) {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(html("网络错误，请检查网络或代理后重试"));
          finish(() => reject(error instanceof Error ? error : new Error("Steam 登录验证失败")));
          return;
        }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(html("登录成功，正在返回应用…"));
        finish(() => {
          // 顺手访问一次商店首页，让 store.steampowered.com 的登录 Cookie 也落到会话里
          if (loginWindow && !loginWindow.isDestroyed()) {
            void loginWindow.loadURL("https://store.steampowered.com/");
            setTimeout(() => {
              if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
            }, 2500);
          }
          resolve(steamId);
        });
      })();
    });
    server.on("error", (error) => finish(() => reject(error)));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const realm = `http://127.0.0.1:${port}`;
      loginWindow = new BrowserWindow({
        width: 620,
        height: 760,
        title: "登录 Steam",
        autoHideMenuBar: true,
        parent: mainWindow ?? undefined,
      });
      loginWindow.loadURL(buildOpenIdAuthUrl(realm, `${realm}/callback`)).catch(() => {
        finish(() => reject(new Error("无法打开 Steam 登录页面，请检查网络或代理")));
      });
      loginWindow.on("closed", () => {
        if (!settled) finish(() => reject(new Error("登录已取消")));
      });
    });
    setTimeout(() => finish(() => reject(new Error("登录超时：请重新登录"))), 5 * 60_000);
  });
}

async function bootstrap(): Promise<void> {
  const store = new RadarStore(storage);
  service = new RadarService({
    http: httpGet,
    store,
    platform: "electron",
    version: app.getVersion(),
    notify,
  });
  await service.init();
  currentSettings = service.store.settings;
  insecureCertAllowed = Boolean(currentSettings.allowInsecureCert);
  installCertPolicy();
  await applyProxy(currentSettings);
  await setupUpdater();

  controller = new RadarController(
    service,
    {
      os: `${process.platform} ${process.arch}`,
      dataDir: userData,
      openExternal: (url) => shell.openExternal(url),
      copyText: async (text) => {
        await clipboard.writeText(text);
      },
      steamLogin: () => steamOpenIdLogin(),
      notify,
      checkUpdate: async () => checkForUpdates(true),
      installUpdate: async () => {
        if (!autoUpdater) throw new Error("自动更新不可用");
        if (process.platform === "linux" && !process.env.APPIMAGE) {
          throw new Error("当前安装方式不支持应用内更新，请从 Releases 下载新版本");
        }
        if (updateStatus.phase !== "ready") {
          setUpdate({ phase: "downloading", percent: 0 });
          await autoUpdater.downloadUpdate();
        }
        quitting = true;
        autoUpdater.quitAndInstall(false, true);
      },
      quit: () => {
        quitting = true;
        app.quit();
      },
      emit,
      capabilities: {
        notifications: Notification.isSupported(),
        autoUpdate: app.isPackaged && updaterConfigured,
        tray: true,
        background: true,
        importExport: true,
      },
    },
    { version: app.getVersion(), platform: "electron" },
  );

  ipcMain.handle("radar:invoke", async (_event, method: string, payload: unknown) => {
    try {
      const result = await controller.invoke(method as never, payload);
      applySettings(service.store.settings);
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  protocol.handle("radarimg", handleImageRequest);

  mainWindow = createWindow();
  applyUiScale(currentSettings);
  buildTray();
  scheduleRefresh();
  applyAutoLaunch(currentSettings.autoLaunch);

  const hidden = process.argv.includes("--hidden");
  if (!hidden) showWindow();

  // 启动后按需刷新：超过刷新间隔才抓取，避免每次启动都打 Steam
  const last = service.store.state.lastRefreshAt;
  const stale = !last || Date.now() - last > currentSettings.refreshMinutes * 60_000;
  if (stale) setTimeout(() => void refreshNow(false), 800);
  if (currentSettings.autoUpdateApp) setTimeout(() => void checkForUpdates(false), 4000);
  if (process.env.RADAR_SHOT) void devCaptureSequence();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(bootstrap).catch((error) => {
    console.error("[radar] 启动失败", error);
    dialog.showErrorBox("启动失败", String(error));
    app.quit();
  });

  app.on("window-all-closed", () => {
    // 常驻托盘以保持定时提醒；用户从托盘菜单退出
  });

  app.on("activate", () => showWindow());

  app.on("before-quit", () => {
    quitting = true;
    if (refreshTimer) clearTimeout(refreshTimer);
  });
}

process.on("uncaughtException", (error) => {
  console.error("[radar] 未捕获异常", error);
});
