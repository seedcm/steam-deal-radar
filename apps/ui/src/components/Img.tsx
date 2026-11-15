import { useEffect, useState } from "react";
import { imageSrc } from "../lib/bridge";

interface ImgProps {
  src?: string;
  alt: string;
  className?: string;
}

/** 封面图：加载失败或离线时退化成渐变占位，保持卡片布局稳定 */
export function Img({ src, alt, className }: ImgProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const resolved = imageSrc(src);

  if (!src || !resolved || failed) {
    return (
      <div className={`img-fallback ${className ?? ""}`} aria-label={alt} role="img">
        <span>{(alt || "?").slice(0, 1).toUpperCase()}</span>
      </div>
    );
  }

  return <img src={resolved} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
