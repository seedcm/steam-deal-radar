import { describe, expect, it } from "vitest";
import { RadarService } from "../src/service";
import { RadarStore } from "../src/store";
import type { HttpClient, StorageAdapter } from "../src/types";

class MemoryAdapter implements StorageAdapter {
  data: string | null = null;
  async read() {
    return this.data;
  }
  async write(value: string) {
    this.data = value;
  }
}

interface Captured {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

function makeService(handler: (url: string, init?: Captured["init"]) => string) {
  const captured: Captured[] = [];
  const http: HttpClient = async (url, init) => {
    captured.push({ url, init });
    return handler(url, init);
  };
  const store = new RadarStore(new MemoryAdapter());
  const service = new RadarService({ http, store });
  return { service, store, captured };
}

describe("自定义翻译源", () => {
  it("LibreTranslate：POST 文本与目标语言，解析 translatedText", async () => {
    const { service, store, captured } = makeService(() => JSON.stringify({ translatedText: "你好，世界" }));
    await store.load();
    store.updateSettings({
      translationProvider: "libretranslate",
      translationEndpoint: "http://127.0.0.1:5000/translate",
      translationApiKey: "secret-key",
    });

    const result = await service.translate("Hello world", "zh-CN");
    expect(result).toEqual({ text: "你好，世界", engine: "LibreTranslate" });
    expect(captured[0]!.url).toBe("http://127.0.0.1:5000/translate");
    expect(captured[0]!.init?.method).toBe("POST");
    const body = JSON.parse(captured[0]!.init!.body!);
    expect(body).toMatchObject({ q: "Hello world", source: "auto", target: "zh", api_key: "secret-key" });
  });

  it("OpenAI 兼容：补全 /chat/completions 并带 Authorization", async () => {
    const { service, store, captured } = makeService(() => JSON.stringify({ choices: [{ message: { content: "你好" } }] }));
    await store.load();
    store.updateSettings({
      translationProvider: "openai",
      translationEndpoint: "https://api.openai.com/v1",
      translationApiKey: "sk-test",
      translationModel: "gpt-4o-mini",
    });

    const result = await service.translate("Hello", "zh-CN");
    expect(result).toEqual({ text: "你好", engine: "OpenAI 兼容" });
    expect(captured[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(captured[0]!.init?.headers?.authorization).toBe("Bearer sk-test");
    const body = JSON.parse(captured[0]!.init!.body!);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[1].content).toBe("Hello");
  });

  it("未填接口地址时给出明确错误", async () => {
    const { service, store } = makeService(() => "{}");
    await store.load();
    store.updateSettings({ translationProvider: "openai", translationEndpoint: "" });
    await expect(service.translate("Hello")).rejects.toThrow("填写自定义翻译接口地址");
  });

  it("接口返回无法识别的内容时报错", async () => {
    const { service, store } = makeService(() => "<html>bad</html>");
    await store.load();
    store.updateSettings({ translationProvider: "libretranslate", translationEndpoint: "http://127.0.0.1:5000/translate" });
    await expect(service.translate("Hello")).rejects.toThrow("无法识别");
  });
});
