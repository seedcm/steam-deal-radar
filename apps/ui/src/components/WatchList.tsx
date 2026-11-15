import { useMemo } from "react";
import type { Deal, WatchEntry, WatchQuote } from "@radar/core";
import { formatMoney, formatRelativeTime } from "@radar/core";
import { Bell, BellOff, ExternalLink, Star, StarOff } from "lucide-react";
import { Img } from "./Img";
import { PlatformIcons } from "./PlatformIcons";

interface WatchListProps {
  watchlist: WatchEntry[];
  quotes: Record<string, WatchQuote>;
  deals: Deal[];
  currency: string;
  onSelect: (deal: Deal) => void;
  onRemove: (appId: number) => void;
  onTarget: (appId: number, value: string) => void;
  onNotifyAny: (appId: number, value: boolean) => void;
  onOpenStore: (appId: number) => void;
  onRefresh: () => void;
}

function dealFromQuote(entry: WatchEntry, quote?: WatchQuote): Deal {
  return {
    appId: entry.appId,
    name: quote?.name ?? entry.name,
    image: quote?.image ?? entry.image,
    discountPercent: quote?.discount ?? 0,
    originalPrice: quote?.originalPrice,
    finalPrice: quote?.price,
    finalPriceText: quote?.priceText,
    platforms: { windows: true, mac: false, linux: false },
    storeUrl: quote?.storeUrl ?? `https://store.steampowered.com/app/${entry.appId}`,
  };
}

export function WatchList({
  watchlist,
  quotes,
  deals,
  currency,
  onSelect,
  onRemove,
  onTarget,
  onNotifyAny,
  onOpenStore,
  onRefresh,
}: WatchListProps) {
  const dealById = useMemo(() => new Map(deals.map((deal) => [deal.appId, deal])), [deals]);

  const rows = useMemo(() => {
    return watchlist
      .map((entry) => {
        const quote = quotes[String(entry.appId)];
        const deal = dealById.get(entry.appId);
        return {
          entry,
          quote,
          deal: deal ?? dealFromQuote(entry, quote),
          synced: Boolean(quote || deal),
          discount: quote?.discount ?? deal?.discountPercent ?? 0,
          seenAt: quote?.at ?? entry.lastSeen?.at,
        };
      })
      .sort((a, b) => b.discount - a.discount || a.entry.name.localeCompare(b.entry.name, "zh-Hans-CN"));
  }, [watchlist, quotes, dealById]);

  if (rows.length === 0) {
    return (
      <div className="empty">
        <div className="empty__icon">
          <Star size={26} />
        </div>
        <h3>关注列表还是空的</h3>
        <p>在折扣卡片右上角点一下星标，游戏就会进到这里。之后一到目标价，系统通知会提醒你。</p>
        <button type="button" className="btn" onClick={onRefresh}>
          先去刷一批折扣
        </button>
      </div>
    );
  }

  const onSale = rows.filter((row) => row.discount > 0);
  const others = rows.filter((row) => row.discount === 0);

  const renderRow = (row: (typeof rows)[number]) => {
    const { entry, quote, deal, discount, seenAt, synced } = row;
    const finalText = quote?.priceText ?? formatMoney(quote?.price ?? deal.finalPrice, currency);
    const originalText = formatMoney(quote?.originalPrice ?? deal.originalPrice, currency);
    return (
      <div className="watch-row" key={entry.appId}>
        <button type="button" className="watch-row__thumb" onClick={() => onSelect(deal)} aria-label={`查看 ${deal.name}`}>
          <Img src={deal.image} alt={deal.name} />
        </button>

        <div className="watch-row__info">
          <div className="watch-row__name" title={deal.name}>
            {deal.name}
          </div>
          <div className="watch-row__sub">
            <PlatformIcons platforms={deal.platforms} />
            {discount > 0 ? <span>−{discount}%</span> : <span>{synced ? "暂无折扣" : "价格待同步"}</span>}
            {seenAt && (
              <>
                <span className="dot" />
                <span>{formatRelativeTime(seenAt)}更新</span>
              </>
            )}
            {entry.targetPrice != null && (
              <>
                <span className="dot" />
                <span>目标 {formatMoney(entry.targetPrice, currency)}</span>
              </>
            )}
          </div>
          {entry.note && <div className="watch-row__note">“{entry.note}”</div>}
        </div>

        <div className="watch-row__price">
          <span className={`price ${discount >= 50 ? "price--low" : ""}`} style={{ fontSize: 15 }}>
            {discount > 0 ? finalText : "—"}
          </span>
          {discount > 0 && <span className="price-old">{originalText}</span>}
        </div>

        <div className="watch-row__actions">
          <label className="target-input" title="设置目标价（回车保存）">
            <span>{currency === "CNY" ? "¥" : currency}</span>
            <input
              defaultValue={entry.targetPrice != null ? (entry.targetPrice / 100).toFixed(0) : ""}
              placeholder="目标价"
              inputMode="decimal"
              aria-label="目标价"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onTarget(entry.appId, (event.target as HTMLInputElement).value);
                  (event.target as HTMLInputElement).blur();
                }
              }}
              onBlur={(event) => {
                if (event.target.value !== (entry.targetPrice != null ? (entry.targetPrice / 100).toFixed(0) : "")) {
                  onTarget(entry.appId, event.target.value);
                }
              }}
            />
          </label>

          <button
            type="button"
            className="icon-btn icon-btn--bare"
            title={entry.notifyAny ? "任意折扣都提醒（点击关闭）" : "只在达到折扣门槛时提醒（点击开启）"}
            onClick={() => onNotifyAny(entry.appId, !entry.notifyAny)}
            aria-pressed={entry.notifyAny}
          >
            {entry.notifyAny ? <Bell size={15} /> : <BellOff size={15} />}
          </button>

          <button type="button" className="icon-btn icon-btn--bare" title="在 Steam 打开" onClick={() => onOpenStore(entry.appId)}>
            <ExternalLink size={15} />
          </button>

          <button type="button" className="icon-btn icon-btn--bare" title="取消关注" onClick={() => onRemove(entry.appId)}>
            <StarOff size={15} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div>
      {onSale.length > 0 && (
        <>
          <div className="section-head">
            <h2>正在打折</h2>
            <span>{onSale.length} 个</span>
          </div>
          <div className="watch-list">{onSale.map(renderRow)}</div>
        </>
      )}
      {others.length > 0 && (
        <>
          <div className="section-head">
            <h2>暂无折扣</h2>
            <span>{others.length} 个 · 会继续帮你盯着</span>
          </div>
          <div className="watch-list">{others.map(renderRow)}</div>
        </>
      )}
    </div>
  );
}
