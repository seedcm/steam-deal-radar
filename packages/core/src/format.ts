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

/** 严格校验价格输入：空=清除；负数/乱填返回错误，不做静默修正 */
export function validateMoneyInput(text: string): { ok: true; cents?: number } | { ok: false; message: string } {
  const trimmed = text.trim().replace(/,/g, "");
  if (!trimmed) return { ok: true, cents: undefined };
  if (trimmed.startsWith("-")) return { ok: false, message: "目标价不能为负数" };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, message: "请输入有效金额，最多两位小数（例如 99.99）" };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, message: "请输入有效金额" };
  if (value > 1_000_000) return { ok: false, message: "金额过大，请检查是否输入有误" };
  return { ok: true, cents: Math.round(value * 100) };
}

/** 把网络/接口错误转成用户能看懂的中文 */
export function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (!raw) return "网络请求失败，请检查网络或代理后重试";
  if (/[\u4e00-\u9fa5]/.test(raw)) return raw;
  const text = raw.toLowerCase();
  if (text.includes("fetch failed") || text.includes("failed to fetch") || text.includes("networkerror")) {
    return "网络请求失败，请检查网络或代理后重试";
  }
  if (text.includes("err_name_not_resolved") || text.includes("enotfound")) {
    return "域名解析失败，请检查网络或代理设置";
  }
  if (text.includes("err_proxy") || text.includes("proxy connection")) {
    return "代理连接失败，请检查代理是否开启、端口是否正确";
  }
  if (text.includes("err_internet_disconnected") || text.includes("offline")) {
    return "当前网络不可用，请检查网络连接";
  }
  if (text.includes("timeout") || text.includes("timed out") || text.includes("aborted")) {
    return "请求超时，请稍后重试";
  }
  if (text.includes("cert") || text.includes("certificate")) {
    return "证书校验失败；若使用本地加速工具，可在「设置 → 网络」开启「允许自签名证书」";
  }
  if (text.includes("http 429")) return "请求过于频繁，请稍后再试";
  if (text.includes("http 403")) return "Steam 拒绝了请求（HTTP 403），可尝试更换代理节点";
  const http = raw.match(/http\s+(\d{3})/i);
  if (http) return `Steam 返回 HTTP ${http[1]}，请稍后重试`;
  return "网络请求失败，请检查网络或代理后重试";
}

/** 把「分」按汇率换算成目标货币；rates 为 { 币种: 兑 1 USD 的汇率 } */
export function convertMoney(
  cents: number | undefined | null,
  from: string,
  to: string,
  rates?: Record<string, number>,
): number | null {
  if (cents == null || !rates || !from || !to || from === to) return null;
  const fromRate = rates[from];
  const toRate = rates[to];
  if (!fromRate || !toRate) return null;
  return Math.round((cents / fromRate) * toRate);
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
  if (!["builtin", "libretranslate", "openai"].includes(next.translationProvider)) next.translationProvider = "builtin";
  next.translationEndpoint = String(next.translationEndpoint ?? "").trim();
  next.translationApiKey = String(next.translationApiKey ?? "").trim();
  next.translationModel = String(next.translationModel ?? "").trim();
  next.translationTarget = String(next.translationTarget || "zh-CN").trim();
  if (next.sortDirection !== "asc" && next.sortDirection !== "desc") next.sortDirection = "desc";
  next.uiScale = Number(next.uiScale ?? 0);
  if (!Number.isFinite(next.uiScale) || next.uiScale < 0) next.uiScale = 0;
  if (next.uiScale > 0) next.uiScale = clamp(next.uiScale, 0.8, 1.8);
  next.allowInsecureCert = Boolean(next.allowInsecureCert);
  if (!["system", "direct", "manual"].includes(next.proxyMode)) next.proxyMode = "system";
  next.homeCurrency = String(next.homeCurrency || "CNY").toUpperCase().slice(0, 3) || "CNY";
  next.proxyRules = String(next.proxyRules ?? "").trim();
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
