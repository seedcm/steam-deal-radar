# Steam 折扣雷达 · Steam Deal Radar

一个随时查看、自动刷新、断网也能看的 Steam 打折追踪器。可以在 Windows、Linux 和 HarmonyOS NEXT 上运行，用本地星标标记感兴趣的游戏，到了目标价会自动弹系统通知。

## 它解决什么问题

Steam 的折扣页需要一直开着浏览器、刷新、翻页，而且没有「到价提醒」。这个应用把折扣抓下来存在本地：

- **自动刷新**：按你设置的间隔（默认 1 小时）在后台抓取折扣，关掉窗口也继续跑（托盘常驻）
- **离线可看**：折扣列表、封面图、关注列表、本地价格记录全部落盘，断网照样浏览、搜索、加关注
- **关注 + 提醒**：星标游戏，设置目标价；到价、刷新史低、达到折扣门槛都会发系统通知，支持静默时段
- **评价详情**：详情页可直接看 Steam 玩家评价，默认国区（简体中文），可切换港台 / 英语区 / 日区 / 韩区 / 俄区；默认按官方「最有帮助」排序，可只看好评 / 差评或组合显示
- **评价翻译**：任意评价都能翻译成中文、English、日本語、한국어、Русский、Français、Deutsch、Español；默认使用内置免费引擎（MyMemory / Google），也可以在设置里换成自己的 LibreTranslate 或 OpenAI 兼容接口（Ollama、本地模型、付费 API）
- **筛选固定在顶栏**：折扣力度、平台、排序、只看关注与搜索同排，向下滚动时不会被隐藏
- **排序**：支持折扣力度、折扣价、原价、名称、好评率，右侧箭头一键切换升序 / 降序
- **字体大小 / 高分屏**：「设置 → 外观与启动」可选自动、90%–175%；自动模式会按屏幕分辨率与系统缩放选择，首次安装即可用
- **关于页**：左侧栏「关于」里能看到版本、MIT 协议、仓库 / 下载 / 反馈入口，以及带确认提示的检查更新
- **目标价校验**：保留两位小数；负数、乱填会直接提示错误，不会静默改成别的金额
- **导出备份**：直接选择保存位置写成 JSON 文件，并提示保存路径
- **平台筛选**：Windows / macOS / Linux 均可筛选
- **本地价格记录**：每次刷新都记一笔，画出价格走势，标出「史低」
- **跨平台**：同一套界面与数据格式，桌面端（Electron）和鸿蒙端（ArkTS）都能用，备份可以互相导入

断网时顶部会出现提示，但缓存数据照常可用。

## 下载

不想自己构建的话，在仓库右侧的 **Releases** 页面下载最新版本：

- Windows：`SteamDealRadar-<版本>-x64-setup.exe`
- Linux：`steam-deal-radar-<版本>-x86_64.AppImage`

## 平台支持

| 平台 | 形态 | 状态 |
| --- | --- | --- |
| Windows 10/11 | NSIS 安装包 `SteamDealRadar-1.2.0-x64-setup.exe`（+ 免安装目录） | ✅ 已交叉构建 |
| Linux x64 | AppImage `steam-deal-radar-1.2.0-x86_64.AppImage`（deb 可选） | ✅ 已在本机构建并运行验证 |
| HarmonyOS NEXT (API 12+) | ArkTS 工程，DevEco Studio 构建 HAP | ✅ 工程已提供，需本机用 DevEco 签名构建 |
| 浏览器 | `npm run dev:ui` 预览（仅开发用） | ✅ |

> 桌面端使用 Electron 45，安装包约 100 MB；换来的是 Windows/Linux 一致的行为和开箱即用的自动更新。

## 快速开始

需要 Node.js 20+（推荐 22 LTS）。

```bash
npm install          # 安装依赖（会下载 Electron，约 120 MB）
npm run dev:desktop  # 构建界面并在本地启动桌面应用
```

其他常用命令：

