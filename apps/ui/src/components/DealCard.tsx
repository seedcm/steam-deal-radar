import type { Deal } from "@radar/core";
import { formatCountdown, formatMoney } from "@radar/core";
import { Star, ThumbsUp } from "lucide-react";
import { Img } from "./Img";
import { PlatformIcons } from "./PlatformIcons";

interface DealCardProps {
  deal: Deal;
  watched: boolean;
  isLow: boolean;
  currency: string;
  onSelect: (deal: Deal) => void;
  onToggleWatch: (deal: Deal) => void;
}

export function DealCard({ deal, watched, isLow, currency, onSelect, onToggleWatch }: DealCardProps) {
  const finalText = deal.finalPriceText ?? formatMoney(deal.finalPrice, deal.currency ?? currency);
  const originalText = deal.originalPriceText ?? formatMoney(deal.originalPrice, deal.currency ?? currency);
  const countdown = formatCountdown(deal.discountEndsAt);
  const discounted = deal.discountPercent > 0;

  return (
    <div
      className={`card ${watched ? "is-watched" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(deal)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(deal);
        }
      }}
      aria-label={discounted ? `${deal.name}，折扣 ${deal.discountPercent}%` : deal.name}
    >
      <div className="card__media">
        <Img src={deal.image} alt={deal.name} />
        {discounted && <span className="badge">−{deal.discountPercent}%</span>}
        <button
          type="button"
          className={`star ${watched ? "is-on" : ""}`}
          aria-label={watched ? "取消关注" : "加入关注"}
          aria-pressed={watched}
          onClick={(event) => {
            event.stopPropagation();
            onToggleWatch(deal);
          }}
        >
          <Star size={15} fill={watched ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="card__body">
        <div className="card__name" title={deal.name}>
          {deal.name}
        </div>

        <div className="card__meta">
          {typeof deal.reviewPercent === "number" && (
            <span className="review" title={deal.reviewSummary}>
              <ThumbsUp size={11} />
              <b>{deal.reviewPercent}%</b>
            </span>
          )}
          <PlatformIcons platforms={deal.platforms} />
          {countdown && (
            <>
              <span className="dot" />
              <span className="tag-soon">{countdown}</span>
            </>
          )}
        </div>

        <div className="price-row">
          <span className={`price ${isLow ? "price--low" : ""}`}>{finalText}</span>
          {discounted && <span className="price-old">{originalText}</span>}
          {isLow && <span className="tag-low">史低</span>}
        </div>
      </div>
    </div>
  );
}
