# Steam 折扣雷达 · HarmonyOS NEXT 端

这是 Steam 折扣雷达的鸿蒙端：**WebView 壳 + ArkTS 原生数据引擎**。

- 界面复用仓库里的 `apps/ui` 构建产物（React + Vite），通过 `rawfile/web/` 加载；
- 抓取、解析、持久化、提醒判断、系统通知全部在 ArkTS 侧完成，不依赖 Node.js；
- 状态 JSON 与 `packages/core/src/store.ts` 的 `PersistedState` 完全同构，桌面端导出的备份可以直接导入。

---

## 1. 环境要求

| 项 | 版本 |
| --- | --- |
| DevEco Studio | 5.0.0 Release 及以上（支持 HarmonyOS NEXT / API 12） |
| HarmonyOS SDK | 5.0.0(12) |
| 设备 | HarmonyOS NEXT 真机或 API 12 模拟器 |
| Node.js | 20+（仅在仓库根目录同步前端资源时需要） |

关键配置：

```json5
// AppScope/app.json5
bundleName: "com.steamdealradar.app"
versionName: "1.2.0"
versionCode: 10200

// build-profile.json5（工程级 + product）
"compileSdkVersion": 12,
"products": [{
  "compileSdkVersion": "5.0.0(12)",
  "compatibleSdkVersion": "5.0.0(12)",
  "targetSdkVersion": "5.0.0(12)",
  "runtimeOS": "HarmonyOS"
}]
```

`entry/build-profile.json5` 中 `apiType` 为 `stageMode`。

---

## 2. 打开、签名与运行

1. 打开 **DevEco Studio → Open**，选择本目录 `apps/harmony`（不要选仓库根目录）。
2. 等待 **Sync Now** 完成。如果提示 SDK 版本，请选择 API 12 / 5.0.0(12)。
3. 配置签名：
   - **File → Project Structure → Signing Configs**；
   - 登录华为开发者账号后勾选 **Automatically generate signature**；
   - 或者手动导入已带 ACL 的 `.p7b` / `.cer` / `.p12`。
4. 选择 `entry` 模块与真机/模拟器，点击 **Run**。
5. 构建 HAP：**Build → Build Hap(s)/APP(s) → Build Hap(s)**。
   产物默认在 `entry/build/default/outputs/default/` 下（以实际构建模式为准）。

> 首次启动会弹出系统通知授权框。若曾拒绝，需要到「系统设置 → 通知 → Steam 折扣雷达」里手动打开。

---

## 3. 同步前端资源

`entry/src/main/resources/rawfile/web/` 由 `scripts/sync-harmony.mjs` 生成，仓库里保留一个 `.gitkeep` 以确保路径存在。

- 如果该目录下已有 `index.html` 与 `assets/`，说明已经同步过，可直接构建；
- 如果只有 `.gitkeep`，或修改了前端代码，在仓库根目录执行：

```bash
npm run sync:harmony
```

该命令会：

1. 构建 `@radar/core` 与 `@radar/ui`；
2. 清空并重新复制 `apps/ui/dist/` 到 `apps/harmony/entry/src/main/resources/rawfile/web/`（会删除 `.gitkeep`，属正常行为）；
3. 写入 `.synced` 标记文件。

之后在 DevEco 里重新构建/运行即可看到界面。**不要手动编辑 `rawfile/web/` 下的文件**，它会被下次同步覆盖。

> 如果只做原生桥/引擎开发，可以先不同步；此时 WebView 会因找不到 `web/index.html` 显示空白，属于预期行为。

---

## 4. 桥协议

### 4.1 注入方式

`pages/Index.ets` 在 `Web` 组件初始化时通过 `javaScriptProxy` 注入：

```ts
.javaScriptProxy({
  object: this.bridge,
  name: 'nativeBridge',
  methodList: ['invoke', 'platform', 'version'],
  controller: this.controller
})
```

之所以放在组件属性而不是 `onPageEnd`：前端 bundle 在页面加载阶段就会检查 `window.nativeBridge`，属性方式能保证它在页面自己的 module script 之前注入。`onPageEnd` 负责标记页面就绪、补发启动阶段缓存的事件，并触发「数据过期时自动刷新」。

### 4.2 调用与回调

前端：

```ts
window.nativeBridge.invoke(method, payloadJson, callbackId)
```

原生处理完成后通过 `webviewController.runJavaScript` 调用：

```js
window.__radarResolve(callbackId, true | false, payloadJson)
```

- 成功：`payloadJson` 为方法返回值经 `JSON.stringify` 后的字符串；
- 失败：`payloadJson` 为 `{"message":"..."}`；
- 无返回值：第三参传空字符串（前端解析为 `undefined`）；
- `copyText`：成功按约定传字符串 `"null"`（前端解析为 `null`）。