```bash
npm test             # 核心逻辑单元测试（解析器、提醒规则、状态存储）
npm run typecheck    # TypeScript 全量类型检查
npm run dev:ui       # 只在浏览器里预览界面（走 vite 代理请求 Steam）
npm run dist:linux   # 打 Linux AppImage → release/
npm run dist:win     # 打 Windows 安装包（需要在 Windows 上执行）
```

打包产物在 `release/`：`steam-deal-radar-1.2.0-x86_64.AppImage`（Linux）、`SteamDealRadar-1.2.0-x64-setup.exe`（Windows）。

Linux 的 `.deb` 需要系统里有 `libcrypt.so.1`（Arch 默认没有），用 `npm run dist:linux:deb -w @radar/desktop` 单独打；普通使用 AppImage 即可。

启动应用后：

1. 首次打开会自动抓取约 300 个折扣（抓取页数可在设置里调，1 页 = 100 个）
2. 点卡片右上角的 ★ 加入关注；点卡片打开详情，可以设置目标价和备注
3. 设置里调整刷新间隔、折扣门槛、静默时段，以及通知开关

## 在 Linux 上启动

产物是 AppImage，三种启动方式任选：

### 方式一：直接运行（最快）

```bash
cd steam-deal-radar
chmod +x release/steam-deal-radar-1.2.0-x86_64.AppImage
./release/steam-deal-radar-1.2.0-x86_64.AppImage
```

首次运行如果报 `dlopen(): error loading libfuse.so.2`，说明系统没装 FUSE2（Arch / Omarchy 默认如此），二选一：

```bash
sudo pacman -S fuse2            # Arch 系，一次性装好依赖
# 或者完全不解压安装，直接以解包模式运行：
./release/steam-deal-radar-1.2.0-x86_64.AppImage --appimage-extract-and-run
```

### 方式二：安装到应用菜单（推荐，免 sudo、免 FUSE）

```bash
bash scripts/install-linux.sh
```

脚本会把 AppImage 解包到 `~/.local/share/steam-deal-radar/`，并写入应用菜单项和 `~/.local/bin/steam-deal-radar`，之后：

- 在应用启动器 / 应用菜单里搜索「Steam 折扣雷达」点开；
- 或者在终端直接执行 `steam-deal-radar`。

卸载：`bash scripts/install-linux.sh --uninstall`（本地数据不会删，仍在 `~/.config/Steam 折扣雷达`）。

### 方式三：从源码运行

```bash
npm install
npm run dev:desktop      # 构建界面 + 启动 Electron
```

### 启动之后

- 第一次启动会自动联网抓取约 300 个折扣，需要几秒钟；之后即使断网也能打开看缓存
- 关掉窗口不会退出，而是缩到系统托盘继续定时刷新和提醒；要彻底退出请用托盘菜单「退出」
- 托盘图标不显示时（部分 Wayland 环境缺少 StatusNotifier 支持），提醒仍会照常工作，也可以从终端启动并用 `Ctrl+C` 退出
- 想改区域/币种、刷新频率、通知门槛：左上「设置」

| 常见现象 | 处理 |
| --- | --- |
| `dlopen(): error loading libfuse.so.2` | 装 `fuse2`，或加 `--appimage-extract-and-run` |
| `The SUID sandbox helper binary was found, but is not configured correctly` | 启动时加 `--no-sandbox`（仅在你信任的环境里） |
| 中文显示成方块 | 安装 `noto-fonts-cjk` |
| 窗口一片空白 | 确认 `release/...AppImage` 是最新构建，或改用 `scripts/install-linux.sh` |

## 在 Windows 上安装

安装包在 `release/SteamDealRadar-1.2.0-x64-setup.exe`（约 108 MB，x64，Windows 10/11）。

1. 把 `setup.exe` 拷到 Windows 上，双击运行。
2. 因为这是本地构建、**没有购买代码签名证书**，Windows SmartScreen 可能提示「Windows 已保护你的电脑」：
   点「更多信息」→「仍要运行」即可。
