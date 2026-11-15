import { useCallback, useEffect, useMemo, useState } from "react";
import type { GameReview, ReviewType } from "@radar/core";
import { filterReviews } from "@radar/core";
import { ChevronDown, Languages, Laugh, Loader2, MessageSquare, RefreshCw, ThumbsUp } from "lucide-react";
import { api } from "../lib/client";

interface ReviewListProps {
  appId: number;
  summary?: string;
  reviewPercent?: number;
}

interface TranslationState {
  text?: string;
  engine?: string;
  loading?: boolean;
  error?: string;
  shown?: boolean;
}

const TYPE_OPTIONS: Array<{ type: ReviewType; label: string }> = [
  { type: "positive", label: "好评" },
  { type: "negative", label: "差评" },
];

/** 默认国区（简体中文），其他地区按语言筛选 */
const LANGUAGE_OPTIONS = [
  { value: "schinese", label: "简体中文（国区）" },
  { value: "tchinese", label: "繁體中文（港台）" },
  { value: "english", label: "English（英语区）" },
  { value: "japanese", label: "日本語（日区）" },
  { value: "koreana", label: "한국어（韩区）" },
  { value: "russian", label: "Русский（俄区）" },
];

function formatDate(review: GameReview): string {
  if (review.postedAt) {
    return new Date(review.postedAt).toLocaleDateString("zh-CN", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  return review.postedText ?? "";
}

function dedupe(list: GameReview[]): GameReview[] {
  const seen = new Set<string>();
  return list.filter((review) => {
    if (seen.has(review.id)) return false;
    seen.add(review.id);
    return true;
  });
}

/** 评价详情：默认国区，按语言切换；非中文评价可一键免费翻译 */
export function ReviewList({ appId, summary, reviewPercent }: ReviewListProps) {
  const [reviews, setReviews] = useState<GameReview[]>([]);
  const [next, setNext] = useState<Record<string, string> | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [types, setTypes] = useState<ReviewType[]>(["positive", "negative"]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [language, setLanguage] = useState("schinese");
  const [translations, setTranslations] = useState<Record<string, TranslationState>>({});

  const load = useCallback(
    async (cursor?: Record<string, string>) => {
      setLoading(true);
      setError(null);
      try {
        const page = await api.reviews(appId, cursor, language);
        setReviews((previous) => dedupe([...previous, ...page.reviews]));
        setNext(page.next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "评价加载失败");
      } finally {
        setLoading(false);
      }
    },
    [appId, language],
  );

  useEffect(() => {
    setReviews([]);
    setNext(undefined);
    setTranslations({});
    void load();
  }, [load]);

  const filtered = useMemo(() => filterReviews(reviews, types), [reviews, types]);
  const upCount = useMemo(() => reviews.filter((review) => review.votedUp).length, [reviews]);
  const downCount = reviews.length - upCount;
  const translateVisible = language !== "schinese";

  const toggleType = (type: ReviewType) => {
    setTypes((previous) => {
      if (previous.length === 2) return [type];
      if (previous.includes(type)) {
        const rest = previous.filter((item) => item !== type);
        return rest.length > 0 ? rest : previous;
      }
      return [...previous, type];
    });
  };

  const toggleExpanded = (id: string) => {
    setExpanded((previous) => {
      const nextSet = new Set(previous);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });
  };

  const translateReview = async (review: GameReview) => {
    const current = translations[review.id];
    if (current?.text) {
      setTranslations((previous) => ({ ...previous, [review.id]: { ...current, shown: !current.shown } }));
      return;
    }
    setTranslations((previous) => ({ ...previous, [review.id]: { loading: true, shown: true } }));
    try {
      const result = await api.translate(review.text);
      setTranslations((previous) => ({
        ...previous,
        [review.id]: { text: result.text, engine: result.engine, shown: true },
      }));
    } catch (err) {
      setTranslations((previous) => ({
        ...previous,
        [review.id]: { error: err instanceof Error ? err.message : "翻译失败", shown: true },
      }));
    }
  };

  return (
    <div className="review-panel">
      <div className="review-panel__head">
        <div>
          <b>玩家评价</b>
          <span>按 Steam 官方排序（最有帮助）</span>
        </div>
        <div className="review-panel__score">
          {summary ?? "总体评价"}
          {typeof reviewPercent === "number" ? ` · ${reviewPercent}% 好评` : ""}
        </div>
      </div>

      <div className="review-panel__lang">
        <Languages size={12} />
        <span>评价地区</span>
        <div className="select">
          <select value={language} aria-label="评价语言" onChange={(event) => setLanguage(event.target.value)}>
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </div>
        <span className="review-panel__lang-hint">默认国区；切换后按该语言重新加载</span>
      </div>

      <div className="review-panel__filters">
        {TYPE_OPTIONS.map((option) => {
          const active = types.includes(option.type);
          return (
            <button
              key={option.type}
              type="button"
              className={`chip ${active ? "is-active" : ""}`}
              aria-pressed={active}
              onClick={() => toggleType(option.type)}
            >
              {option.label}
              <em className="review-chip-count">{option.type === "positive" ? upCount : downCount}</em>
            </button>
          );
        })}
        <button
          type="button"
          className="chip"
          onClick={() => setTypes(["positive", "negative"])}
          disabled={types.length === 2}
          title="显示全部评价"
        >
          全部
        </button>
        <span className="review-panel__count">
          {filtered.length} / {reviews.length}
        </span>
      </div>

      <p className="review-panel__note">
        「特别好评」「好评如潮」是 Steam 对整款游戏的总体评价；单条评价只区分推荐（好评）与不推荐（差评）。
        {translateVisible && " 非国区评价可点「翻译成中文」，翻译由免费在线服务（MyMemory / Google）提供，原文会发送给该服务，且可能受每日额度限制。"}
      </p>

      {error && (
        <div className="review-panel__error">
          <span>{error}</span>
          <button type="button" className="btn btn--sm" onClick={() => void load()}>
            <RefreshCw size={12} /> 重试
          </button>
        </div>
      )}

      {reviews.length === 0 && loading && (
        <div className="review-panel__loading">
          <Loader2 size={16} className="spin" /> 正在读取 Steam 评价…
        </div>
      )}

      {reviews.length > 0 && filtered.length === 0 && (
        <p className="review-panel__empty">
          已加载 {reviews.length} 条评价，没有符合当前筛选的条目。可以加载更多，或把「好评 / 差评」都选上。
        </p>
      )}

      <div className="review-list">
        {filtered.map((review) => {
          const long = review.text.length > 260 || review.text.split("\n").length > 6;
          const open = expanded.has(review.id);
          const translation = translations[review.id];
          return (
            <article key={review.id} className={`review-item ${review.votedUp ? "is-up" : "is-down"}`}>
              <header className="review-item__head">
                <span className={`review-item__avatar ${review.votedUp ? "is-up" : "is-down"}`}>
                  {(review.author || "?").slice(0, 1).toUpperCase()}
                </span>
                <div className="review-item__who">
                  <b>{review.author}</b>
                  <span>
                    {typeof review.playtimeHours === "number" ? `${review.playtimeHours.toFixed(1)} 小时` : "时长未知"}
                    {formatDate(review) ? ` · ${formatDate(review)}` : ""}
                  </span>
                </div>
                <span className={`review-item__badge ${review.votedUp ? "is-up" : "is-down"}`}>
                  {review.votedUp ? "推荐" : "不推荐"}
                </span>
              </header>

              <p className={`review-item__text ${long && !open ? "is-clamped" : ""}`}>
                {review.text || "（该用户没有填写评价内容）"}
              </p>
              {long && (
                <button type="button" className="review-item__more" onClick={() => toggleExpanded(review.id)}>
                  {open ? "收起" : "展开全文"}
                </button>
              )}

              {translation?.shown && (translation.text || translation.error) && (
                <div className={`review-item__translation ${translation.error ? "is-error" : ""}`}>
                  <span>{translation.error ? "翻译失败" : `机器翻译 · ${translation.engine ?? "在线"}`}</span>
                  <p>{translation.error ?? translation.text}</p>
                </div>
              )}

              <footer className="review-item__foot">
                <span>
                  <ThumbsUp size={11} /> {review.helpful.toLocaleString("zh-CN")}
                </span>
                <span>
                  <Laugh size={11} /> {review.funny.toLocaleString("zh-CN")}
                </span>
                <span>
                  <MessageSquare size={11} /> {review.comments.toLocaleString("zh-CN")}
                </span>
                {translateVisible && review.text && (
                  <button
                    type="button"
                    className="review-item__translate"
                    onClick={() => void translateReview(review)}
                    disabled={translation?.loading}
                  >
                    {translation?.loading ? (
                      <>
                        <Loader2 size={10} className="spin" /> 翻译中…
                      </>
                    ) : translation?.error ? (
                      "重试翻译"
                    ) : translation?.text ? (
                      translation.shown ? "隐藏翻译" : "显示翻译"
                    ) : (
                      "翻译成中文"
                    )}
                  </button>
                )}
              </footer>
            </article>
          );
        })}
      </div>

      {next && (
        <button type="button" className="btn btn--sm review-panel__more" onClick={() => void load(next)} disabled={loading}>
          {loading ? <Loader2 size={13} className="spin" /> : null}
          {loading ? "加载中…" : "加载更多评价"}
        </button>
      )}
    </div>
  );
}
