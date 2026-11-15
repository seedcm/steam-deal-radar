import { regionCurrency } from "./format";
import { buildNotification } from "./store";
import type { AppNotification, Settings, WatchEntry, WatchQuote } from "./types";

export const NOTIFY_COOLDOWN_MS = 12 * 3_600_000;
export const MAX_NOTIFICATIONS_PER_REFRESH = 5;

export function inQuietHours(quiet: Settings["quietHours"], now: number): boolean {
  if (!quiet.enabled) return false;
  const hour = new Date(now).getHours();
  const { start, end } = quiet;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export interface ReminderInput {
  watchlist: readonly WatchEntry[];
  quotes: Record<string, WatchQuote>;
  /** 本次更新前的历史最低价 */
  lowestBefore: Record<string, number>;
  settings: Settings;
  now: number;
}

/**
 * 纯函数：根据关注列表与最新报价，决定这一轮要弹出的提醒。
 * 优先级：目标价 > 新史低 > 达到折扣门槛；同类提醒 12 小时内同价去重。
 */
export function planNotifications(input: ReminderInput): AppNotification[] {
  const { watchlist, quotes, lowestBefore, settings, now } = input;
  if (!settings.notifyEnabled) return [];
  const currency = regionCurrency(settings.country);
  const quiet = inQuietHours(settings.quietHours, now);
  const planned: Array<{ inWatch: WatchEntry; quote: WatchQuote; kind: "target" | "newlow" | "sale" }> = [];

  for (const entry of watchlist) {
    const quote = quotes[String(entry.appId)];
    if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) continue;

    const samePrice = entry.lastNotified && entry.lastNotified.price === quote.price;
    if (samePrice && now - (entry.lastNotified?.at ?? 0) < NOTIFY_COOLDOWN_MS) continue;

    const hitTarget = entry.targetPrice != null && quote.price <= entry.targetPrice;
    const previousLow = lowestBefore[String(entry.appId)];
    const hitNewLow = settings.notifyNewLow && previousLow != null && quote.price < previousLow;
    const hitSale = entry.notifyAny && quote.discount >= settings.notifyMinDiscount;

    const kind = hitTarget ? "target" : hitNewLow ? "newlow" : hitSale ? "sale" : null;
    if (!kind) continue;
    if (quiet && kind !== "target") continue;

    planned.push({ inWatch: entry, quote, kind });
  }

  planned.sort((a, b) => b.quote.discount - a.quote.discount);

  return planned.slice(0, MAX_NOTIFICATIONS_PER_REFRESH).map(({ inWatch, quote, kind }) =>
    buildNotification(kind, inWatch, quote, {
      targetPrice: inWatch.targetPrice ?? undefined,
      previousLow: lowestBefore[String(inWatch.appId)],
      currency,
    }),
  );
}

/** 把提醒写回关注条目，用于后续去重 */
export function markNotified(entry: WatchEntry, notification: AppNotification, quote: WatchQuote, now: number): WatchEntry {
  return {
    ...entry,
    lastNotified: { price: quote.price, discount: quote.discount, at: now, kind: notification.kind },
  };
}
