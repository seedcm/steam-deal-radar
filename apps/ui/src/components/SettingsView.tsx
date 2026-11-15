import { useRef, useState } from "react";
import type { AppInfo, Settings, UpdateStatus } from "@radar/core";
import { REGIONS, formatDateTime, formatRelativeTime } from "@radar/core";
import {
  BellRing,
  Bug,
  ChevronDown,
  Database,
  Download,
  FileText,
  Github,
  Globe2,
  Info,
  RefreshCw,
  ShieldCheck,
  Upload,
  Wand2,
} from "lucide-react";
import { api } from "../lib/client";

interface SettingsViewProps {
  settings: Settings;
  appInfo: AppInfo | null;
  update: UpdateStatus;
  watchCount: number;
  dealCount: number;
  lastRefreshAt: number | null;
  onChange: (patch: Partial<Settings>) => void;
  onRefresh: () => void;
  onCheckUpdate: () => void;
  onTestNotify: () => void;
  onExport: () => void;
  onImport: (json: string) => Promise<void>;
}

const REPO_URL = "https://github.com/seedcm/steam-deal-radar";
const RELEASES_URL = `${REPO_URL}/releases/latest`;
const ISSUES_URL = `${REPO_URL}/issues`;

const LICENSE_TEXT = `MIT License

Copyright (c) 2026 Steam Deal Radar

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const REFRESH_OPTIONS = [
  { value: 15, label: "每 15 分钟" },
  { value: 30, label: "每 30 分钟" },
  { value: 60, label: "每 1 小时" },
  { value: 180, label: "每 3 小时" },
  { value: 360, label: "每 6 小时" },
  { value: 720, label: "每 12 小时" },
];

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return <button type="button" className={`switch ${on ? "is-on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={onClick} />;
}

function Field({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <div className="field__label">
        <b>{title}</b>
        {desc && <span>{desc}</span>}
      </div>
      <div className="field__control">{children}</div>
    </div>
  );
}

