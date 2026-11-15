import type { Deal } from "@radar/core";
import { SearchX, WifiOff } from "lucide-react";
import { DealCard } from "./DealCard";

interface DealGridProps {
  deals: Deal[];
  watchIds: Set<number>;
  lowIds: Set<number>;
  currency: string;
  loading: boolean;
  offline: boolean;
  onSelect: (deal: Deal) => void;
  onToggleWatch: (deal: Deal) => void;
  onRefresh: () => void;
}

export function DealGrid({ deals, watchIds, lowIds, currency, loading, offline, onSelect, onToggleWatch, onRefresh }: DealGridProps) {
  if (loading) {
    return (
      <div className="grid" aria-busy="true">
        {Array.from({ length: 12 }, (_, index) => (
          <div className="skeleton-card" key={index}>
            <div className="skeleton-card__media" />
            <div className="skeleton-card__body">
              <div className="skeleton-line" style={{ width: "82%" }} />
              <div className="skeleton-line" style={{ width: "54%" }} />
              <div className="skeleton-line" style={{ width: "38%", height: 16 }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (deals.length === 0) {
    return (
      <div className="empty">
        <div className="empty__icon">{offline ? <WifiOff size={26} /> : <SearchX size={26} />}</div>
        <h3>{offline ? "还没有可离线查看的数据" : "没有匹配的折扣"}</h3>
        <p>
          {offline
            ? "第一次使用需要联网抓取一次折扣列表，之后即使断网也能继续查看。"
            : "试试放宽折扣门槛、切换平台筛选，或者清空搜索关键词。"}
        </p>
        {offline && (
          <button type="button" className="btn btn--primary" onClick={onRefresh}>
            立即联网更新
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid">
      {deals.map((deal) => (
        <DealCard
          key={deal.appId}
          deal={deal}
          watched={watchIds.has(deal.appId)}
          isLow={lowIds.has(deal.appId)}
          currency={currency}
          onSelect={onSelect}
          onToggleWatch={onToggleWatch}
        />
      ))}
    </div>
  );
}
