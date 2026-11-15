# 架构说明

## 目标与约束

- 一次抓取、离线可用；不做账号体系，不依赖任何自建服务端
- 三端覆盖：Windows、Linux、HarmonyOS NEXT
- 界面只有一套，避免三份 UI 走样

Steam 没有公开的「折扣列表」接口，因此数据来源是：

| 用途 | 接口 | 说明 |
| --- | --- | --- |
| 折扣列表 | `store.steampowered.com/search/results/?specials=1&infinite=1` | 返回 JSON，其中 `results_html` 是服务端渲染片段 |
| 每日特惠 | `store.steampowered.com/api/featuredcategories` | 含折扣截止时间 |
| 单个游戏 | `store.steampowered.com/api/appdetails?appids=` | 关注列表补价格、详情简介 |
| 全站搜索 | `store.steampowered.com/api/storesearch` | 用户搜索未在折扣列表里的游戏 |
| 评价详情 | `steamcommunity.com/app/{id}/reviews?browsefilter=toprated` | 服务端渲染的评测卡片，官方「最有帮助」排序；下一页用页面里的 `MoreContentForm` 游标请求 `homecontent` |

`search/results` 返回的是 HTML 片段，所以 `packages/core/src/steam.ts` 用一组针对性正则解析。这层很薄，也最容易受 Steam 改版影响，单测（`packages/core/test/steam.test.ts`）用真实结构做了固定，改动时先跑测试。

## 分层

```
┌─────────────────────────────────────────────────────────────┐
│ apps/ui  React 19 + Vite（三端共用，构建产物是纯静态文件）      │
│   hooks/useRadar  →  lib/bridge（Electron / Harmony / Web）   │
└───────────────┬──────────────────────────────┬──────────────┘
                │ preload IPC                  │ javaScriptProxy
┌───────────────▼──────────────┐  ┌────────────▼──────────────┐
│ apps/desktop (Electron 主进程)│  │ apps/harmony (ArkTS)       │
│   RadarController            │  │   NativeBridge             │
│   RadarService + RadarStore  │  │   RadarEngine + StateStore │
│   fs 持久化 / 图片协议 / 托盘  │  │   preferences / 通知 / 后台 │
│   electron-updater           │  │   WorkScheduler             │
└───────────────┬──────────────┘  └────────────┬──────────────┘
                │                              │
        ┌───────▼──────────────────────────────▼───────┐
        │ 同一份状态 JSON（PersistedState），可互相导入  │
        └──────────────────────────────────────────────┘
```

`packages/core` 是纯 TypeScript，没有 DOM/Node 依赖：

- `types.ts` 领域模型（价格一律用「分」的整数）
- `steam.ts` URL 构造 + 解析
- `store.ts` 状态与持久化（`StorageAdapter` 由宿主注入）
- `service.ts` 刷新编排、史低、通知触发
- `reminders.ts` 纯函数提醒规划
- `controller.ts` 把「引擎 + 平台能力」组装成方法表，Electron 与 Web 预览共用

鸿蒙端用 ArkTS 重写了引擎（同一个 JSON 结构、同一套规则），因为它不能直接执行 TS 包，而且需要原生通知与后台任务。

## 刷新流程

```
refresh()
  ├─ 并发抓取 N 页折扣（默认 3 页 × 100 条，并发 3）
  ├─ 抓每日特惠，按 appId 合并 discountEndsAt
  ├─ 合并旧数据里的 description / tags，避免详情字段丢失
  ├─ 对关注列表里不在折扣页的游戏，逐个 appdetails 补价格（最多 40 个，并发 3）
  ├─ 记录价格：lowest = min(历史)，history 追加（同价 6h 内去重，最多 90 点）
  ├─ 用「更新前」的 lowest 规划通知 → 发系统通知 → 写回 lastNotified
  ├─ 更新 lastRefreshAt / lastRefreshError
  └─ 落盘（写临时文件后 rename，原子替换）
```

失败时保留旧数据，只记录 `lastRefreshError`，界面展示「离线模式 + 重试」。首次启动无缓存时展示空状态。

## 提醒规则

优先级：**目标价 > 新史低 > 折扣门槛**，每个游戏每轮刷新最多一条。

| 条件 | 说明 |
| --- | --- |
| `finalPrice <= targetPrice` | 到价提醒，静默时段也发 |
| `finalPrice < 历史最低` 且开关开启 | 新史低提醒 |
| `discount >= notifyMinDiscount` 且开启了「任意折扣提醒」 | 普通折扣提醒 |
| 同价 12 小时内已提醒过 | 跳过（去重） |
| 静默时段内 | 只放行到价提醒 |
| 单轮超过 5 条 | 按折扣力度取前 5，避免开屏轰炸 |

规则实现是纯函数 `planNotifications()`，输入固定、无副作用，`test/reminders.test.ts` 覆盖了边界（跨零点静默、冷却、优先级、限流）。

## 图片缓存（桌面端）

封面图通过自定义协议 `radarimg://img/<encodeURIComponent(原始URL)>` 请求：

1. 主进程按 URL 的 SHA-1 在 `image-cache/` 找文件
2. 没有就带 UA 请求 Steam CDN，写入后返回
3. 断网时命中缓存 → 正常显示；未命中 → 404 → 界面退化为渐变占位图

这样界面代码不需要关心缓存，`<img src>` 直接是 `radarimg://`；鸿蒙端用 `Web` 组件的 `onInterceptRequest` 做同样的事。

## 后台刷新

- **桌面**：主进程用 `setTimeout` 链按 `refreshMinutes` 循环；关窗只隐藏到托盘；托盘菜单可手动刷新/退出；开机自启可选
- **鸿蒙**：`WorkSchedulerExtensionAbility` 周期任务，最小 20 分钟，实际调度由系统决定；前台时也会按间隔刷新

## 安全边界

- 渲染层 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`，只通过 preload 暴露方法表
- `openExternal` 只允许 `https://` 且域名在白名单（`store.steampowered.com`、`steamcommunity.com` 等）
- `will-navigate` / `setWindowOpenHandler` 拦截站外跳转，交给系统浏览器
- 页面带 CSP：脚本只允许 `self`，图片允许 `https` 与 `radarimg:`，禁用内联脚本
- 状态文件只在本机；没有遥测

## 关键取舍

**为什么是 Electron 而不是 Tauri？** Tauri 体积小，但需要 Rust 工具链、Linux 依赖 webkit2gtk 版本差异大，而且自动更新需要自己准备签名与静态更新源。Electron + electron-builder 的更新链路（GitHub Releases + `latest.yml`）开箱即用，Windows/Linux 行为一致，鸿蒙端也不必跟着学一套 Rust。代价是安装包约 100 MB。

**为什么解析 HTML？** 只有这条路能拿到「全站在打折」的列表，`featuredcategories` 只给 10 个。解析集中在单个函数里，并有固定样例单测。

**为什么「史低」是本地记录？** 第三方史低数据（SteamDB / ITAD）需要授权或反爬对抗，不适合放进本地应用。应用明确标注「本地价格记录」，从第一次使用开始积累。

## 测试

- 32 个单元测试：解析器、提醒规则、状态存储/导入导出、筛选排序、金额格式化
- 3 个联网冒烟测试（`RADAR_LIVE=1`）：真实抓取 Steam、完整刷新流程与到价提醒
- `RADAR_LIVE=1 npm test` 会真实请求 Steam，验证接口没变
- 桌面端用 `RADAR_SHOT=<目录>` 在各页面自动截图，便于在无头/远程环境做视觉回归
