import { useEffect, useState } from "react";
import type { AppInfo, UpdateStatus } from "@radar/core";
import { Bug, CheckCircle2, Download, ExternalLink, FileText, Github, Info, RefreshCw, ShieldCheck } from "lucide-react";

interface AboutViewProps {
  appInfo: AppInfo | null;
  update: UpdateStatus;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  onOpen: (url: string) => void;
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

function Row({ title, desc, children }: { title: string; desc?: string; children?: React.ReactNode }) {
  return (
    <div className="field">
      <div className="field__label">
        <b>{title}</b>
        {desc && <span>{desc}</span>}
      </div>
      {children && <div className="field__control">{children}</div>}
    </div>
  );
}

export function AboutView({ appInfo, update, onCheckUpdate, onInstallUpdate, onOpen }: AboutViewProps) {
  const [showLicense, setShowLicense] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (update.phase === "checking") setDismissed(false);
    if (update.phase === "ready" || update.phase === "none" || update.phase === "error") setInstalling(false);
  }, [update.phase]);

  const checking = update.phase === "checking";
  const available = update.phase === "available" ? update.version ?? "" : null;
  const downloading = update.phase === "downloading";
  const ready = update.phase === "ready";

  const startInstall = () => {
    setInstalling(true);
    onInstallUpdate();
  };

  return (
    <div className="settings">
      <section className="panel">
        <div className="panel__head">
          <span className="panel__icon">
            <Info size={16} />
          </span>
          <div>
            <h2>关于</h2>
            <p>
              Steam 折扣雷达 v{appInfo?.version ?? "1.5.0"} · {platformName(appInfo?.platform)}
            </p>
          </div>
        </div>

        <Row title="运行环境" desc={appInfo?.os} />
        <Row title="数据目录" desc={appInfo?.dataDir ?? "本地存储"} />

        <Row
          title="客户端更新"
          desc={
            checking
              ? "正在检查新版本…"
              : available
                ? `发现新版本 v${available}`
                : downloading
                  ? `正在下载 ${Math.round(update.percent ?? 0)}%`
                  : ready
                    ? "新版本已下载，重启后完成安装"
                    : update.phase === "none"
                      ? `当前已是最新版本 v${appInfo?.version ?? ""}`
                      : update.phase === "error"
                        ? update.message ?? "检查更新失败"
                        : update.phase === "unsupported"
                          ? update.message ?? "当前平台不支持应用内更新"
                          : "启动时自动检查，也可以手动检查"
          }
        >
          {ready ? (
            <button type="button" className="btn btn--sm btn--primary" onClick={startInstall} disabled={installing}>
              <RefreshCw size={13} /> 重启并安装
            </button>
          ) : (
            <button type="button" className="btn btn--sm" onClick={onCheckUpdate} disabled={checking || downloading}>
              <RefreshCw size={13} className={checking ? "spin" : undefined} />
              {checking ? "检查中…" : "检查更新"}
            </button>
          )}
        </Row>

        {available && !dismissed && !downloading && (
          <div className="update-card">
            <div>
              <b>发现新版本 v{available}</b>
              <span>是否现在下载并安装？应用会在下载完成后自动重启。</span>
            </div>
            <div className="update-card__actions">
              <button type="button" className="btn btn--sm btn--primary" onClick={startInstall}>
                <Download size={13} /> 下载并安装
              </button>
              <button type="button" className="btn btn--sm" onClick={() => setDismissed(true)}>
                稍后
              </button>
            </div>
          </div>
        )}

        {downloading && (
          <div className="update-card">
            <div>
              <b>正在下载新版本…</b>
              <span>{Math.round(update.percent ?? 0)}%（下载完成后会自动退出并安装）</span>
            </div>
            <div className="update-progress">
              <i style={{ width: `${Math.max(3, Math.min(100, update.percent ?? 0))}%` }} />
            </div>
          </div>
        )}

        {update.phase === "none" && (
          <p className="update-note">
            <CheckCircle2 size={13} /> 当前版本 v{appInfo?.version ?? ""} 已经是最新版本。
          </p>
        )}

      </section>

      <section className="panel">
        <div className="panel__head">
          <span className="panel__icon">
            <ShieldCheck size={16} />
          </span>
          <div>
            <h2>许可协议</h2>
            <p>MIT License：可以自由使用、修改、分发，需保留版权与许可声明</p>
          </div>
        </div>

        <Row title="许可证" desc="MIT License">
          <button type="button" className="btn btn--sm" onClick={() => setShowLicense((value) => !value)} aria-expanded={showLicense}>
            <FileText size={13} />
            {showLicense ? "收起协议" : "查看协议"}
          </button>
        </Row>

        {showLicense && <pre className="license-text">{LICENSE_TEXT}</pre>}
      </section>

      <section className="panel">
        <div className="panel__head">
          <span className="panel__icon">
            <Github size={16} />
          </span>
          <div>
            <h2>项目信息</h2>
            <p>源码、更新日志与问题反馈都在 GitHub 上</p>
          </div>
        </div>

        <Row title="项目仓库" desc={REPO_URL}>
          <button type="button" className="btn btn--sm" onClick={() => onOpen(REPO_URL)}>
            <ExternalLink size={13} /> 打开仓库
          </button>
        </Row>

        <Row title="下载最新版本" desc={`${RELEASES_URL}（Windows 安装包 / Linux AppImage）`}>
          <button type="button" className="btn btn--sm" onClick={() => onOpen(RELEASES_URL)}>
            <Download size={13} /> 打开发布页
          </button>
        </Row>

        <Row title="问题反馈" desc="遇到问题或有建议，可以在仓库里提交 Issue">
          <button type="button" className="btn btn--sm" onClick={() => onOpen(ISSUES_URL)}>
            <Bug size={13} /> 提交 Issue
          </button>
        </Row>

        <p className="hint">
          数据来自 Steam 商店公开接口，与 Valve 无隶属关系。所有数据只保存在你的设备上，不会上传到任何服务器。
          评价翻译由第三方服务提供，点击翻译时仅发送该条评价原文。
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
