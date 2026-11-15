import { app, BrowserWindow, Menu, Notification, Tray, clipboard, dialog, ipcMain, nativeImage, protocol, shell } from "electron";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  RadarController,
  RadarService,
  RadarStore,
  type AppNotification,
  type RadarEvent,
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

async function httpGet(url: string): Promise<string> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 25_000);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": UA, "accept-language": "zh-CN,zh;q=0.9,en;q=0.6", accept: "application/json,text/html;q=0.9,*/*;q=0.8" },
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
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 15_000);
      const response = await fetch(remote, { headers: { "user-agent": UA }, signal: abort.signal }).finally(() => clearTimeout(timer));
      if (!response.ok) {
        console.error("[img] remote status", response.status, remote);
        return new Response("not found", { status: 404 });
      }
      contentType = response.headers.get("content-type") ?? "image/jpeg";
      bytes = new Uint8Array(await response.arrayBuffer());
      await fs.writeFile(file, bytes).catch(() => {});
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
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 22, height: 22 }));
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
  currentSettings = next;
  if (changedInterval) scheduleRefresh();
  if (changedLaunch) applyAutoLaunch(next.autoLaunch);
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

  autoUpdater.autoDownload = true;
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
  if (!autoUpdater || !updaterConfigured) {
    return { phase: "unsupported", message: "尚未配置更新源，请修改 electron-builder.yml 的 publish" };
  }
  if (!currentSettings?.autoUpdateApp && !manual) return { phase: "idle" };
  try {
    await autoUpdater.checkForUpdates();
    await new Promise((resolve) => setTimeout(resolve, 400));
    return updateStatus;
  } catch (error) {
    const status: UpdateStatus = { phase: "error", message: error instanceof Error ? error.message : "检查更新失败" };
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
  await click(".card .star");
  await wait(900);
  await click(".rail__item:nth-child(2)");
  await wait(900);
  await shoot("02-watch");
  await click(".rail__item:nth-child(3)");
  await wait(700);
  await shoot("03-settings");
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
  await clickText("翻译成中文");
  await wait(10000);
  if (mainWindow) {
    const info = await mainWindow.webContents.executeJavaScript(
      `[...document.querySelectorAll(".review-item__translate")].map((b) => b.textContent.trim() + "|" + Math.round(b.getBoundingClientRect().x) + "," + Math.round(b.getBoundingClientRect().y)).join(" ; ")`,
      true,
    );
    console.log("[shot] translate buttons:", info);
  }
  await shoot("10-reviews-translated");
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
      notify,
      checkUpdate: async () => checkForUpdates(true),
      installUpdate: () => {
        if (!autoUpdater) return;
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
