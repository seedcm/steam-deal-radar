import { ArrowDown, ArrowUp, ArrowUpDown, BookOpen, Check, ExternalLink, Gift, Heart, RefreshCw, Search, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LibraryGame, PlatformFilter, Settings, SortKey, SteamAccount, WishlistItem } from "@radar/core";
import { DEFAULT_SORT_DIRECTION, REGIONS, SORT_LABELS, STORE_CATEGORIES } from "@radar/core";
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
  /** 切换查看区域（会触发该区域的折扣刷新） */
  onRegionChange?: (code: string) => void;
  /** 是否显示折扣筛选（折扣力度/平台/只看关注/排序），全部游戏页不需要 */
  showDealFilters?: boolean;
  /** 只看免费游戏 */
  freeMode?: boolean;
  onToggleFreeMode?: () => void;
  /** 全局类别筛选（0 = 全部类别） */
  category?: number;
  onCategoryChange?: (id: number) => void;
  /** 登录后的游戏库/愿望单菜单 */
  steamAccount?: SteamAccount | null;
  library?: LibraryGame[];
  wishlist?: WishlistItem[];
  watchIds?: Set<number>;
  onOpenStore?: (appId: number) => void;
  onWatchWishlist?: (item: WishlistItem) => void;
  onRefreshMarks?: () => void;
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
  onRegionChange,
  showDealFilters = true,
  freeMode = false,
  onToggleFreeMode,
  category = 0,
  onCategoryChange,
  steamAccount,
  library = [],
  wishlist = [],
  watchIds,
  onOpenStore,
  onWatchWishlist,
  onRefreshMarks,
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

      {settings && onCategoryChange && (
        <div className="select select--compact" title="按类别筛选（对所有页面生效）">
          <select
            value={category}
            aria-label="按类别筛选"
            onChange={(event) => onCategoryChange(Number(event.target.value))}
          >
            <option value={0}>全部类别</option>
            {STORE_CATEGORIES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <ChevronDown size={12} />
        </div>
      )}

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
              value={settings.country}
              aria-label="查看区域"
              title="选择要查看折扣的区域（切换后自动刷新）"
              onChange={(event) => {
                const code = event.target.value;
                if (onRegionChange) onRegionChange(code);
                else onChangeSettings({ country: code });
              }}
            >
              {REGIONS.map((region) => (
                <option key={region.code} value={region.code}>
                  {region.label}
                </option>
              ))}
            </select>
            <ChevronDown size={12} />
          </div>

          {showDealFilters && (
            <>
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

          <button
            type="button"
            className={`chip chip--icon ${freeMode ? "is-active" : ""}`}
            onClick={onToggleFreeMode}
            aria-pressed={freeMode}
            title="只看免费游戏"
          >
            <Gift size={12} />
            免费
          </button>

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
            </>
          )}
        </div>
      )}

      <div className="topbar__actions">
        {steamAccount && (
          <SteamListMenus
            account={steamAccount}
            library={library}
            wishlist={wishlist}
            watchIds={watchIds ?? new Set()}
            onOpenStore={onOpenStore ?? (() => {})}
            onWatchWishlist={onWatchWishlist ?? (() => {})}
            onRefresh={onRefreshMarks ?? (() => {})}
          />
        )}

        {settings && showDealFilters && (
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


function SteamListMenus({
  library,
  wishlist,
  watchIds,
  onOpenStore,
  onWatchWishlist,
  onRefresh,
}: {
  account: SteamAccount;
  library: LibraryGame[];
  wishlist: WishlistItem[];
  watchIds: Set<number>;
  onOpenStore: (appId: number) => void;
  onWatchWishlist: (item: WishlistItem) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState<"library" | "wishlist" | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const list = open === "library" ? library : wishlist;

  return (
    <div className="steam-menus" ref={ref}>
      <button
        type="button"
        className="btn btn--sm"
        aria-expanded={open === "library"}
        onClick={() => setOpen((value) => (value === "library" ? null : "library"))}
      >
        <BookOpen size={13} /> 游戏库 <em className="steam-menus__count">{library.length}</em>
      </button>
      <button
        type="button"
        className="btn btn--sm"
        aria-expanded={open === "wishlist"}
        onClick={() => setOpen((value) => (value === "wishlist" ? null : "wishlist"))}
      >
        <Heart size={13} /> 愿望单 <em className="steam-menus__count">{wishlist.length}</em>
      </button>

      {open && (
        <div className="steam-menus__panel" role="menu">
          <div className="steam-menus__head">
            <b>{open === "library" ? "我的游戏库" : "我的愿望单"}</b>
            <button type="button" className="btn btn--sm" onClick={onRefresh} title="刷新列表与收藏/购物车标记">
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="steam-menus__list">
            {list.length === 0 && <p className="hint">暂无数据；若隐私设置为私密，请先公开对应内容再刷新。</p>}
            {list.slice(0, 60).map((item) => {
              const watched = watchIds.has(item.appId);
              return (
                <div className="steam-menu-row" key={item.appId}>
                  <img
                    className="steam-menu-row__thumb"
                    src={(item as WishlistItem).capsule ?? (item as LibraryGame).logo}
                    alt={item.name}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                  <span className="steam-menu-row__name" title={item.name}>
                    {item.name}
                  </span>
                  {open === "wishlist" && (
                    <button
                      type="button"
                      className={`icon-btn icon-btn--bare ${watched ? "is-active" : ""}`}
                      title={watched ? "已在关注列表" : "加入关注"}
                      onClick={() => onWatchWishlist(item as WishlistItem)}
                    >
                      <Star size={13} fill={watched ? "currentColor" : "none"} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn icon-btn--bare"
                    title="在 Steam 打开"
                    onClick={() => onOpenStore(item.appId)}
                  >
                    <ExternalLink size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
