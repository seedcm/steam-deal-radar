# 渲染层 ↔ 宿主 桥协议

界面（`apps/ui`）不直接读文件、不发 Steam 请求、不弹系统通知。它只调用宿主暴露的 `invoke(method, payload)`，宿主再把结果和事件推回来。Electron、鸿蒙、浏览器预览都遵循同一张方法表。

宿主对象由 preload / `javaScriptProxy` 注入到 `window`：

| 平台 | 全局对象 | 说明 |
| --- | --- | --- |
| Electron | `window.radar` | `{ invoke, onEvent, platform, version }` |
| HarmonyOS | `window.nativeBridge` | `{ invoke(method, payloadJson, callbackId), platform(), version() }`，由 `apps/ui/src/lib/bridge.ts` 包成 Promise |
| 浏览器预览 | 无 | `WebBridge` 在渲染进程内直接跑 `@radar/core` |

## 方法表

| method | payload | 返回 |
| --- | --- | --- |
| `snapshot` | — | `Snapshot`（deals / watchlist / watchQuotes / settings / meta / lowest / history） |
| `refresh` | — | `{ ok, error?, dealCount, newLowCount, notifications, finishedAt }` |
| `watch` | `{ appId, name, image?, targetPrice? }` | `WatchEntry` |
| `unwatch` | `{ appId }` | `boolean` |
| `updateWatch` | `{ appId, patch }` | `WatchEntry \| null` |
| `updateSettings` | `{ patch }` | `Settings` |
| `search` | `{ term }` | `SearchHit[]`（term < 2 字符返回空） |
| `details` | `{ appId }` | `Deal \| null` |
| `reviews` | `{ appId, next?, language? }` | `{ reviews, next?, hasMore }`（Steam 官方排序；language 默认国区 schinese，`all` 为全部语言） |
| `translate` | `{ text, target? }` | `{ text, engine }`（免费在线翻译，target 默认 zh-CN） |
| `openExternal` | `{ url }` | — |
| `openStore` | `{ appId }` | — |
| `testNotification` | — | — |
| `checkUpdate` | — | `{ phase, version?, percent?, message? }` |
| `installUpdate` | — | — |
| `exportData` | — | 状态 JSON 字符串 |
| `copyText` | `{ text }` | —（写入系统剪贴板） |
| `importData` | `{ json }` | — |
| `quit` | — | — |
| `appInfo` | — | `{ version, platform, os, dataDir?, capabilities }` |

字段定义见 `packages/core/src/types.ts` 与 `packages/core/src/api.ts`。

## 调用与错误

**Electron**

```ts
// preload：ipcRenderer.invoke
{ ok: true, result } | { ok: false, error: "..." }
// renderer：失败时 throw new Error(error)
```

**HarmonyOS**（回调式）

```ts
// renderer → native
nativeBridge.invoke("refresh", "null", "r17");
// native 完成（或失败）后，通过 webviewController.runJavaScript 回到页面：
window.__radarResolve("r17", true, JSON.stringify(result));
window.__radarResolve("r17", false, JSON.stringify({ message: "超时" }));
```

`bridge.ts` 为每个 callbackId 保存 resolve/reject，并设置超时（`refresh` 90s，其余 20s）。

## 事件

宿主主动推送，渲染层订阅：

| type | 载荷 | 用途 |
| --- | --- | --- |
| `snapshot` | `{ snapshot }` | 任何数据变更后同步界面（关注、设置、刷新完成） |
| `refreshing` | `{ value }` | 显示刷新动画 |
| `toast` | `{ message, tone }` | 轻提示（`info` / `error` / `success`） |
| `notification` | `{ notification }` | 刚发出的系统通知，界面内再提示一次 |
| `update` | `{ status }` | 客户端更新进度 |

Electron 通过 `webContents.send("radar:event", event)`；鸿蒙通过 `runJavaScript` 调用 `window.__radarEvent(JSON.stringify(event))`。

## 时序（以刷新为例）

```
renderer                    host                         Steam
   │  invoke("refresh")       │                             │
   │ ───────────────────────> │  emit refreshing:true       │
   │  <─────────────────────  │  GET search/results × N     │
   │                          │ ──────────────────────────> │
   │                          │  <────────────────────────── │
   │                          │  记录价格 / 规划提醒          │
   │  <── event snapshot ──── │  系统通知（若有）             │
   │  <── ok: RefreshResult ─ │  emit refreshing:false      │
```

一次性调用方等待返回值；其它窗口/视图靠 `snapshot` 事件保持一致。

## 新增一个平台宿主

1. 实现上表所有方法（可复用 `@radar/core` 的 `RadarService` + `RadarController`）
2. 提供 `HttpClient`（带 UA，20~25s 超时）
3. 提供 `StorageAdapter`（读写一段 JSON 字符串，最好原子写）
4. 提供 `notify(notification)`（系统通知）
5. 把事件按上表推给页面
6. 图片：把 `https://...steamstatic.com/...` 缓存到本地，并让 `<img>` 能读到（协议拦截或重写 URL）

## 安全约定

- `openExternal` 只接受 `https://` 且域名在白名单内，其它直接抛错
- 界面加载的页面固定，`will-navigate` 拦截站外跳转
- 不向页面暴露文件系统、shell、任意 HTTP 能力