所有 `runJavaScript` 都带 `try/catch` 且忽略页面未就绪时的失败。

### 4.3 方法表

| method | payload | 返回 |
| --- | --- | --- |
| `snapshot` | 无 | `Snapshot` |
| `refresh` | 无 | `{ ok, error?, dealCount, newLowCount, notifications, finishedAt }` |
| `watch` | `{ appId, name, image?, targetPrice? }` | `WatchEntry` |
| `unwatch` | `{ appId }` | `boolean` |
| `updateWatch` | `{ appId, patch }` | `WatchEntry \| null` |
| `updateSettings` | `{ patch }` | `Settings` |
| `search` | `{ term }` | `SearchHit[]`（term < 2 字符返回 `[]`） |
| `details` | `{ appId }` | `Deal \| null` |
| `reviews` | `{ appId, next?, language? }` | `ReviewPage`（Steam 官方「最有帮助」排序；`language` 可选，如 `schinese` / `english`，`all` 或不传为全部语言） |
| `translate` | `{ text, target? }` | `{ text, engine }`（MyMemory 为主、Google 备用；`target` 默认 `zh-CN`） |
| `openExternal` | `{ url }` | 无（仅 https + Steam 白名单） |
| `openStore` | `{ appId }` | 无 |
| `testNotification` | 无 | 无 |
| `checkUpdate` | 无 | `{ "phase": "unsupported" }` |
| `installUpdate` | 无 | 无（由应用市场更新） |
| `exportData` | 无 | 状态 JSON 字符串 |
| `importData` | `{ json }` | 无（覆盖本地状态） |
| `copyText` | `{ text }` | `null`（写入系统剪贴板） |
| `quit` | 无 | 无（`terminateSelf`） |
| `appInfo` | 无 | `AppInfo` |

`openExternal` 白名单与桌面端一致：

- `store.steampowered.com`
- `steamcommunity.com`
- `help.steampowered.com`

仅允许 `https:`，且允许上述域名的子域；不满足时抛 `不支持打开的链接`。

### 4.4 事件

原生通过 `runJavaScript` 调用：

```js
window.__radarEvent(eventJson)
```

| 事件 | 触发时机 |
| --- | --- |
| `{"type":"snapshot","snapshot":...}` | 刷新完成、关注/设置/导入等数据变化后 |
| `{"type":"refreshing","value":true\|false}` | 刷新开始/结束 |
| `{"type":"toast","message":"...","tone":"info\|error\|success"}` | 保留给后续宿主主动提示 |
| `{"type":"notification","notification":{...}}` | 每发一条系统通知同时推给前端（UI 显示 toast） |
| `{"type":"update","status":{"phase":"idle"}}` | 页面就绪时推送一次 |

页面未加载完成时事件先入队（最多 32 条），`onPageEnd` 后统一补发并补一条初始 `snapshot`。

### 4.5 清除目标价

`updateWatch` 的 patch 中 `targetPrice` 支持显式 `null`：前端清除目标价时发送 `{ targetPrice: null }`，原生会把该字段删除。  
空 patch `{}` 按桌面端语义视为「无变化」，不会误清目标价。

---

## 5. 数据引擎

### 5.1 抓取

使用 `@ohos.net.http`：

- `http.createHttp()`，`expectDataType: STRING`，连接/读取超时各 20s；
- `User-Agent: Mozilla/5.0 ... Chrome/126.0 Safari/537.36`；
- `Accept-Language: zh-CN,zh;q=0.9`；
- 每次请求结束 `destroy()`。

接口与解析规则对应 `packages/core/src/steam.ts`：

| 用途 | URL |
| --- | --- |
| 折扣列表 | `https://store.steampowered.com/search/results/?query=&start={page*100}&count=100&specials=1&infinite=1&sort_by=Reviews_DESC&cc={cc}&l={l}` |
| 每日特惠 | `https://store.steampowered.com/api/featuredcategories?cc={cc}&l={l}` |
| 单个游戏 | `https://store.steampowered.com/api/appdetails?appids={id}&cc={cc}&l={l}` |
| 全站搜索 | `https://store.steampowered.com/api/storesearch/?term={term}&cc={cc}&l={l}` |

折扣列表解析 `results_html` 中每条 `data-ds-appid="ID"` 片段，字段与 `parseSearchResults` 一致（标题、折扣、原价/现价文本、评价摘要与好评率、平台、封面、发行日期），并处理 HTML 实体。

