import type { Deal, GameReview, PlatformFilter, ReviewType, SortKey } from "./types";

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

export function sortDeals(deals: readonly Deal[], sort: SortKey): Deal[] {
  const list = [...deals];
  switch (sort) {
    case "price":
      list.sort((a, b) => (a.finalPrice ?? Infinity) - (b.finalPrice ?? Infinity) || b.discountPercent - a.discountPercent);
      break;
    case "name":
      list.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
      break;
    case "review":
      list.sort((a, b) => (b.reviewPercent ?? -1) - (a.reviewPercent ?? -1) || b.discountPercent - a.discountPercent);
      break;
    case "discount":
    default:
      list.sort(
        (a, b) =>
          b.discountPercent - a.discountPercent ||
          (a.finalPrice ?? Infinity) - (b.finalPrice ?? Infinity) ||
          a.name.localeCompare(b.name, "zh-Hans-CN"),
      );
      break;
  }
  return list;
}

export function pickDeals(deals: readonly Deal[], filter: DealFilter, sort: SortKey): Deal[] {
  return sortDeals(filterDeals(deals, filter), sort);
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
