import { describe, expect, it } from "vitest";
import { isAllowedExternalUrl } from "../src/controller";

describe("isAllowedExternalUrl", () => {
  it("允许 Steam 与 GitHub 的 https 链接", () => {
    expect(isAllowedExternalUrl("https://store.steampowered.com/app/730")).toContain("store.steampowered.com");
    expect(isAllowedExternalUrl("https://github.com/seedcm/steam-deal-radar")).toContain("github.com");
    expect(isAllowedExternalUrl("https://gist.github.com/abc")).toContain("gist.github.com");
  });

  it("拒绝非 https、非白名单与伪造域名", () => {
    expect(isAllowedExternalUrl("http://github.com/seedcm/steam-deal-radar")).toBeNull();
    expect(isAllowedExternalUrl("https://example.com/steal")).toBeNull();
    expect(isAllowedExternalUrl("https://github.com.evil.example/x")).toBeNull();
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBeNull();
    expect(isAllowedExternalUrl("not a url")).toBeNull();
  });
});