另支持评价详情（`reviews`）：第一页解析 Steam 社区 `reviews` 页面，后续页用 `homecontent` 分页片段，规则与桌面端 `parseReviewsHtml` 一致。语言筛选通过可选的 `filterLanguage` 参数（`all` 或不传为全部语言），`l=english` 始终固定，保证日期/推荐文案可解析。翻译（`translate`）对应 `packages/core/src/translate.ts`：MyMemory 为主、Google 备用，长文本按 450 字符分段。

### 5.2 刷新流程

与 `packages/core/src/service.ts` 对齐：

1. 按 `fetchPages`（1~6，默认 3）并发抓取折扣页，并发度 3；
2. 抓 `featuredcategories`，合并 `discountEndsAt`；
3. 若折扣页为空，退化使用 featuredcategories；
4. 关注列表里已在折扣页的直接生成报价；不在折扣页的逐个查 `appdetails` 补价格（单轮最多 40 个，并发 3）；
5. `recordPrice` 更新 `lowest` 与 `history`（最多 90 点，同价 6 小时内不重复打点）；
6. 用本轮开始前的 `lowest` 快照计算新史低、生成提醒；
7. 发送系统通知，写 `lastRefreshAt` / `lastRefreshError` 并持久化；
8. 推送 `snapshot` 事件。

并发调用 `refresh` 会复用同一个 inflight Promise（与桌面端一致）。

### 5.3 提醒规则

对应 `packages/core/src/reminders.ts`：

- 优先级：目标价 > 新史低 > 折扣门槛；
- 同一关注项 12 小时内同价不重复；
- 静默时段只放行目标价提醒；
- 单轮最多 5 条，按折扣从高到低排序；
- 通知标题/正文与 `buildNotification` 一致；金额优先使用 Steam 返回的 `priceText`，目标价等本地金额用固定符号 + 小数位格式（不依赖设备上的 Intl 实现）。

### 5.4 持久化

- 使用 `@ohos.data.preferences`；
- preferences 实例名：`radar`；
- key：`radar-state`（需求约定）；
- value：`PersistedState` 的 JSON 字符串。

`PersistedState` 键名与桌面端 `radar-state.json` 完全一致：

```ts
{
  version, settings, watchlist, deals, watchQuotes, lowest, history,
  lastRefreshAt, lastRefreshError
}
```

`exportData` 额外写入 `exportedAt`（导入时忽略），`importData` 会：
- 缺字段补默认值；
- `settings` 走 `sanitizeSettings`；
- `lastRefreshError` 清空；
- 立即落盘；
- 按需重新注册后台任务（刷新间隔变化时）。

---

## 6. 后台任务与通知

### 6.1 WorkScheduler

- 扩展：`entry/src/main/ets/work/RefreshWork.ets`，继承 `WorkSchedulerExtensionAbility`；
- `module.json5` 中注册：

```json5
{
  "name": "RefreshWork",
  "srcEntry": "./ets/work/RefreshWork.ets",
  "type": "workScheduler",
  "exported": false
}
```

- 注册时机：
  - `EntryAbility.onCreate` 读取设置后注册一次；
  - 前端修改 `refreshMinutes` 或导入备份后，`NativeBridge` 仅在间隔变化时重新注册；
- 任务参数：`isRepeat: true`、`networkType: NETWORK_TYPE_ANY`、`isPersisted: true`；
- 循环间隔：`max(20, settings.refreshMinutes) * 60_000`，即最小 20 分钟；
- 回调中复用 `RadarEngine`，通知由 `Notifier` 直接发布，UI 事件接到空实现。

> **系统限制（重要）**：WorkScheduler 不保证准点。系统会按应用活跃度/电量/温度/网络统一调度；官方文档给出的应用活跃分组最小间隔为 2 小时，单次 `onWorkStart` 最长约 2 分钟。前台打开应用时的自动刷新不受此限制。

### 6.2 通知

- 首次启动：`EntryAbility` 在 `loadContent` 成功后调用 `notificationManager.requestEnableNotification(context)`；已授权则跳过；
- 发送：`notificationManager.publish`，`id = appId`，标题/正文与 `buildNotification` 一致；
- 点击通知：通过 `WantAgent`（`START_ABILITY`）拉起 `EntryAbility`；
- 设置页「测试通知」调用 `testNotification`，文案与桌面端一致。

### 6.3 权限

`module.json5` 已声明：

- `ohos.permission.INTERNET`（普通权限，system_grant）
- `ohos.permission.KEEP_BACKGROUND_RUNNING`（普通权限，system_grant）

**未默认声明** `ohos.permission.START_ABILITIES_FROM_BACKGROUND`：它是 `system_basic` 且需要 ACL，普通调试证书声明后可能导致安装失败。本工程通过 WantAgent 拉起自己的 UIAbility，不需要该权限。若你的分发证书带 ACL，可以按需加入 `requestPermissions`。

