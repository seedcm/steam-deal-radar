import { useEffect, useRef, useState } from "react";
import type { Deal } from "@radar/core";
import { friendlyError } from "@radar/core";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/client";
import { DealCard } from "./DealCard";

interface CatalogViewProps {
  query: string;
  currency: string;
  watchIds: Set<number>;
  lowIds: Set<number>;
  onSelect: (deal: Deal) => void;
  onToggleWatch: (deal: Deal) => void;
}

/** 全部游戏（含非打折）：Steam 商店搜索结果，specials=0，按好评排序，可搜索 */
export function CatalogView({ query, currency, watchIds, lowIds, onSelect, onToggleWatch }: CatalogViewProps) {
  const [items, setItems] = useState<Deal[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = async (term: string, nextPage: number, replace: boolean) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.catalog(term, nextPage);
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
    void load("", 0, true);
  }, []);

  // 顶栏搜索输入变化时，防抖后按关键词重新加载
  useEffect(() => {
    const timer = setTimeout(() => {
      void load(query, 0, true);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="catalog">
      <div className="section-head">
        <h2>全部游戏</h2>
        <span>{items.length} 个 · 按好评排序 · 含非打折</span>
      </div>

      <p className="hint" style={{ margin: "0 0 12px" }}>
        这里列出 Steam 商店的完整游戏目录（不限于打折）；在上方搜索框输入名称即可查找任意游戏，点击卡片可查看详情并关注。
      </p>

      {error && (
        <div className="banner banner--error">
          <span className="banner__grow">{error}</span>
          <button type="button" className="btn btn--sm" onClick={() => void load(query, 0, true)}>
            <RefreshCw size={12} /> 重试
          </button>
        </div>
      )}

      {items.length === 0 && loading && (
        <div className="empty">
          <Loader2 size={20} className="spin" />
          <h3>正在读取全部游戏…</h3>
        </div>
      )}

      {items.length === 0 && !loading && !error && (
        <div className="empty">
          <h3>没有找到游戏</h3>
          <p>换个关键词试试，或清空搜索查看热门游戏。</p>
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
            />
          ))}
        </div>
      )}

      {items.length > 0 && !loading && (
        <button
          type="button"
          className="btn catalog__more"
          onClick={() => void load(query, page + 1, false)}
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
