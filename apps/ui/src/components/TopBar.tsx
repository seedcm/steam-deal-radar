import { RefreshCw, Search } from "lucide-react";
import { useRef, useEffect } from "react";

interface TopBarProps {
  title: string;
  subtitle: string;
  query: string;
  onQuery: (value: string) => void;
  showSearch: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

export function TopBar({ title, subtitle, query, onQuery, showSearch, refreshing, onRefresh }: TopBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "/" && !["INPUT", "TEXTAREA"].includes((event.target as HTMLElement)?.tagName)) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <header className="topbar">
      <div className="topbar__title">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="topbar__grow" />

      {showSearch && (
        <div className="search">
          <Search size={15} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="搜索游戏名 / 标签"
            aria-label="搜索折扣"
            spellCheck={false}
          />
          <kbd>/</kbd>
        </div>
      )}

      <button type="button" className="btn" onClick={onRefresh} disabled={refreshing} title="立即从 Steam 拉取最新折扣">
        <RefreshCw size={14} className={refreshing ? "spin" : undefined} />
        {refreshing ? "更新中" : "刷新折扣"}
      </button>
    </header>
  );
}
