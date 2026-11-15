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
