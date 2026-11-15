import { Apple, Monitor, Terminal } from "lucide-react";
import type { Platforms } from "@radar/core";

export function PlatformIcons({ platforms, size = 12 }: { platforms: Platforms; size?: number }) {
  return (
    <span className="plat" title={platformLabel(platforms)}>
      {platforms.windows && <Monitor size={size} aria-label="Windows" />}
      {platforms.linux && <Terminal size={size} aria-label="Linux" />}
      {platforms.mac && <Apple size={size} aria-label="macOS" />}
    </span>
  );
}

export function platformLabel(platforms: Platforms): string {
  const list: string[] = [];
  if (platforms.windows) list.push("Windows");
  if (platforms.linux) list.push("Linux");
  if (platforms.mac) list.push("macOS");
  return list.length ? list.join(" / ") : "未知平台";
}
