import type { PlatformFilter, Settings, SortKey } from "@radar/core";
import { SORT_LABELS } from "@radar/core";
import { ChevronDown, Star } from "lucide-react";

interface FilterBarProps {
  settings: Settings;
  total: number;
  shown: number;
  watchOnly: boolean;
  onToggleWatchOnly: () => void;
  onChange: (patch: Partial<Settings>) => void;
}

const DISCOUNT_STEPS = [
  { value: 0, label: "全部折扣" },
  { value: 25, label: "≥25%" },
  { value: 50, label: "≥50%" },
  { value: 70, label: "≥70%" },
  { value: 85, label: "≥85%" },
];

const PLATFORM_OPTIONS: Array<{ value: PlatformFilter; label: string }> = [
  { value: "all", label: "全部平台" },
  { value: "windows", label: "Windows" },
  { value: "linux", label: "Linux" },
];

export function FilterBar({ settings, total, shown, watchOnly, onToggleWatchOnly, onChange }: FilterBarProps) {
  return (
    <div className="toolbar">
      <div className="chips">
        {DISCOUNT_STEPS.map((step) => (
          <button
            key={step.value}
            type="button"
            className={`chip ${settings.minDiscount === step.value ? "is-active" : ""}`}
            onClick={() => onChange({ minDiscount: step.value })}
          >
            {step.label}
          </button>
        ))}
      </div>

      <div className="toolbar__grow" />

      <button
        type="button"
        className={`chip ${watchOnly ? "is-active" : ""}`}
        onClick={onToggleWatchOnly}
        aria-pressed={watchOnly}
        title="只看已关注"
      >
        <Star size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} fill={watchOnly ? "currentColor" : "none"} />
        只看关注
      </button>

      <div className="select">
        <select
          value={settings.onlyPlatform}
          onChange={(event) => onChange({ onlyPlatform: event.target.value as PlatformFilter })}
          aria-label="平台筛选"
        >
          {PLATFORM_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={13} />
      </div>

      <div className="select">
        <select value={settings.sort} onChange={(event) => onChange({ sort: event.target.value as SortKey })} aria-label="排序方式">
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
        <ChevronDown size={13} />
      </div>

      <span className="hint" style={{ marginLeft: 2 }}>
        {shown} / {total}
      </span>
    </div>
  );
}
