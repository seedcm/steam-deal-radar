/**
 * 免费在线翻译（无需 API Key）。
 *
 * 主用 MyMemory：单次最多 500 字符，自动识别源语言，匿名有每日额度；
 * 备用 Google 的 gtx 接口（部分地区不可达）。
 * 长文本按句子/换行切成 <=450 字符的片段逐段翻译。
 */

export interface TranslationResult {
  text: string;
  engine: string;
}

export const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
export const GOOGLE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
export const MAX_TRANSLATE_CHUNK = 450;
export const MAX_TRANSLATE_CHUNKS = 8;

export function buildMyMemoryUrl(text: string, target = "zh-CN"): string {
  const params = new URLSearchParams({ q: text, langpair: `Autodetect|${target}` });
  return `${MYMEMORY_ENDPOINT}?${params.toString()}`;
}

export function buildGoogleUrl(text: string, target = "zh-CN"): string {
  const params = new URLSearchParams({ client: "gtx", sl: "auto", tl: target, dt: "t", q: text });
  return `${GOOGLE_ENDPOINT}?${params.toString()}`;
}

/** 按换行/句号切成不超过 limit 的片段，尽量不截断句子 */
export function splitForTranslation(text: string, limit = MAX_TRANSLATE_CHUNK): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let rest = normalized;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) {
      cut = Math.max(
        rest.lastIndexOf(". ", limit),
        rest.lastIndexOf("。", limit),
        rest.lastIndexOf("! ", limit),
        rest.lastIndexOf("? ", limit),
        rest.lastIndexOf("！", limit),
        rest.lastIndexOf("？", limit),
      );
    }
    if (cut < limit * 0.3) cut = limit;
    if (cut <= 0) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

export function parseMyMemory(body: string): string | null {
  try {
    const json = JSON.parse(body) as {
      responseStatus?: number | string;
      responseData?: { translatedText?: string };
      responseDetails?: string;
    };
    const status = Number(json.responseStatus);
    const text = json.responseData?.translatedText;
    if (status !== 200 || !text) return null;
    if (/QUERY LENGTH LIMIT|INVALID SOURCE LANGUAGE|MYMEMORY WARNING|ALL AVAILABLE FREE/i.test(text)) return null;
    return text.trim() || null;
  } catch {
    return null;
  }
}

export function parseGoogleTranslate(body: string): string | null {
  try {
    const json = JSON.parse(body) as unknown;
    if (!Array.isArray(json) || !Array.isArray((json as unknown[])[0])) return null;
    const text = ((json as unknown[])[0] as unknown[])
      .map((segment) => (Array.isArray(segment) && typeof segment[0] === "string" ? segment[0] : ""))
      .join("");
    return text.trim() || null;
  } catch {
    return null;
  }
}

/* ---------- 自定义翻译源 ---------- */

/** LibreTranslate 用两位语言码；zh-CN -> zh */
export function toLibreTarget(target: string): string {
  const lower = target.toLowerCase();
  if (lower.startsWith("zh")) return "zh";
  return lower.split("-")[0] ?? "en";
}

export function targetName(target: string): string {
  switch (target.toLowerCase()) {
    case "zh-cn":
    case "zh":
      return "简体中文";
    case "en":
      return "English";
    case "ja":
      return "日本語";
    case "ko":
      return "한국어";
    case "ru":
      return "Русский";
    case "fr":
      return "Français";
    case "de":
      return "Deutsch";
    case "es":
      return "Español";
    default:
      return target;
  }
}

export function buildLibreTranslateBody(text: string, target: string, apiKey?: string): string {
  const payload: Record<string, string> = {
    q: text,
    source: "auto",
    target: toLibreTarget(target),
    format: "text",
  };
  if (apiKey) payload.api_key = apiKey;
  return JSON.stringify(payload);
}

export function parseLibreTranslate(body: string): string | null {
  try {
    const json = JSON.parse(body) as { translatedText?: unknown };
    const text = typeof json.translatedText === "string" ? json.translatedText : "";
    return text.trim() || null;
  } catch {
    return null;
  }
}

/** 允许用户填 https://api.openai.com/v1 或完整的 /chat/completions 地址 */
export function normalizeOpenAIEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

export function buildOpenAIBody(text: string, target: string, model?: string): string {
  const chosen = model?.trim() || "gpt-4o-mini";
  return JSON.stringify({
    model: chosen,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You are a translation engine. Translate the user's text into ${targetName(target)}. Output only the translation, without explanations or quotes.`,
      },
      { role: "user", content: text },
    ],
  });
}

export function parseOpenAIResponse(body: string): string | null {
  try {
    const json = JSON.parse(body) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      error?: { message?: string };
    };
    if (json.error?.message) return null;
    const content = json.choices?.[0]?.message?.content;
    return typeof content === "string" ? content.trim() || null : null;
  } catch {
    return null;
  }
}
