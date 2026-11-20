import { ArrowDown, ArrowUp, ArrowUpDown, Check, RefreshCw, Search, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PlatformFilter, Settings, SortKey } from "@radar/core";
import { DEFAULT_SORT_DIRECTION, SORT_LABELS } from "@radar/core";
import { ChevronDown } from "lucide-react";

interface TopBarProps {
  title: string;
  subtitle: string;
  query: string;
  onQuery: (value: string) => void;
  showSearch: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  settings: Settings | null;
  watchOnly: boolean;
  onToggleWatchOnly: () => void;
  onChangeSettings: (patch: Partial<Settings>) => void;
}

const DISCOUNT_STEPS = [
  { value: 0, label: "全部折扣" },
  { value: 25, label: "≥25%" },
  { value: 50, label: "≥50%" },
  { value: 70, label: "≥70%" },
  { value: 85, label: "≥85%" },
];

const PLATFORMS: Array<{ value: PlatformFilter; label: string }> = [
  { value: "all", label: "全部平台" },
  { value: "windows", label: "Windows" },
  { value: "mac", label: "macOS" },
  { value: "linux", label: "Linux" },
];

/** 顶栏：标题 + 搜索 + 折扣/平台/排序筛选 + 刷新，始终固定在内容上方 */
export function TopBar({
  title,
  subtitle,
  query,
  onQuery,
  showSearch,
  refreshing,
  onRefresh,
  settings,
  watchOnly,
  onToggleWatchOnly,
  onChangeSettings,
}: TopBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const [sortOpen, setSortOpen] = useState(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "/" && !["INPUT", "TEXTAREA"].includes((event.target as HTMLElement)?.tagName)) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!sortOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!sortRef.current?.contains(event.target as Node)) setSortOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSortOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sortOpen]);

  return (
    <header className="topbar">
      <div className="topbar__title">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      {showSearch && (
        <div className="search">
          <Search size={15} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="搜索游戏名 / 标签"
            aria-label="搜索折扣"
            spellCheck={false}
          />
          <kbd>/</kbd>
        </div>
      )}

      {settings && (
        <div className="topbar__filters">
          <div className="select select--compact">
            <select
              value={settings.minDiscount}
              aria-label="折扣力度"
              title="折扣力度"
              onChange={(event) => onChangeSettings({ minDiscount: Number(event.target.value) })}
            >
              {DISCOUNT_STEPS.map((step) => (
                <option key={step.value} value={step.value}>
                  {step.label}
                </option>
              ))}
            </select>
            <ChevronDown size={12} />
          </div>

          <div className="select select--compact">
            <select
              value={settings.onlyPlatform}
              aria-label="平台筛选"
              onChange={(event) => onChangeSettings({ onlyPlatform: event.target.value as PlatformFilter })}
            >
              {PLATFORMS.map((platform) => (
                <option key={platform.value} value={platform.value}>
                  {platform.label}
                </option>
              ))}
            </select>
            <ChevronDown size={12} />
          </div>

          <button
            type="button"
            className={`chip chip--icon ${watchOnly ? "is-active" : ""}`}
            onClick={onToggleWatchOnly}
            aria-pressed={watchOnly}
            title="只看已关注"
          >
            <Star size={12} fill={watchOnly ? "currentColor" : "none"} />
            关注
          </button>
        </div>
      )}

      <div className="topbar__actions">
        {settings && (
          <div className="sortmenu" ref={sortRef}>
          <button
            type="button"
            className="btn btn--sm sortmenu__trigger"
            onClick={() => setSortOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={sortOpen}
            title="排序方式"
          >
            <ArrowUpDown size={14} />
            排序
            <b>{SORT_LABELS[settings.sort]}</b>
            {settings.sortDirection === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
          </button>

          {sortOpen && (
            <div className="sortmenu__panel" role="menu" aria-label="排序方式">
              <div className="sortmenu__dirs">
                <button
                  type="button"
                  className={settings.sortDirection === "asc" ? "is-active" : ""}
                  onClick={() => onChangeSettings({ sortDirection: "asc" })}
                >
                  <ArrowUp size={13} /> 升序
                </button>
                <button
                  type="button"
                  className={settings.sortDirection === "desc" ? "is-active" : ""}
                  onClick={() => onChangeSettings({ sortDirection: "desc" })}
                >
                  <ArrowDown size={13} /> 降序
                </button>
              </div>
              <div className="sortmenu__list">
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={settings.sort === key}
                    className={settings.sort === key ? "is-active" : ""}
                    onClick={() => {
                      onChangeSettings({ sort: key, sortDirection: DEFAULT_SORT_DIRECTION[key] });
                      setSortOpen(false);
                    }}
                  >
                    <span>{SORT_LABELS[key]}</span>
                    {settings.sort === key && <Check size={13} />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="icon-btn topbar__refresh"
        onClick={onRefresh}
        disabled={refreshing}
        title={refreshing ? "正在更新折扣…" : "立即从 Steam 拉取最新折扣"}
        aria-label="刷新折扣"
      >
        <RefreshCw size={16} className={refreshing ? "spin" : undefined} />
      </button>
      </div>
    </header>
  );
}