3. 选择安装目录（默认 `%LOCALAPPDATA%\Programs\SteamDealRadar`），安装只写入当前用户，不需要管理员权限。
4. 装完可以勾选「立即启动」，或从**开始菜单 / 桌面快捷方式「Steam 折扣雷达」**打开。
5. 卸载：`设置 → 应用 → 已安装的应用 → Steam 折扣雷达`，或安装目录里的 `Uninstall.exe`。

**免安装（绿色版）**：`release/win-unpacked/` 就是程序的完整目录，整个拷到 Windows 上双击
`Steam 折扣雷达.exe` 即可运行；也可以自己压缩成 zip 分发。

数据目录：`%APPDATA%\Steam 折扣雷达`（关注列表、价格记录、设置、封面缓存）。

### 重新构建 Windows 安装包

Windows 安装包需要在 Windows 机器上构建（electron-builder 的 NSIS 流程会生成卸载器）：

```bash
npm ci
npm run dist:win
```

产物在 `release/SteamDealRadar-<版本>-x64-setup.exe`，同时生成自动更新需要的 `latest.yml`。

> 仓库 Release 里的 v1.2.0 安装包是在 Linux 上交叉构建的，没有带 `latest.yml`；
> 以后在 Windows 上重新构建并上传，Windows 端的应用内自动更新才会生效。


## 自动更新（桌面端）

应用用 `electron-updater` + GitHub Releases 做更新，更新源就是本仓库的 Release：

1. 在对应平台打包，会自动生成 `latest.yml`（Windows）或 `latest-linux.yml`（Linux）
2. 新建 Release，把安装包和对应的 `latest*.yml` 一起上传：

   ```bash
   gh release create v1.2.1 \
     release/SteamDealRadar-1.2.1-x64-setup.exe \
     release/steam-deal-radar-1.2.1-x86_64.AppImage \
     release/latest.yml release/latest-linux.yml
   ```

3. 老版本客户端启动时会自动检查、下载，下次启动完成安装；也可以在「设置 → 客户端更新」里手动检查

`publish.owner` / `publish.repo` 目前指向本仓库，换仓库时要一起改。

想换成自己的静态服务器，把 `publish` 改成：

```yaml
publish:
  provider: generic
  url: https://your-domain.example.com/steam-deal-radar
```

并把 `latest.yml`、安装包、`*.blockmap` 一起放上去。

### 自定义翻译源

设置 → 翻译：

| 翻译源 | 配置 |
| --- | --- |
| 内置免费（默认） | 无需配置，MyMemory 为主、Google 兜底 |
| LibreTranslate | 填接口地址，如 `http://127.0.0.1:5000/translate`；自建/付费实例可填 API Key |
| OpenAI 兼容 | 填 Base URL（如 `https://api.openai.com/v1`、`http://127.0.0.1:11434/v1`）、模型和 API Key |

API Key 只保存在本机，**导出备份不会包含**。自定义翻译源目前仅桌面端生效，鸿蒙端使用内置免费引擎。

## HarmonyOS

鸿蒙端是独立的 ArkTS 工程（`apps/harmony`），复用同一份 Web 界面与同一套 JSON 状态格式：

```bash
npm run build          # 构建 Web 界面
npm run sync:harmony   # 把 dist 复制到鸿蒙工程的 rawfile/web
```

然后用 DevEco Studio 打开 `apps/harmony`，配置签名后运行。详细步骤见 [apps/harmony/README.md](apps/harmony/README.md)。

鸿蒙端额外做了：WebView 壳 + 原生数据引擎、通知栏提醒、WorkScheduler 后台刷新、`preferences` 持久化。

## 项目结构

