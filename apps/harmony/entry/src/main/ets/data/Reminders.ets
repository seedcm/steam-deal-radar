/**
 * 提醒规则，逐条对应 packages/core/src/reminders.ts：
 * - 优先级：目标价 > 新史低 > 折扣门槛；
 * - 同一关注项 12 小时内同价不重复提醒；
 * - 静默时段内只放行「目标价」提醒；
 * - 单轮最多 5 条，按折扣力度从高到低排序。
 */

import {
  AppNotification,
  buildNotification,
  QuietHours,
  regionCurrency,
  Settings,
  WatchEntry,
  WatchQuote
} from './Types';

export const NOTIFY_COOLDOWN_MS: number = 12 * 3_600_000;
export const MAX_NOTIFICATIONS_PER_REFRESH: number = 5;

export function inQuietHours(quiet: QuietHours, now: number): boolean {
  if (!quiet.enabled) {
    return false;
  }
  const hour = new Date(now).getHours();
  const start = quiet.start;
  const end = quiet.end;
  if (start === end) {
    return false;
  }
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

interface PlannedNotification {
  entry: WatchEntry;
  quote: WatchQuote;
  kind: 'target' | 'newlow' | 'sale';
}

/**
 * 纯函数：根据关注列表与最新报价，决定这一轮要弹出的提醒。
 * 调用前 lowestBefore 必须是「本轮 recordPrice 之前」的历史最低价快照。
 */
export function planNotifications(
  watchlist: WatchEntry[],
  quotes: Record<string, WatchQuote>,
  lowestBefore: Record<string, number>,
  settings: Settings,
  now: number
): AppNotification[] {
  const result: AppNotification[] = [];
  if (!settings.notifyEnabled) {
    return result;
  }

  const currency = regionCurrency(settings.country);
  const quiet = inQuietHours(settings.quietHours, now);
  const planned: PlannedNotification[] = [];

  for (const entry of watchlist) {
    const quote = quotes[String(entry.appId)];
    if (quote === undefined || !Number.isFinite(quote.price) || quote.price <= 0) {
      continue;
    }

    const lastNotified = entry.lastNotified;
    const samePrice = lastNotified !== undefined && lastNotified.price === quote.price;
    const lastAt = lastNotified !== undefined ? lastNotified.at : 0;
    if (samePrice && now - lastAt < NOTIFY_COOLDOWN_MS) {
      continue;
    }

    const target = entry.targetPrice;
    const hitTarget = target !== undefined && target !== null && quote.price <= target;
    const previousLow = lowestBefore[String(entry.appId)];
    const hitNewLow = settings.notifyNewLow && previousLow !== undefined && quote.price < previousLow;
    const hitSale = entry.notifyAny && quote.discount >= settings.notifyMinDiscount;

    let kind: 'target' | 'newlow' | 'sale' | null = null;
    if (hitTarget) {
      kind = 'target';
    } else if (hitNewLow) {
      kind = 'newlow';
    } else if (hitSale) {
      kind = 'sale';
    }
    if (kind === null) {
      continue;
    }
    // 静默时段内仅保留目标价提醒
    if (quiet && kind !== 'target') {
      continue;
    }

    const item: PlannedNotification = { entry: entry, quote: quote, kind: kind };
    planned.push(item);
  }

  planned.sort((a: PlannedNotification, b: PlannedNotification): number => b.quote.discount - a.quote.discount);

  const limit = Math.min(planned.length, MAX_NOTIFICATIONS_PER_REFRESH);
  for (let i = 0; i < limit; i++) {
    const item = planned[i];
    if (item === undefined) {
      continue;
    }
    const notification = buildNotification(
      item.kind,
      item.entry,
      item.quote,
      item.entry.targetPrice,
      lowestBefore[String(item.entry.appId)],
      currency
    );
    result.push(notification);
  }
  return result;
}
