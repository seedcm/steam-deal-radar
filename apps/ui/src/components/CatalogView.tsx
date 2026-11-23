import { useEffect, useRef, useState } from "react";
import type { Deal } from "@radar/core";
import { STORE_CATEGORIES, friendlyError } from "@radar/core";
import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/client";
import { DealCard } from "./DealCard";

interface CatalogViewProps {
  query: string;
  currency: string;
  watchIds: Set<number>;
  lowIds: Set<number>;
  onSelect: (deal: Deal) => void;
  onToggleWatch: (deal: Deal) => void;
  /** "all" = 全部游戏目录；"free" = 免费游戏 */
  variant?: "all" | "free";
  fx?: { home: string; rates?: Record<string, number> };
}

/** 全部游戏 / 免费游戏：Steam 商店目录，按好评排序，可搜索、按类别筛选 */
export function CatalogView({
  query,
  currency,
  watchIds,
  lowIds,
  onSelect,
  onToggleWatch,
  variant = "all",
  fx,
}: CatalogViewProps) {
  const [items, setItems] = useState<Deal[]>([]);
  const [page, setPage] = useState(0);
  const [category, setCategory] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  const categoryRef = useRef(category);
  categoryRef.current = category;

  const load = async (term: string, nextPage: number, replace: boolean, categoryNow: number) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.catalog(term, nextPage, {
        free: variant === "free",
        category: categoryNow || undefined,
      });
      if (requestId.current !== id) return;
      setItems((previous) => (replace ? result : [...previous, ...result]));
      setPage(nextPage);
    } catch (err) {
      if (requestId.current !== id) return;
      setError(friendlyError(err));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  };

  useEffect(() => {
    void load("", 0, true, 0);
  }, [variant]);

  // 顶栏搜索输入变化时，防抖后按关键词重新加载
  useEffect(() => {
    const timer = setTimeout(() => {
      void load(queryRef.current, 0, true, categoryRef.current);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const changeCategory = (value: number) => {
    setCategory(value);
    setItems([]);
    void load(queryRef.current, 0, true, value);
  };

  const title = variant === "free" ? "免费游戏" : "全部游戏";
  const subtitle = variant === "free" ? "免费开玩 · 按好评排序" : "完整目录（含非打折）· 按好评排序";

  return (
    <div className="catalog">
      <div className="section-head">
        <h2>{title}</h2>
        <span>{items.length} 个 · {subtitle}</span>
      </div>

      <div className="catalog__controls">
        <div className="select">
          <select
            value={category}
            aria-label="按类别筛选"
            onChange={(event) => changeCategory(Number(event.target.value))}
          >
            <option value={0}>全部类别</option>
            {STORE_CATEGORIES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </div>
        <span className="hint">
          {variant === "free"
            ? "Steam 商店的免费游戏；可用类别筛选或在上方搜索。"
            : "Steam 商店完整目录（不限于打折）；可选类别或搜索任意游戏。"}
        </span>
      </div>

      {error && (
        <div className="banner banner--error">
          <span className="banner__grow">{error}</span>
          <button type="button" className="btn btn--sm" onClick={() => void load(queryRef.current, 0, true, categoryRef.current)}>
            <RefreshCw size={12} /> 重试
          </button>
        </div>
      )}

      {items.length === 0 && loading && (
        <div className="empty">
          <Loader2 size={20} className="spin" />
          <h3>正在读取{title}…</h3>
        </div>
      )}

      {items.length === 0 && !loading && !error && (
        <div className="empty">
          <h3>没有找到游戏</h3>
          <p>换个类别或关键词试试。</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="grid">
          {items.map((deal) => (
            <DealCard
              key={deal.appId}
              deal={deal}
              watched={watchIds.has(deal.appId)}
              isLow={lowIds.has(deal.appId)}
              currency={currency}
              onSelect={() => onSelect(deal)}
              onToggleWatch={(item) => onToggleWatch(item)}
              fx={fx}
            />
          ))}
        </div>
      )}

      {items.length > 0 && !loading && (
        <button
          type="button"
          className="btn catalog__more"
          onClick={() => void load(queryRef.current, page + 1, false, categoryRef.current)}
        >
          加载更多
        </button>
      )}
      {loading && items.length > 0 && (
        <p className="hint catalog__loading">
          <Loader2 size={12} className="spin" /> 加载中…
        </p>
      )}
    </div>
  );
}
