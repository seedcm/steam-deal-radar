import { useEffect, useState } from "react";
import { imageSrc } from "../lib/bridge";

interface ImgProps {
  src?: string;
  alt: string;
  className?: string;
}

/** 封面图：加载失败或离线时退化成渐变占位，保持卡片布局稳定 */
export function Img({ src, alt, className }: ImgProps) {
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setAttempt(0);
  }, [src]);

  const local = imageSrc(src);
  // 本地缓存协议失败时，回退到原始 CDN 地址再试一次（本地加速工具/代理场景更稳）
  const resolved = attempt === 0 ? local : attempt === 1 && local !== src ? src : undefined;

  if (!src || !resolved) {
    return (
      <div className={`img-fallback ${className ?? ""}`} aria-label={alt} role="img">
        <span>{(alt || "?").slice(0, 1).toUpperCase()}</span>
      </div>
    );
  }

  return (
    <img
      src={resolved}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setAttempt((value) => value + 1)}
    />
  );
}