---

## 7. 目录结构

```
apps/harmony/
├── build-profile.json5
├── hvigorfile.ts
├── hvigor/hvigor-config.json5
├── oh-package.json5
├── AppScope/
│   ├── app.json5
│   └── resources/base/
│       ├── element/string.json
│       └── media/app_icon.png
├── entry/
│   ├── build-profile.json5
│   ├── hvigorfile.ts
│   ├── oh-package.json5
│   └── src/main/
│       ├── module.json5
│       ├── ets/
│       │   ├── entryability/EntryAbility.ets
│       │   ├── pages/Index.ets
│       │   ├── bridge/NativeBridge.ets
│       │   ├── data/Types.ets
│       │   ├── data/Reminders.ets
│       │   ├── data/StateStore.ets
│       │   ├── data/SteamClient.ets
│       │   ├── data/RadarEngine.ets
│       │   ├── notify/Notifier.ets
│       │   └── work/RefreshWork.ets
│       └── resources/
│           ├── base/element/{string,color}.json
│           ├── base/profile/main_pages.json
│           ├── base/media/{icon,startIcon}.png
│           └── rawfile/web/          # 由 sync 脚本生成（含 .gitkeep 占位）
└── README.md
```

`data/Types.ets` 集中放领域模型与纯函数（默认设置、金额格式化、通知文案、Deal 合并）；
`data/Reminders.ets` 放提醒规划，便于和 core 的 `reminders.ts` 对照。

---

## 8. 未在 DevEco 环境中验证的部分

本工程在没有 HarmonyOS SDK / DevEco Studio 的环境中创建，因此：

1. **未执行 hvigor 真正编译**。已做：
   - 全部 `.json` / `.json5` 用 JSON5 解析校验；
   - 除 `Index.ets`（ArkUI struct 语法）外的全部 `.ets` 做了 TypeScript 语法检查；
   - 用一套手写的 `@ohos.*` 声明对非 UI 代码做了 `strict` 类型检查。
2. **javaScriptProxy 注入时机**：按官方示例放在 `Web` 组件属性上，理论上在页面脚本前可用；如果某些 SDK 版本注入偏晚，前端会回退到 Web 预览模式（`window.nativeBridge` 为空时 `bridge.ts` 会选择 WebBridge）。真机上请确认设置页显示 HarmonyOS 平台信息。
3. **WorkScheduler 实际触发频率**受系统管控，无法在桌面环境验证。
4. **通知权限与 WantAgent 行为**需真机验证，特别是用户拒绝授权后的表现。
5. **Steam 页面结构**属于非官方解析，Steam 改版可能导致字段缺失；解析逻辑与现有桌面端同源。
6. **hvigor 版本**：`hvigorfile.ts` 使用标准的 `@ohos/hvigor-ohos-plugin` 写法，`hvigor/hvigor-config.json5` 的 `modelVersion` 为 `5.0.0`，`dependencies` 留空以复用 DevEco 自带插件。如果本机 DevEco 版本更高，Sync 时按其提示升级即可。
7. **build-profile.json5** 同时保留了工程级数字 `compileSdkVersion: 12` 和 product 级字符串版本。若某个 DevEco 版本对工程级数字字段报 schema 错误，删除工程级那一行即可，product 级 `"5.0.0(12)"` 才是 API 12 的权威配置。
8. **ArkTS API 假设**：按 API 12（HarmonyOS NEXT 5.0.0）编写，使用 `@ohos.*` 默认导入方式（`@ohos.net.http`、`@ohos.data.preferences`、`@ohos.notificationManager`、`@ohos.resourceschedule.workScheduler`、`@ohos.WorkSchedulerExtensionAbility`、`@ohos.web.webview` 等）。API 13+ 建议迁移到 `@kit.*` 聚合导入。
9. **通知 id = appId**：测试通知的 `appId` 为 0，即通知 id 为 0；如果个别系统版本不接受 0，可改为 `appId + 1`，但会与协议中的「id 用 appId」不一致。
10. **后台任务单次回调 2 分钟上限**：正常网络下刷新远低于该限制；弱网时可能被系统截断，下一轮会继续。
11. **后台任务运行在独立的 Extension 进程**：它写入的 preferences 与主进程内存状态不是同一份。主进程下次启动会读取最新状态；前后台同时修改状态时，以最后一次落盘为准。这是 HarmonyOS 多进程模型的固有限制，当前实现未做跨进程合并。
12. **rawfile + Vite module 产物**：`index.html` 通过 `resource://rawfile` 加载 ES module 脚本，理论上是同源、可用；但未在真机验证。若出现白屏，请先在 DevEco 的 WebView 调试中确认 module script 是否被 CORS/协议限制。
