import { ArrowDown, ArrowUp, RefreshCw, Search, Star } from "lucide-react";
import { useEffect, useRef } from "react";
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

const SORT_SHORT: Record<SortKey, string> = {
  discount: "折扣",
  price: "折扣价",
  originalPrice: "原价",
  name: "名称",
  review: "好评率",
};

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

          <div className="select select--compact">
            <select
              value={settings.sort}
              aria-label="排序方式"
              title={SORT_LABELS[settings.sort]}
              onChange={(event) => {
                const sort = event.target.value as SortKey;
                onChangeSettings({ sort, sortDirection: DEFAULT_SORT_DIRECTION[sort] });
              }}
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_SHORT[key]}
                </option>
              ))}
            </select>
            <ChevronDown size={12} />
          </div>

          <button
            type="button"
            className="icon-btn topbar__sortdir"
            title={settings.sortDirection === "asc" ? "升序（点击切换为降序）" : "降序（点击切换为升序）"}
            aria-label={settings.sortDirection === "asc" ? "升序，点击切换为降序" : "降序，点击切换为升序"}
            onClick={() =>
              onChangeSettings({ sortDirection: settings.sortDirection === "asc" ? "desc" : "asc" })
            }
          >
            {settings.sortDirection === "asc" ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
          </button>

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
    </header>
  );
}
