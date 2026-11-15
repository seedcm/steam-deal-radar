import type { Settings } from "./types";

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP"]);

export const CURRENCY_BY_REGION: Record<string, string> = {
  cn: "CNY",
  hk: "HKD",
  tw: "TWD",
  us: "USD",
  jp: "JPY",
  de: "EUR",
  fr: "EUR",
  gb: "GBP",
  ru: "RUB",
  br: "BRL",
  kr: "KRW",
  ca: "CAD",
  au: "AUD",
  sg: "SGD",
  in: "INR",
  tr: "TRY",
  ar: "ARS",
  mx: "MXN",
  pl: "PLN",
  ua: "UAH",
};

export function regionCurrency(country: string): string {
  return CURRENCY_BY_REGION[country?.toLowerCase()] ?? "USD";
}

export function currencySymbol(currency: string): string {
  switch (currency) {
    case "CNY":
      return "¥";
    case "USD":
      return "$";
    case "EUR":
      return "€";
    case "GBP":
      return "£";
    case "JPY":
      return "¥";
    case "HKD":
      return "HK$";
    case "TWD":
      return "NT$";
    case "RUB":
      return "₽";
    case "BRL":
      return "R$";
    case "KRW":
      return "₩";
    default:
      return currency + " ";
  }
}

/** 金额以「分」存储 */
export function formatMoney(minor: number | undefined | null, currency: string): string {
  if (minor == null || !Number.isFinite(minor)) return "—";
  const value = minor / 100;
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${currencySymbol(currency)}${value.toFixed(digits)}`;
  }
}

/** 用于输入框展示：不带货币符号 */
export function moneyToInput(minor: number | undefined | null): string {
  if (minor == null || !Number.isFinite(minor)) return "";
  return (minor / 100).toFixed(2);
}

/** 解析用户输入的价格（元/当地货币），返回「分」 */
export function parseMoneyInput(text: string): number | undefined {
  const cleaned = text.replace(/[^\d.]/g, "").trim();
  if (!cleaned) return undefined;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100);
}

export function formatRelativeTime(timestamp: number | null | undefined, now = Date.now()): string {
  if (!timestamp) return "尚未更新";
  const diff = now - timestamp;
  if (diff < 0) return "刚刚";
  const minute = 60_000;
  if (diff < minute) return "刚刚";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
  return new Date(timestamp).toLocaleDateString("zh-CN");
}

export function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatCountdown(endsAt: number | undefined, now = Date.now()): string | null {
  if (!endsAt) return null;
  const diff = endsAt - now;
  if (diff <= 0) return null;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟后结束`;
  if (hours < 48) return `${hours} 小时后结束`;
  return `${Math.floor(hours / 24)} 天后结束`;
}

export function sanitizeSettings(patch: Partial<Settings>, current: Settings): Settings {
  const next: Settings = { ...current, ...patch, quietHours: { ...current.quietHours, ...(patch.quietHours ?? {}) } };
  next.refreshMinutes = clamp(Math.round(next.refreshMinutes || 60), 15, 24 * 60);
  next.fetchPages = clamp(Math.round(next.fetchPages || 3), 1, 6);
  next.minDiscount = clamp(Math.round(next.minDiscount ?? 0), 0, 95);
  next.notifyMinDiscount = clamp(Math.round(next.notifyMinDiscount ?? 25), 0, 95);
  next.quietHours.start = clamp(Math.round(next.quietHours.start ?? 23), 0, 23);
  next.quietHours.end = clamp(Math.round(next.quietHours.end ?? 8), 0, 23);
  if (next.language && next.country) {
    // 语言与区域解耦，允许用户手动指定
  }
  return next;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
