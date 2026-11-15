import { describe, expect, it } from "vitest";
import {
  MAX_TRANSLATE_CHUNK,
  buildGoogleUrl,
  buildMyMemoryUrl,
  parseGoogleTranslate,
  parseMyMemory,
  splitForTranslation,
} from "../src/translate";
import { buildReviewsUrl } from "../src/steam";

describe("splitForTranslation", () => {
  it("短文本原样返回", () => {
    expect(splitForTranslation("很好玩")).toEqual(["很好玩"]);
    expect(splitForTranslation("   ")).toEqual([]);
  });

  it("长文本按句子切开且不超过上限", () => {
    const text = "This is a great game. ".repeat(80);
    const chunks = splitForTranslation(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_TRANSLATE_CHUNK);
    expect(chunks.join(" ")).toContain("This is a great game.");
  });

  it("中文长句按句号切分", () => {
    const text = "这个游戏很好玩。".repeat(60);
    const chunks = splitForTranslation(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_TRANSLATE_CHUNK);
  });
});

describe("parseMyMemory", () => {
  it("解析正常响应", () => {
    const body = JSON.stringify({
      responseStatus: 200,
      responseData: { translatedText: "这款游戏很棒，但优化很差。" },
    });
    expect(parseMyMemory(body)).toBe("这款游戏很棒，但优化很差。");
  });

  it("额度/长度错误与非法 JSON 返回 null", () => {
    expect(parseMyMemory(JSON.stringify({ responseStatus: "403", responseData: { translatedText: "QUERY LENGTH LIMIT EXCEEDED" } }))).toBeNull();
    expect(parseMyMemory(JSON.stringify({ responseStatus: 200, responseData: { translatedText: "" } }))).toBeNull();
    expect(parseMyMemory("<html>blocked</html>")).toBeNull();
  });
});

describe("parseGoogleTranslate", () => {
  it("拼接分段译文", () => {
    const body = JSON.stringify([[["这款游戏", "This game", null, null, 10], ["很棒。", "is great.", null, null, 10]], null, "en"]);
    expect(parseGoogleTranslate(body)).toBe("这款游戏很棒。");
    expect(parseGoogleTranslate("not json")).toBeNull();
  });
});

describe("翻译与评价 URL", () => {
  it("构造免费翻译接口地址", () => {
    expect(buildMyMemoryUrl("hello")).toContain("langpair=Autodetect%7Czh-CN");
    expect(buildMyMemoryUrl("hello")).toContain("q=hello");
    const google = buildGoogleUrl("hello");
    expect(google).toContain("client=gtx");
    expect(google).toContain("tl=zh-CN");
  });

  it("评价语言筛选参数", () => {
    expect(buildReviewsUrl(730, "schinese")).toContain("filterLanguage=schinese");
    expect(buildReviewsUrl(730, "english")).toContain("filterLanguage=english");
    expect(buildReviewsUrl(730)).not.toContain("filterLanguage");
    expect(buildReviewsUrl(730, "all")).not.toContain("filterLanguage");
  });
});