export function SettingsView({
  settings,
  appInfo,
  update,
  watchCount,
  dealCount,
  lastRefreshAt,
  onChange,
  onRefresh,
  onCheckUpdate,
  onTestNotify,
  onExport,
  onImport,
}: SettingsViewProps) {
  const [importOpen, setImportOpen] = useState(false);
  const [showLicense, setShowLicense] = useState(false);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isDesktop = appInfo?.platform === "electron";

  const region = REGIONS.find((item) => item.code === settings.country);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setImportBusy(true);
    try {
      await onImport(await file.text());
      setImportOpen(false);
      setImportText("");
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div className="settings">
      <section className="panel">
        <div className="panel__head">
          <span className="panel__icon">
            <Globe2 size={16} />
          </span>
          <div>
            <h2>区域与刷新</h2>
            <p>价格会随 Steam 区域变化，切换后会按新币种重新抓取</p>
          </div>
        </div>

        <Field title="商店区域" desc={region ? `当前币种 ${region.currency} · 语言 ${region.language}` : undefined}>
          <div className="select">
            <select
              value={settings.country}
              aria-label="商店区域"
              onChange={(event) => {
                const next = REGIONS.find((item) => item.code === event.target.value);
                onChange({ country: event.target.value, language: next?.language ?? settings.language });
              }}
            >
              {REGIONS.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label} ({item.currency})
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </div>
        </Field>

        <Field title="自动刷新间隔" desc={`上次更新：${formatRelativeTime(lastRefreshAt)}`}>
          <div className="select">
            <select
              value={settings.refreshMinutes}
              aria-label="刷新间隔"
              onChange={(event) => onChange({ refreshMinutes: Number(event.target.value) })}
            >
              {REFRESH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </div>
        </Field>

        <Field title="每次抓取的页数" desc="每页 100 个折扣，页数越多越全，但首次加载会更慢">
          <div className="seg">
            {[1, 2, 3, 4, 5, 6].map((page) => (
              <button
                key={page}
                type="button"
                className={settings.fetchPages === page ? "is-active" : ""}
                onClick={() => onChange({ fetchPages: page })}
              >
                {page}
              </button>
            ))}
          </div>
        </Field>

        <Field title="立即刷新" desc={`当前缓存 ${dealCount} 个折扣`}>
          <button type="button" className="btn btn--sm" onClick={onRefresh}>
            <RefreshCw size={13} />
            刷新
          </button>
        </Field>
      </section>

      <section className="panel">
        <div className="panel__head">
          <span className="panel__icon">
            <BellRing size={16} />
          </span>
          <div>
            <h2>折扣提醒</h2>
            <p>关注列表里的游戏降价时，通过系统通知提醒你</p>
          </div>
        </div>

        <Field title="开启提醒" desc="关闭后仍会更新数据，只是不弹通知">
          <Switch on={settings.notifyEnabled} onClick={() => onChange({ notifyEnabled: !settings.notifyEnabled })} label="开启提醒" />
        </Field>

        <Field title="折扣门槛" desc="低于这个折扣力度的游戏不主动提醒（目标价提醒不受限制）">
          <div className="seg">
            {[25, 50, 75].map((value) => (
              <button
                key={value}
                type="button"
                className={settings.notifyMinDiscount === value ? "is-active" : ""}
                onClick={() => onChange({ notifyMinDiscount: value })}
              >
                {value}%
              </button>
            ))}
          </div>
        </Field>

        <Field title="新史低提醒" desc="价格低于本地记录的最低点时额外提醒">
          <Switch on={settings.notifyNewLow} onClick={() => onChange({ notifyNewLow: !settings.notifyNewLow })} label="新史低提醒" />
        </Field>

        <Field title="静默时段" desc="仅保留目标价提醒，避免半夜被推送吵醒">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch on={settings.quietHours.enabled} onClick={() => onChange({ quietHours: { ...settings.quietHours, enabled: !settings.quietHours.enabled } })} label="静默时段" />
            {settings.quietHours.enabled && (
              <>
                <div className="select">
                  <select
                    value={settings.quietHours.start}
                    aria-label="静默开始时间"
                    onChange={(event) => onChange({ quietHours: { ...settings.quietHours, start: Number(event.target.value) } })}
                  >
                    {HOURS.map((hour) => (
                      <option key={hour} value={hour}>
                        {String(hour).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} />
                </div>
                <span className="hint">到</span>
                <div className="select">
                  <select
                    value={settings.quietHours.end}
                    aria-label="静默结束时间"
                    onChange={(event) => onChange({ quietHours: { ...settings.quietHours, end: Number(event.target.value) } })}
                  >
                    {HOURS.map((hour) => (
                      <option key={hour} value={hour}>
                        {String(hour).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} />
                </div>
              </>
            )}
          </div>
        </Field>

        <Field title="测试通知" desc="确认系统允许本应用发送通知">
          <button type="button" className="btn btn--sm" onClick={onTestNotify} disabled={!appInfo?.capabilities.notifications}>
            <Wand2 size={13} />
            发一条
          </button>
        </Field>
      </section>

      <section className="panel">
        <div className="panel__head">
          <span className="panel__icon">
            <Info size={16} />
          </span>
          <div>
            <h2>外观与启动</h2>
            <p>桌面端关闭窗口后仍驻留托盘，才能按时提醒</p>
          </div>
        </div>

        <Field title="主题" desc="跟随你的使用习惯">
          <div className="seg">
            <button type="button" className={settings.theme === "dark" ? "is-active" : ""} onClick={() => onChange({ theme: "dark" })}>
              深色
            </button>
            <button type="button" className={settings.theme === "light" ? "is-active" : ""} onClick={() => onChange({ theme: "light" })}>
              浅色
            </button>
          </div>
        </Field>

        {isDesktop && (
          <>
            <Field title="关闭时最小化到托盘" desc="保持后台刷新与提醒">
              <Switch on={settings.closeToTray} onClick={() => onChange({ closeToTray: !settings.closeToTray })} label="关闭到托盘" />
            </Field>
            <Field title="开机自动启动" desc="登录系统后在后台启动">
              <Switch on={settings.autoLaunch} onClick={() => onChange({ autoLaunch: !settings.autoLaunch })} label="开机自启" />
            </Field>
            <Field title="自动更新客户端" desc={update.phase === "ready" ? "新版本已下载，重启后生效" : "启动时检查新版本"}>
              <Switch on={settings.autoUpdateApp} onClick={() => onChange({ autoUpdateApp: !settings.autoUpdateApp })} label="自动更新" />
            </Field>
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <span className="panel__icon">
            <Database size={16} />
          </span>
          <div>
            <h2>数据管理</h2>
            <p>关注列表、价格记录与设置都保存在本地，可随时迁移</p>
          </div>
        </div>

        <Field title="统计" desc={`关注 ${watchCount} 个 · 缓存 ${dealCount} 个折扣 · 更新于 ${formatDateTime(lastRefreshAt)}`}>
          <span className="hint mono">{appInfo?.dataDir ?? "本地存储"}</span>
        </Field>

        <Field title="导出备份" desc="把关注列表、史低记录和设置复制到剪贴板">
          <button type="button" className="btn btn--sm" onClick={onExport}>
            <Download size={13} />
            导出
          </button>
        </Field>

        <Field title="导入备份" desc="从导出的 JSON 恢复，会覆盖当前数据">
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="btn btn--sm" onClick={() => fileRef.current?.click()} disabled={importBusy}>
              <Upload size={13} />
              选择文件
            </button>
            <button type="button" className="btn btn--sm" onClick={() => setImportOpen((open) => !open)}>
              粘贴 JSON
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => void handleFile(event.target.files?.[0])} />
          </div>
        </Field>

        {importOpen && (
          <div style={{ marginTop: 10 }}>
            <textarea
              className="note-input"
              placeholder="粘贴之前导出的 JSON…"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              rows={5}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn--sm" onClick={() => setImportOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn--sm btn--primary"
                disabled={!importText.trim() || importBusy}
                onClick={async () => {
                  setImportBusy(true);
                  try {
                    await onImport(importText);
                    setImportOpen(false);
                    setImportText("");
                  } finally {
                    setImportBusy(false);
                  }
                }}
              >
                导入
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <span className="panel__icon">
            <ShieldCheck size={16} />
          </span>
          <div>
            <h2>关于</h2>
            <p>
              Steam 折扣雷达 v{appInfo?.version ?? "1.2.0"} · {platformName(appInfo?.platform)}
            </p>
          </div>
        </div>

        <Field title="许可协议" desc="MIT License：可以自由使用、修改、分发，需保留版权与许可声明">
          <button type="button" className="btn btn--sm" onClick={() => setShowLicense((value) => !value)} aria-expanded={showLicense}>
            <FileText size={13} />
            {showLicense ? "收起协议" : "查看协议"}
          </button>
        </Field>

        {showLicense && <pre className="license-text">{LICENSE_TEXT}</pre>}

        <Field title="项目仓库" desc={REPO_URL}>
          <button type="button" className="btn btn--sm" onClick={() => void api.openExternal(REPO_URL)}>
            <Github size={13} />
            打开仓库
          </button>
        </Field>

        <Field title="下载最新版本" desc={`${RELEASES_URL}（Windows 安装包 / Linux AppImage）`}>
          <button type="button" className="btn btn--sm" onClick={() => void api.openExternal(RELEASES_URL)}>
            <Download size={13} />
            打开发布页
          </button>
        </Field>

        <Field title="问题反馈" desc="使用中遇到问题或有建议，可以在仓库里提交 Issue">
          <button type="button" className="btn btn--sm" onClick={() => void api.openExternal(ISSUES_URL)}>
            <Bug size={13} />
            提交 Issue
          </button>
        </Field>

        <Field
          title="客户端更新"
          desc={
            update.phase === "checking"
              ? "正在检查…"
              : update.phase === "available"
                ? `发现新版本 ${update.version ?? ""}`
                : update.phase === "downloading"
                  ? `正在下载 ${Math.round(update.percent ?? 0)}%`
                  : update.phase === "ready"
                    ? "已下载完成，重启即可安装"
                    : update.phase === "unsupported"
                      ? appInfo?.capabilities.autoUpdate
                        ? "当前平台由系统或应用商店负责更新"
                        : "未配置更新源，暂不支持应用内更新"
                      : appInfo?.capabilities.autoUpdate
                        ? "发布新版本后会自动下载"
                        : "未配置更新源，暂不支持应用内更新"
          }
        >
          {update.phase === "ready" ? (
            <button type="button" className="btn btn--sm btn--primary" onClick={() => void api.installUpdate()}>
              立即重启安装
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--sm"
              onClick={onCheckUpdate}
              disabled={update.phase === "checking" || !appInfo?.capabilities.autoUpdate}
            >
              <RefreshCw size={13} className={update.phase === "checking" ? "spin" : undefined} />
              检查更新
            </button>
          )}
        </Field>

        <p className="hint">
          数据来自 Steam 商店公开接口，与 Valve 无隶属关系。所有数据只保存在你的设备上，不会上传到任何服务器。
          评价翻译由第三方免费服务提供，点击翻译时仅发送该条评价原文。
        </p>
      </section>
    </div>
  );
}

function platformName(platform: AppInfo["platform"] | undefined): string {
  switch (platform) {
    case "electron":
      return "桌面版";
    case "harmony":
      return "鸿蒙版";
    default:
      return "网页预览版";
  }
}
