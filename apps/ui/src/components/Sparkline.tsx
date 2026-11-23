import { useState } from "react";
import type { PricePoint } from "@radar/core";
import { REGIONS, convertMoney, formatMoney } from "@radar/core";

interface SparklineProps {
  points: PricePoint[];
  currency?: string;
  rates?: Record<string, number>;
}

/** 纯 SVG 价格走势 + 节点悬停显示该点价格（含各区域换算），不引入图表库 */
export function Sparkline({ points, currency, rates }: SparklineProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <div className="sparkline" style={{ display: "grid", placeItems: "center" }}>
        <span className="hint">刷新两次之后这里会显示价格走势</span>
      </div>
    );
  }

  const width = 460;
  const height = 84;
  const pad = 6;
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(1, max - min);
  const stepX = (width - pad * 2) / (points.length - 1);
  const coords = points.map((point, index) => {
    const x = pad + index * stepX;
    const y = pad + (1 - (point.price - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const regionCurrencies = [...new Set(REGIONS.map((region) => region.currency))];

  const linesFor = (point: PricePoint): string[] => {
    const date = new Date(point.at).toLocaleString("zh-CN", { hour12: false });
    const lines = [`${formatMoney(point.price, currency ?? "CNY")} · ${date}`];
    if (rates) {
      for (const code of regionCurrencies) {
        if (!currency || code === currency) continue;
        const converted = convertMoney(point.price, currency, code, rates);
        if (converted == null) continue;
        lines.push(`≈ ${formatMoney(converted, code)}`);
      }
    }
    return lines;
  };

  const line = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1]![0].toFixed(1)},${height} L${coords[0]![0].toFixed(1)},${height} Z`;

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const rx = ((event.clientX - rect.left) / rect.width) * width;
    const index = Math.round((rx - pad) / stepX);
    setHovered(Math.max(0, Math.min(points.length - 1, index)));
  };

  return (
    <div className="sparkline-wrap">
      <svg
        className="sparkline"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="价格走势"
        onMouseMove={handleMove}
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#spark-fill)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {coords.map(([x, y], index) => (
          <circle
            key={index}
            cx={x}
            cy={y}
            r={hovered === index ? 5 : index === coords.length - 1 ? 3.5 : 2}
            fill={hovered === index ? "#fff" : "var(--accent)"}
            opacity={index === coords.length - 1 || hovered === index ? 1 : 0.55}
          >
            <title>{linesFor(points[index]!).join("\n")}</title>
          </circle>
        ))}
      </svg>

      {hovered != null && (
        <div
          className="sparkline__tip"
          style={{
            left: `${(coords[hovered]![0] / width) * 100}%`,
            top: `${(coords[hovered]![1] / height) * 100}%`,
          }}
        >
          {linesFor(points[hovered]!).map((lineText, index) => (
            <span key={index}>{lineText}</span>
          ))}
        </div>
      )}
    </div>
  );
}