```
packages/core/        平台无关的数据引擎（TypeScript）
  ├─ steam.ts         Steam 接口 URL 与 HTML/JSON 解析
  ├─ service.ts       刷新流程：抓取 → 合并 → 史低 → 提醒 → 落盘
  ├─ reminders.ts     提醒规则（纯函数，可单测）
  ├─ store.ts         状态模型、默认设置、通知识别文案
  └─ controller.ts    snapshot/refresh/watch/... 统一方法表
apps/ui/              React 界面（三端共用）
apps/desktop/         Electron 主进程 + preload + electron-builder 配置
apps/harmony/         HarmonyOS ArkTS 工程
docs/BRIDGE.md        渲染层 ↔ 宿主的桥协议
docs/ARCHITECTURE.md  架构与数据流
```

## 数据与隐私

- 所有数据都在本地：`%APPDATA%/Steam 折扣雷达`（Windows）、`~/.config/Steam 折扣雷达`（Linux）、鸿蒙 `preferences`
- 只请求 Steam 商店的公开接口（`store.steampowered.com`），不登录、不需要 API Key、不上传任何数据
- 封面图缓存在 `image-cache/`，断网时直接读本地文件

## 连不上 Steam / 一直提示「无法获取折扣」

先升级到 1.4.8 或更新版本（主进程已改用 Chromium 网络栈，会跟随系统代理）。如果仍然失败：

1. 打开「设置 → 网络」
2. 代理模式选 **手动代理**，地址填代理软件的本地端口，例如 Clash 默认的 `http://127.0.0.1:7890`
3. 如果代理是 TUN 模式或已设为系统代理，选 **跟随系统** 即可
4. 使用 Steamcommunity_302 等本地加速工具时，如果错误提示证书不受信任，可在「设置 → 网络」临时开启「允许自签名证书」
5. 错误提示现在会带具体原因，例如 `HTTP 403`、`ERR_PROXY_CONNECTION_FAILED`、`ERR_NAME_NOT_RESOLVED`，可据此判断是代理没开、端口不对还是被 Steam 拒绝

## 反馈问题

「关于 → 项目信息」里有：

- **复制诊断**：版本、系统、刷新错误、代理/翻译配置等（不含账号与密钥）
- **提交 Issue**：自动把诊断信息填进 GitHub Issue 正文

主界面刷新失败时，横幅上也有「复制诊断」按钮。

## Windows 卸载

卸载时会弹窗询问是否删除本地数据：

- 选「是」：删除 `%APPDATA%\Steam 折扣雷达`（设置、关注、价格历史、图片缓存）和更新缓存
- 选「否」：保留数据，重新安装后继续使用
- 静默卸载（`/S`）默认保留数据

## 已知限制

- Steam 没有官方「折扣列表」API，折扣数据解析自商店搜索页的服务端渲染 HTML；Steam 改版时可能需要更新 `packages/core/src/steam.ts` 里的解析规则（已有单测覆盖）
- 价格以你选择的商店区域为准（默认中国区 / CNY），跨区价格不可比
- 「史低」指**本应用记录到的最低价**，不是 SteamDB 的全球历史最低；记录从你第一次刷新开始
- 桌面端后台提醒依赖应用常驻托盘；Linux 上如果桌面环境不支持托盘，请保持窗口运行
- 评价翻译依赖第三方免费服务（MyMemory 为主、Google 备用），需要联网且可能受每日额度限制；点「翻译成中文」时评价原文会发送给该服务
- 鸿蒙端需要 DevEco Studio + 华为开发者签名；`WorkScheduler` 实际调度频率由系统决定，可能被省电策略延迟

## 开发

```bash
npm run build -w @radar/core   # 生成 .d.ts
npm test                       # vitest
RADAR_LIVE=1 npm test          # 额外跑联网冒烟测试（真实请求 Steam 与完整刷新流程）
```

界面热更新：一个终端跑 `npm run dev:ui`，另一个终端跑
`RADAR_UI_URL=http://localhost:5273 npm run dev -w @radar/desktop`，Electron 会加载 Vite 开发服务器。

调试技巧：设置 `RADAR_SHOT=<目录>` 启动桌面端，会在各页面自动截图后退出（用于无头环境验界面）。

## License

MIT
