import { useEffect, useMemo, useState } from "react";
import type { Deal, PricePoint, WatchEntry } from "@radar/core";
import { formatCountdown, formatMoney, moneyToInput, validateMoneyInput } from "@radar/core";
import { Bell, BellOff, Check, Clock, ExternalLink, MessageSquare, Star, Tag, TrendingDown, X } from "lucide-react";
import { api } from "../lib/client";
import { Img } from "./Img";
import { PlatformIcons, platformLabel } from "./PlatformIcons";
import { Sparkline } from "./Sparkline";
import { ReviewList } from "./ReviewList";

interface DetailPanelProps {
  deal: Deal;
  entry?: WatchEntry;
  currency: string;
  isLow: boolean;
  translationTarget?: string;
  translationProvider?: string;
  history: PricePoint[];
  onClose: () => void;
  onToggleWatch: (deal: Deal) => void;
  onSaveTarget: (appId: number, targetPrice?: number) => void;
  onSaveNote: (appId: number, note: string) => void;
  onNotifyAny: (appId: number, value: boolean) => void;
}

export function DetailPanel({
  deal,
  entry,
  currency,
  isLow,
  translationTarget,
  translationProvider,
  history,
  onClose,
  onToggleWatch,
  onSaveTarget,
  onSaveNote,
  onNotifyAny,
}: DetailPanelProps) {
  const [details, setDetails] = useState<Deal | null>(null);
  const [target, setTarget] = useState(moneyToInput(entry?.targetPrice));
  const [note, setNote] = useState(entry?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [showReviews, setShowReviews] = useState(false);

  useEffect(() => {
    setShowReviews(false);
  }, [deal.appId]);

  useEffect(() => {
    let alive = true;
    setDetails(null);
    api
      .details(deal.appId)
      .then((value) => alive && value && setDetails(value))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [deal.appId]);

  useEffect(() => {
    setTarget(moneyToInput(entry?.targetPrice));
    setTargetError(null);
    setNote(entry?.note ?? "");
  }, [entry?.targetPrice, entry?.note, deal.appId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, note, entry, deal.appId]);

  const finalText = deal.finalPriceText ?? formatMoney(deal.finalPrice, deal.currency ?? currency);
  const originalText = deal.originalPriceText ?? formatMoney(deal.originalPrice, deal.currency ?? currency);
  const countdown = formatCountdown(deal.discountEndsAt);
  const description = details?.description ?? deal.description;
  const developers = details?.developers ?? deal.developers;
  const discount = deal.discountPercent || details?.discountPercent || 0;

  const historyStats = useMemo(() => {
    if (history.length === 0) return null;
    const prices = history.map((point) => point.price);
    return { min: Math.min(...prices), max: Math.max(...prices), count: history.length };
  }, [history]);

  const flushNote = () => {
    if (note !== (entry?.note ?? "") && (entry || note.trim())) onSaveNote(deal.appId, note);
  };

  const closePanel = () => {
    flushNote();
    onClose();
  };

  const saveTarget = () => {
    const result = validateMoneyInput(target);
    if (!result.ok) {
      setTargetError(result.message);
      return;
    }
    setTargetError(null);
    if (!entry) {
      onSaveTarget(deal.appId, result.cents);
      return;
    }
    setSaving(true);
    onSaveTarget(deal.appId, result.cents);
    setTimeout(() => setSaving(false), 400);
  };

  return (
    <>
      <div className="scrim" onClick={closePanel} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${deal.name} 详情`}>
        <div className="drawer__hero">
          <Img src={deal.image ?? details?.image} alt={deal.name} />
          <button type="button" className="icon-btn drawer__close" onClick={closePanel} aria-label="关闭">
            <X size={17} />
          </button>
        </div>

        <div className="drawer__body">
          <h2 className="drawer__title">{deal.name}</h2>
          <div className="drawer__meta">
            <PlatformIcons platforms={deal.platforms} />
            <span>{platformLabel(deal.platforms)}</span>
            {deal.releaseDate && (
              <>
                <span className="dot" />
                <span>{deal.releaseDate}</span>
              </>
            )}
            {deal.reviewSummary && (
              <>
                <span className="dot" />
                <span>
                  {deal.reviewSummary}
                  {typeof deal.reviewPercent === "number" ? ` · ${deal.reviewPercent}%` : ""}
                </span>
              </>
            )}
          </div>
          {developers && developers.length > 0 && <div className="drawer__meta">{developers.join(" · ")}</div>}

          <div className="deal-box">
            <div className="deal-box__pct">{discount > 0 ? `−${discount}%` : "原价"}</div>
            <div className="deal-box__price">
              <span className="deal-box__final">{finalText}</span>
              <span className="deal-box__sub">
                {discount > 0 ? `原价 ${originalText}` : "当前没有折扣"}
                {countdown ? ` · ${countdown}` : ""}
              </span>
            </div>
            <div className="deal-box__grow" />
            {isLow && (
              <span className="tag-low" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 7px" }}>
                <TrendingDown size={12} /> 史低
              </span>
            )}
          </div>

          <div className="drawer__actions">
            <button type="button" className={`btn ${entry ? "" : "btn--primary"}`} onClick={() => onToggleWatch(deal)}>
              <Star size={14} fill={entry ? "currentColor" : "none"} />
              {entry ? "已关注 · 取消" : "加入关注"}
            </button>
            <button type="button" className="btn" onClick={() => void api.openStore(deal.appId)}>
              <ExternalLink size={14} />
              在 Steam 打开
            </button>
            <button
              type="button"
              className={`btn ${showReviews ? "btn--primary" : ""}`}
              aria-expanded={showReviews}
              onClick={() => setShowReviews((value) => !value)}
            >
              <MessageSquare size={14} />
              {showReviews ? "收起评价" : "查看评价详情"}
            </button>
          </div>

          {showReviews && (
            <ReviewList
              appId={deal.appId}
              summary={deal.reviewSummary}
              reviewPercent={deal.reviewPercent}
              defaultTarget={translationTarget}
              translationProvider={translationProvider}
            />
          )}

          <div className="field-block">
            <div className="field-block__label">
              <span>
                目标价 <b>{entry?.targetPrice != null ? formatMoney(entry.targetPrice, currency) : "未设置"}</b>
              </span>
              <span className="hint">低于或等于该价格时优先提醒</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                inputMode="decimal"
                placeholder="例如 99"
                value={target}
                aria-invalid={Boolean(targetError)}
                className={`number-input ${targetError ? "is-error" : ""}`}
                onChange={(event) => {
                  setTarget(event.target.value);
                  if (targetError) setTargetError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveTarget();
                }}
                onBlur={() => {
                  if (target !== moneyToInput(entry?.targetPrice)) saveTarget();
                }}
                aria-label="目标价格"
              />
              <button type="button" className="btn btn--sm" onClick={saveTarget} disabled={saving}>
                {saving ? <Check size={13} /> : <Tag size={13} />}
                保存
              </button>
            </div>
            {targetError && <p className="hint hint--error">{targetError}</p>}
            <p className="hint" style={{ marginTop: 8 }}>
              以 {currency} 计价，保留两位小数。未关注时保存目标价会自动加入关注列表。
            </p>
          </div>

          {entry && (
            <div className="field-block">
              <div className="field-block__label">
                <span>提醒方式</span>
                <span className="hint">{entry.notifyAny ? "任意折扣都提醒" : "只在达到折扣门槛时提醒"}</span>
              </div>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => onNotifyAny(deal.appId, !entry.notifyAny)}
                style={{ width: "100%" }}
              >
                {entry.notifyAny ? <Bell size={13} /> : <BellOff size={13} />}
                {entry.notifyAny ? "已开启任意折扣提醒" : "仅按折扣门槛提醒"}
              </button>
            </div>
          )}

          <div className="field-block">
            <div className="field-block__label">
              <span>备注</span>
              <span className="hint">{entry ? "只保存在本地" : "保存备注会自动加入关注"}</span>
            </div>
            <textarea
              className="note-input"
              placeholder="比如：等 50% 以下、和朋友一起买……"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onBlur={flushNote}
            />
          </div>

          <div className="history">
            <div className="history__head">
              <span>本地价格记录</span>
              <span>
                {historyStats ? (
                  <>
                    最低 <b>{formatMoney(historyStats.min, currency)}</b> · 共 {historyStats.count} 次
                  </>
                ) : (
                  "暂无记录"
                )}
              </span>
            </div>
            <Sparkline points={history} />
          </div>

          {description && (
            <div className="desc">
              <h3>关于这款游戏</h3>
              <p>{description}</p>
            </div>
          )}

          <div className="drawer__meta" style={{ marginTop: 18, opacity: 0.7 }}>
            <Clock size={12} />
            <span>价格数据来自 Steam 商店，可能因区域而异</span>
          </div>
        </div>
      </aside>
    </>
  );
}
