import { DEFAULT_SORT_DIRECTION } from "./types";
import type { Deal, GameReview, PlatformFilter, ReviewType, SortDirection, SortKey } from "./types";

export interface DealFilter {
  query?: string;
  minDiscount?: number;
  platform?: PlatformFilter;
  watchOnly?: boolean;
  watchIds?: ReadonlySet<number> | readonly number[];
  hideWatched?: boolean;
}

function watchedSet(ids: DealFilter["watchIds"]): Set<number> {
  if (!ids) return new Set();
  return ids instanceof Set ? ids : new Set(ids);
}

export function matchesQuery(deal: { name: string; tags?: string[] }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (deal.name.toLowerCase().includes(q)) return true;
  return (deal.tags ?? []).some((tag) => tag.toLowerCase().includes(q));
}

export function filterDeals(deals: readonly Deal[], filter: DealFilter): Deal[] {
  const watched = watchedSet(filter.watchIds);
  const minDiscount = filter.minDiscount ?? 0;
  return deals.filter((deal) => {
    if (deal.discountPercent < minDiscount) return false;
    if (filter.platform === "windows" && !deal.platforms.windows) return false;
    if (filter.platform === "linux" && !deal.platforms.linux) return false;
    if (filter.watchOnly && !watched.has(deal.appId)) return false;
    if (filter.hideWatched && watched.has(deal.appId)) return false;
    if (filter.query && !matchesQuery(deal, filter.query)) return false;
    return true;
  });
}

export function sortDeals(
  deals: readonly Deal[],
  sort: SortKey,
  direction: SortDirection = DEFAULT_SORT_DIRECTION[sort],
): Deal[] {
  const ascending = direction === "asc";
  const lowFirst = (a: number, b: number) => (ascending ? a - b : b - a);
  const highFirst = (a: number, b: number) => (ascending ? a - b : b - a);
  const list = [...deals];
  switch (sort) {
    case "price":
      list.sort((a, b) => lowFirst(a.finalPrice ?? Infinity, b.finalPrice ?? Infinity));
      break;
    case "originalPrice":
      list.sort((a, b) => lowFirst(a.originalPrice ?? Infinity, b.originalPrice ?? Infinity));
      break;
    case "name":
      list.sort((a, b) => (ascending ? 1 : -1) * a.name.localeCompare(b.name, "zh-Hans-CN"));
      break;
    case "review":
      list.sort((a, b) => highFirst(a.reviewPercent ?? -1, b.reviewPercent ?? -1));
      break;
    case "discount":
    default:
      list.sort(
        (a, b) =>
          highFirst(a.discountPercent, b.discountPercent) ||
          (a.finalPrice ?? Infinity) - (b.finalPrice ?? Infinity),
      );
      break;
  }
  return list;
}

export function pickDeals(
  deals: readonly Deal[],
  filter: DealFilter,
  sort: SortKey,
  direction: SortDirection = DEFAULT_SORT_DIRECTION[sort],
): Deal[] {
  return sortDeals(filterDeals(deals, filter), sort, direction);
}

/**
 * 评价类型筛选：好评 / 差评可单独或组合显示。
 * 空数组或同时包含两种视为「全部」。
 */
export function filterReviews(reviews: readonly GameReview[], types: readonly ReviewType[]): GameReview[] {
  if (types.length === 0 || types.length >= 2) return [...reviews];
  const wantPositive = types.includes("positive");
  return reviews.filter((review) => (wantPositive ? review.votedUp : !review.votedUp));
}
