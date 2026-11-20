import { useRef, useState } from "react";
import type { AppInfo, ProxyMode, Settings, TranslationProvider } from "@radar/core";
import { REGIONS, TRANSLATION_TARGETS, formatDateTime, formatRelativeTime } from "@radar/core";
import {
  BellRing,
  ChevronDown,
  Database,
  Download,
  Globe2,
  Info,
  Network,
  Languages,
  Loader2,
  RefreshCw,
  Upload,
  Wand2,
} from "lucide-react";
import { api } from "../lib/client";

interface SettingsViewProps {
  settings: Settings;
  appInfo: AppInfo | null;
  watchCount: number;
  dealCount: number;
  lastRefreshAt: number | null;
  onChange: (patch: Partial<Settings>) => void;
  onRefresh: () => void;
  onTestNotify: () => void;
  onExport: () => void;
  onImport: (json: string) => Promise<void>;
}

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
  watchCount,
  dealCount,
  lastRefreshAt,
  onChange,
  onRefresh,
  onTestNotify,
  onExport,
  onImport,
}: SettingsViewProps) {
  const [importOpen, setImportOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
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
            <Languages size={16} />
          </span>
          <div>
            <h2>翻译</h2>
            <p>评价翻译默认用内置免费引擎，也可以换成自己的翻译源</p>
          </div>
        </div>

        <Field title="翻译源" desc="内置免费无需配置；自定义源适合本地翻译工具或付费 API">
          <div className="select">
            <select
              value={settings.translationProvider}
              aria-label="翻译源"
              onChange={(event) => onChange({ translationProvider: event.target.value as TranslationProvider })}
            >
              <option value="builtin">内置免费（MyMemory / Google）</option>
              <option value="libretranslate">LibreTranslate（本地 / 自建）</option>
              <option value="openai">OpenAI 兼容（Ollama / 付费 API）</option>
            </select>
            <ChevronDown size={13} />
          </div>
        </Field>

        {settings.translationProvider !== "builtin" && (
          <>
            <Field
              title="接口地址"
              desc={
                settings.translationProvider === "libretranslate"
                  ? "例如 http://127.0.0.1:5000/translate"
                  : "例如 https://api.openai.com/v1 或 http://127.0.0.1:11434/v1"
              }
            >
              <input
                className="text-input field-input"
                value={settings.translationEndpoint}
                placeholder={settings.translationProvider === "libretranslate" ? "http://127.0.0.1:5000/translate" : "https://api.openai.com/v1"}
                onChange={(event) => onChange({ translationEndpoint: event.target.value })}
                spellCheck={false}
              />
            </Field>

            {settings.translationProvider === "openai" && (
              <Field title="模型" desc="例如 gpt-4o-mini、qwen2.5、llama3.1">
                <input
                  className="text-input field-input"
                  value={settings.translationModel}
                  placeholder="gpt-4o-mini"
                  onChange={(event) => onChange({ translationModel: event.target.value })}
                  spellCheck={false}
                />
              </Field>
            )}

            <Field title="API Key" desc="本地服务通常不需要；只保存在本机，导出备份时不会包含">
              <input
                className="text-input field-input"
                type="password"
                value={settings.translationApiKey}
                placeholder="可选"
                onChange={(event) => onChange({ translationApiKey: event.target.value })}
                spellCheck={false}
              />
            </Field>
          </>
        )}

        <Field title="默认翻译目标" desc="评价详情里默认翻译成哪种语言">
          <div className="select">
            <select
              value={settings.translationTarget}
              aria-label="默认翻译目标"
              onChange={(event) => onChange({ translationTarget: event.target.value })}
            >
              {TRANSLATION_TARGETS.map((target) => (
                <option key={target.code} value={target.code}>
                  {target.label}
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </div>
        </Field>

        <Field title="测试翻译" desc={testResult ?? "用「你好，世界」验证当前翻译源是否可用"}>
          <button
            type="button"
            className="btn btn--sm"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              setTestResult(null);
              try {
                const result = await api.translate("你好，世界", settings.translationTarget);
                setTestResult(`「你好，世界」→「${result.text}」（${result.engine}）`);
              } catch (error) {
                setTestResult(error instanceof Error ? error.message : "翻译失败");
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? <Loader2 size={13} className="spin" /> : null}
            测试
          </button>
        </Field>

        {appInfo?.platform === "harmony" && (
          <p className="hint">自定义翻译源目前仅桌面端支持，鸿蒙端会使用内置免费引擎。</p>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <span className="panel__icon">
            <Network size={16} />
          </span>
          <div>
            <h2>网络</h2>
            <p>折扣、图片、翻译和更新请求都走这里设置的代理</p>
          </div>
        </div>

        <Field title="代理模式" desc="如果开了 Clash 等代理软件，选「手动」并填本地端口通常最稳">
          <div className="select">
            <select
              value={settings.proxyMode}
              aria-label="代理模式"
              onChange={(event) => onChange({ proxyMode: event.target.value as ProxyMode })}
            >
              <option value="system">跟随系统</option>
              <option value="direct">直连（不使用代理）</option>
              <option value="manual">手动代理</option>
            </select>
            <ChevronDown size={13} />
          </div>
        </Field>

        {settings.proxyMode === "manual" && (
          <Field title="代理地址" desc="支持 http:// 或 socks5://，多个代理用分号分隔">
            <input
              className="text-input field-input"
              value={settings.proxyRules}
              placeholder="http://127.0.0.1:7890"
              onChange={(event) => onChange({ proxyRules: event.target.value })}
              spellCheck={false}
            />
          </Field>
        )}

        <Field
          title="允许自签名证书"
          desc="仅在使用 Steamcommunity_302 等本地加速工具、且错误提示证书不受信任时开启"
        >
          <Switch
            on={settings.allowInsecureCert}
            onClick={() => onChange({ allowInsecureCert: !settings.allowInsecureCert })}
            label="允许自签名证书"
          />
        </Field>

        <p className="hint">
          修改后立即生效（下一次请求开始使用）；如果代理软件只监听局域网地址，请填实际地址。当前仅桌面端支持代理设置。
          开启「允许自签名证书」会降低连接安全性，只建议在明确知道自己在用什么本地加速工具时临时开启。
        </p>
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

        <Field title="字体大小" desc="自动会按屏幕分辨率与系统缩放选择；调整后立即生效">
          <div className="select">
            <select
              value={settings.uiScale}
              aria-label="字体大小"
              onChange={(event) => onChange({ uiScale: Number(event.target.value) })}
            >
              <option value={0}>自动（推荐）</option>
              <option value={0.9}>90%</option>
              <option value={1}>100%</option>
              <option value={1.1}>110%</option>
              <option value={1.25}>125%</option>
              <option value={1.5}>150%</option>
              <option value={1.75}>175%</option>
            </select>
            <ChevronDown size={13} />
          </div>
        </Field>

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
            <Field title="自动更新客户端" desc="启动时检查新版本；也可以在「关于」里手动检查并安装">
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

        <Field title="导出备份" desc="选择位置保存为 JSON 文件，包含关注、史低与设置（不含翻译 API Key）">
          <button type="button" className="btn btn--sm" onClick={onExport}>
            <Download size={13} />
            导出备份
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

    </div>
  );
}
