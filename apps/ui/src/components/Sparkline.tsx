import type { PricePoint } from "@radar/core";

interface SparklineProps {
  points: PricePoint[];
}

/** 纯 SVG 价格走势，不引入图表库，离线也能画 */
export function Sparkline({ points }: SparklineProps) {
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

  const line = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1]![0].toFixed(1)},${height} L${coords[0]![0].toFixed(1)},${height} Z`;

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="价格走势">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-fill)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {coords.map(([x, y], index) => (
        <circle key={index} cx={x} cy={y} r={index === coords.length - 1 ? 3.5 : 2} fill="var(--accent)" opacity={index === coords.length - 1 ? 1 : 0.55} />
      ))}
    </svg>
  );
}
