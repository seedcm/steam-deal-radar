import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  REGIONS,
  formatRelativeTime,
  pickDeals,
  regionCurrency,
  type Deal,
  type SearchHit,
} from "@radar/core";
import { AlertTriangle, Info, LayoutGrid, RefreshCw, Settings2, Sparkles, Star, Tag, User, WifiOff } from "lucide-react";
import { useRadar } from "./hooks/useRadar";
import { TopBar } from "./components/TopBar";
import { DealGrid } from "./components/DealGrid";
import { WatchList } from "./components/WatchList";
import { CatalogView } from "./components/CatalogView";
import { AccountView } from "./components/AccountView";
import { SettingsView } from "./components/SettingsView";
import { AboutView } from "./components/AboutView";
import { DetailPanel } from "./components/DetailPanel";
import { Toasts } from "./components/Toasts";
import { DealCard } from "./components/DealCard";
import { api } from "./lib/client";

type View = "deals" | "watch" | "catalog" | "account" | "settings" | "about";

function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

function hitToDeal(hit: SearchHit): Deal {
  return {
    appId: hit.appId,
    name: hit.name,
    image: hit.image,
    discountPercent: hit.discountPercent,
    originalPrice: hit.originalPrice,
    finalPrice: hit.price,
    currency: hit.currency,
    platforms: hit.platforms,
    storeUrl: hit.storeUrl,
    reviewPercent: hit.reviewPercent,
  };
}

export default function App() {
  const radar = useRadar();
  const { snapshot, booting, refreshing } = radar;
  const online = useOnline();

  const [view, setView] = useState<View>("deals");
  const [query, setQuery] = useState("");
  const [watchOnly, setWatchOnly] = useState(false);
  const [selected, setSelected] = useState<Deal | null>(null);
  const [remoteHits, setRemoteHits] = useState<SearchHit[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [freeMode, setFreeMode] = useState(false);
  const [fxRates, setFxRates] = useState<Record<string, number> | undefined>();

  const settings = snapshot?.settings;
  const currency = regionCurrency(settings?.country ?? "cn");
  const watchIds = useMemo(() => new Set((snapshot?.watchlist ?? []).map((item) => item.appId)), [snapshot?.watchlist]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme ?? "dark";
  }, [settings?.theme]);

  // 全站搜索：本地折扣里找不到时，向 Steam 商店补一次
  useEffect(() => {
    if (view !== "deals" || freeMode || query.trim().length < 2) {
      setRemoteHits([]);
      setRemoteLoading(false);
      return;
    }
    let alive = true;
    setRemoteLoading(true);
    const timer = setTimeout(() => {
      api
        .search(query.trim())
        .then((hits) => alive && setRemoteHits(hits.slice(0, 12)))
        .catch(() => alive && setRemoteHits([]))
        .finally(() => alive && setRemoteLoading(false));
    }, 550);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, view, freeMode]);

  // 汇率：每次刷新后拉取一次（服务端 6 小时缓存）
  useEffect(() => {
    let alive = true;
    api
      .fxRates()
      .then((rates) => alive && setFxRates(rates ?? undefined))
      .catch(() => alive && setFxRates(undefined));
    return () => {
      alive = false;
    };
  }, [snapshot?.meta.lastRefreshAt]);

  const fx = useMemo(
    () => ({ home: settings?.homeCurrency ?? "CNY", rates: fxRates }),
    [settings?.homeCurrency, fxRates],
  );

  const deals = snapshot?.deals ?? [];
  const filtered = useMemo(
    () =>
      pickDeals(
        deals,
        {
          query,
          minDiscount: settings?.minDiscount ?? 0,
          platform: settings?.onlyPlatform ?? "all",
          watchOnly,
          watchIds,
        },
        settings?.sort ?? "discount",
        settings?.sortDirection ?? "desc",
      ),
    [
      deals,
      query,
      settings?.minDiscount,
      settings?.onlyPlatform,
      settings?.sort,
      settings?.sortDirection,
      watchOnly,
      watchIds,
    ],
  );

  const lowIds = useMemo(() => {
    const ids = new Set<number>();
    const history = snapshot?.history ?? {};
    const lowest = snapshot?.lowest ?? {};
    for (const deal of deals) {
      const points = history[String(deal.appId)];
      const low = lowest[String(deal.appId)];
      if (points && points.length >= 2 && low != null && low === deal.finalPrice) ids.add(deal.appId);
    }
    return ids;
  }, [deals, snapshot?.history, snapshot?.lowest]);

  const selectedEntry = useMemo(
    () => snapshot?.watchlist.find((item) => item.appId === selected?.appId),
    [snapshot?.watchlist, selected?.appId],
  );

  const openDeal = useCallback((deal: Deal) => setSelected(deal), []);

  const inspectHit = useCallback(
    async (hit: SearchHit) => {
      setSelected(hitToDeal(hit));
      try {
        const details = await api.details(hit.appId);
        if (details) setSelected((current) => (current?.appId === hit.appId ? { ...hitToDeal(hit), ...details } : current));
      } catch {
        /* 离线时保留基本信息 */
      }
    },
    [],
  );

  const ensureWatched = useCallback(
    async (deal: Deal) => {
      if (!watchIds.has(deal.appId)) {
        await api.watch({ appId: deal.appId, name: deal.name, image: deal.image });
      }
    },
    [watchIds],
  );

  const saveTarget = useCallback(
    async (appId: number, targetPrice?: number) => {
      const deal = selected ?? deals.find((item) => item.appId === appId);
      if (deal && !watchIds.has(appId)) {
        await ensureWatched(deal);
      }
      await api.updateWatch(appId, { targetPrice: targetPrice ?? null });
      await radar.sync();
      radar.toast(targetPrice ? `目标价已设为 ${(targetPrice / 100).toFixed(2)}` : "已清除目标价", "success");
    },
    [deals, ensureWatched, radar, selected, watchIds],
  );

  const saveNote = useCallback(
    async (appId: number, note: string) => {
      const deal = selected ?? deals.find((item) => item.appId === appId);
      if (deal && !watchIds.has(appId)) await ensureWatched(deal);
      await api.updateWatch(appId, { note });
      await radar.sync();
      radar.toast("备注已保存", "success");
    },
    [deals, ensureWatched, radar, selected, watchIds],
  );

  const setNotifyAny = useCallback(
    async (appId: number, notifyAny: boolean) => {
      await api.updateWatch(appId, { notifyAny });
      await radar.sync();
    },
    [radar],
  );

  const removeWatch = useCallback(
    async (appId: number) => {
      await api.unwatch(appId);
      await radar.sync();
      radar.toast("已取消关注");
    },
    [radar],
  );

  const changeSettings = useCallback(
    (patch: Parameters<typeof radar.updateSettings>[0]) => {
      void radar.updateSettings(patch);
    },
    [radar],
  );

  const changeRegion = useCallback((code: string) => {
    void api.updateSettings({ country: code });
  }, []);

  const loginSteam = useCallback(async () => {
    await api.steamLogin();
    await radar.sync();
    radar.toast("Steam 登录成功", "success");
  }, [radar]);

  const logoutSteam = useCallback(async () => {
    await api.steamLogout();
    await radar.sync();
    radar.toast("已退出 Steam 登录", "info");
  }, [radar]);

  const watchWishlist = useCallback(
    (item: { appId: number; name: string; capsule: string }) => {
      if (watchIds.has(item.appId)) {
        radar.toast(`${item.name} 已在关注列表`, "info");
        return;
      }
      void api.watch({ appId: item.appId, name: item.name, image: item.capsule });
      void radar.sync();
      radar.toast(`已关注 ${item.name}`, "success");
    },
    [watchIds, radar],
  );

  const prevCountryRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const current = settings?.country;
    if (prevCountryRef.current !== undefined && current && prevCountryRef.current !== current) {
      const label = REGIONS.find((region) => region.code === current)?.label ?? current;
      radar.toast(`已切换到 ${label}，正在刷新该区域折扣…`, "info");
      void radar.refresh(true);
    }
    prevCountryRef.current = current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.country]);

  const updateTargetFromRow = useCallback(
    async (appId: number, targetPrice?: number) => {
      await api.updateWatch(appId, { targetPrice: targetPrice ?? null });
      await radar.sync();
    },
    [radar],
  );

  const lastRefresh = snapshot?.meta.lastRefreshAt ?? null;
  const offline = !online || Boolean(snapshot?.meta.lastRefreshError);
  const shownRemote = remoteHits.filter(
    (hit) => !deals.some((deal) => deal.appId === hit.appId) && hit.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  // 全站搜索有结果、库内没命中时，不再显示「没有匹配的折扣」空状态
  const hideLocalGrid = query.trim().length >= 2 && filtered.length === 0 && (shownRemote.length > 0 || remoteLoading);

  const subtitle =
    view === "deals"
      ? `${deals.length} 个折扣在库里 · ${lastRefresh ? `${formatRelativeTime(lastRefresh)}更新` : "尚未更新"}${offline ? " · 离线" : ""}`
      : view === "watch"
        ? `${snapshot?.watchlist.length ?? 0} 个关注 · ${offline ? "离线查看" : "自动刷新中"}`
        : view === "catalog"
          ? `${REGIONS.find((item) => item.code === settings?.country)?.label ?? "中国"} · 完整游戏目录（含非打折）`
          : view === "account"
            ? snapshot?.steamAccount
              ? `${snapshot.steamAccount.personaName} · 游戏库与愿望单`
              : "登录 Steam 查看游戏库与愿望单"
            : `v${radar.appInfo?.version ?? "1.2.0"} · ${REGIONS.find((item) => item.code === settings?.country)?.label ?? "中国"}`;

  const diagnostics = useMemo(() => {
    const info = radar.appInfo;
    return [
      `版本：${info?.version ?? "?"}`,
      `平台：${info?.platform ?? "?"} / ${info?.os ?? "?"}`,
      `区域：${settings?.country ?? "?"}  语言：${settings?.language ?? "?"}`,
      `折扣：${deals.length}  关注：${snapshot?.watchlist.length ?? 0}`,
      `上次刷新：${snapshot?.meta.lastRefreshAt ? new Date(snapshot.meta.lastRefreshAt).toLocaleString("zh-CN") : "无"}`,
      `刷新错误：${snapshot?.meta.lastRefreshError ?? "无"}`,
      `更新状态：${radar.update.phase}${radar.update.message ? ` · ${radar.update.message}` : ""}`,
      `代理：${settings?.proxyMode ?? "?"} ${settings?.proxyRules ?? ""}`.trim(),
      `翻译源：${settings?.translationProvider ?? "?"}`,
    ].join("\n");
  }, [radar.appInfo, radar.update, settings, deals.length, snapshot]);

  const title =
    view === "deals"
      ? "折扣雷达"
      : view === "watch"
        ? "我的关注"
        : view === "catalog"
          ? "全部游戏"
          : view === "account"
            ? "Steam 账号"
            : view === "settings"
              ? "设置"
              : "关于";

  return (
    <div className="app">
      <nav className="rail" aria-label="主导航">
        <div className="rail__brand" title="Steam 折扣雷达">
          <RadarMark />
        </div>
        <div className="rail__nav">
          <button type="button" className={`rail__item ${view === "deals" ? "is-active" : ""}`} onClick={() => setView("deals")}>
            <Tag size={18} />
            <span>折扣</span>
          </button>
          <button type="button" className={`rail__item ${view === "watch" ? "is-active" : ""}`} onClick={() => setView("watch")}>
            <Star size={18} />
            <span>关注</span>
            {(snapshot?.watchlist.length ?? 0) > 0 && <i className="rail__count">{snapshot?.watchlist.length}</i>}
          </button>
          <button type="button" className={`rail__item ${view === "catalog" ? "is-active" : ""}`} onClick={() => setView("catalog")}>
            <LayoutGrid size={18} />
            <span>全部游戏</span>
          </button>
          <button type="button" className={`rail__item ${view === "account" ? "is-active" : ""}`} onClick={() => setView("account")}>
            <User size={18} />
            <span>账号</span>
          </button>
          <button type="button" className={`rail__item ${view === "settings" ? "is-active" : ""}`} onClick={() => setView("settings")}>
            <Settings2 size={18} />
            <span>设置</span>
          </button>
          <button type="button" className={`rail__item ${view === "about" ? "is-active" : ""}`} onClick={() => setView("about")}>
            <Info size={18} />
            <span>关于</span>
          </button>
        </div>
        <div className="rail__spacer" />
        <div className="rail__watermark" aria-hidden="true">
          STEAM DEAL RADAR
        </div>
        <div className="rail__foot" title="当前版本">
          v{radar.appInfo?.version ?? "1.6.1"}
        </div>
      </nav>

      <main className="main">
        <TopBar
          title={title}
          subtitle={subtitle}
          query={query}
          onQuery={setQuery}
          showSearch={view === "deals" || view === "watch" || view === "catalog"}
          refreshing={refreshing}
          onRefresh={() => void radar.refresh(true)}
          settings={view === "deals" || view === "catalog" ? settings ?? null : null}
          showDealFilters={view === "deals"}
          onRegionChange={(code) => void changeRegion(code)}
          freeMode={freeMode}
          onToggleFreeMode={() => setFreeMode((value) => !value)}
          watchOnly={watchOnly}
          onToggleWatchOnly={() => setWatchOnly((value) => !value)}
          onChangeSettings={changeSettings}
        />

        <div className="content">
          {!online && (
            <div className="banner banner--warn">
              <WifiOff size={15} />
              <span className="banner__grow">当前网络不可用，正在展示本地缓存的折扣与关注价格，恢复网络后会自动更新。</span>
            </div>
          )}

          {snapshot?.meta.lastRefreshError && (
            <div className="banner banner--error">
              <AlertTriangle size={15} />
              <span className="banner__grow">{snapshot.meta.lastRefreshError}</span>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  void api.copyText(diagnostics);
                  radar.toast("诊断信息已复制，反馈时粘贴即可", "success");
                }}
              >
                复制诊断
              </button>
              <button type="button" className="btn btn--sm" onClick={() => void radar.refresh(true)}>
                <RefreshCw size={12} /> 重试
              </button>
            </div>
          )}

          {offline && !snapshot?.meta.lastRefreshError && (snapshot?.meta.dealCount ?? 0) > 0 && (
            <div className="banner">
              <WifiOff size={15} />
              <span className="banner__grow">离线模式：以下数据缓存于 {formatRelativeTime(lastRefresh)}，仍可查看、搜索和调整关注。</span>
            </div>
          )}

          {view === "deals" && (
            <>
              {freeMode && (
                <CatalogView
                  variant="free"
                  query={query}
                  currency={currency}
                  watchIds={watchIds}
                  lowIds={lowIds}
                  onSelect={openDeal}
                  onToggleWatch={(deal) => void radar.toggleWatch(deal)}
                  fx={fx}
                />
              )}

              {!freeMode && query.trim().length >= 2 && (shownRemote.length > 0 || remoteLoading) && (
                <>
                  <div className="section-head">
                    <h2>
                      <Sparkles size={13} style={{ verticalAlign: "-1px", marginRight: 5 }} />
                      Steam 全站搜索
                    </h2>
                    <span>{remoteLoading ? "搜索中…" : `${shownRemote.length} 个结果`}</span>
                  </div>
                  <div className="grid">
                    {shownRemote.map((hit) => (
                      <DealCard
                        key={hit.appId}
                        deal={hitToDeal(hit)}
                        watched={watchIds.has(hit.appId)}
                        isLow={false}
                        currency={currency}
                        onSelect={() => void inspectHit(hit)}
                        onToggleWatch={(deal) => void radar.toggleWatch(deal)}
                      />
                    ))}
                  </div>
                  {filtered.length > 0 && (
                    <div className="section-head">
                      <h2>库内折扣</h2>
                      <span>{filtered.length} 个</span>
                    </div>
                  )}
                </>
              )}

              {!freeMode && !hideLocalGrid && (
                <DealGrid
                  deals={filtered}
                  watchIds={watchIds}
                  lowIds={lowIds}
                  currency={currency}
                  loading={booting}
                  offline={(snapshot?.meta.dealCount ?? 0) === 0}
                  onSelect={openDeal}
                  onToggleWatch={(deal) => void radar.toggleWatch(deal)}
                  onRefresh={() => void radar.refresh(true)}
                  fx={fx}
                />
              )}
            </>
          )}

          {view === "catalog" && (
            <CatalogView
              query={query}
              currency={currency}
              watchIds={watchIds}
              lowIds={lowIds}
              onSelect={openDeal}
              onToggleWatch={(deal) => void radar.toggleWatch(deal)}
              fx={fx}
            />
          )}

          {view === "account" && (
            <AccountView
              account={snapshot?.steamAccount ?? null}
              platform={radar.appInfo?.platform ?? "web"}
              watchIds={watchIds}
              onLogin={loginSteam}
              onLogout={logoutSteam}
              onWatchWishlist={watchWishlist}
              onOpenStore={(appId) => void api.openStore(appId)}
            />
          )}

          {view === "watch" && (
            <WatchList
              watchlist={snapshot?.watchlist ?? []}
              quotes={snapshot?.watchQuotes ?? {}}
              deals={deals}
              currency={currency}
              onSelect={openDeal}
              onRemove={(appId) => void removeWatch(appId)}
              onTarget={(appId, value) => void updateTargetFromRow(appId, value)}
              onNotifyAny={(appId, value) => void setNotifyAny(appId, value)}
              onOpenStore={(appId) => void api.openStore(appId)}
              onBrowse={() => {
                setView("deals");
                setQuery("");
              }}
              query={query}
              onClearQuery={() => setQuery("")}
            />
          )}

          {view === "about" && (
            <AboutView
              appInfo={radar.appInfo}
              update={radar.update}
              onCheckUpdate={() => void radar.checkUpdate()}
              onInstallUpdate={() => void api.installUpdate().catch((error) => radar.toast(error instanceof Error ? error.message : "更新失败", "error"))}
              onOpen={(url) => void api.openExternal(url)}
              diagnostics={diagnostics}
              onCopy={(text) => {
                void api.copyText(text);
                radar.toast("诊断信息已复制", "success");
              }}
            />
          )}

          {view === "settings" && settings && (
            <SettingsView
              settings={settings}
              appInfo={radar.appInfo}
              watchCount={snapshot?.watchlist.length ?? 0}
              dealCount={deals.length}
              lastRefreshAt={lastRefresh}
              onChange={changeSettings}
              onRefresh={() => void radar.refresh(true)}
              onTestNotify={() => void api.testNotification()}
              onExport={() => void radar.exportData()}
              onImport={radar.importData}
            />
          )}
        </div>
      </main>

      {selected && (
        <DetailPanel
          deal={selected}
          entry={selectedEntry}
          currency={currency}
          isLow={lowIds.has(selected.appId)}
          translationTarget={settings?.translationTarget}
          translationProvider={settings?.translationProvider}
          fx={fx}
          history={snapshot?.history[String(selected.appId)] ?? []}
          onClose={() => setSelected(null)}
          onToggleWatch={(deal) => void radar.toggleWatch(deal)}
          onSaveTarget={(appId, targetPrice) => void saveTarget(appId, targetPrice)}
          onSaveNote={(appId, note) => void saveNote(appId, note)}
          onNotifyAny={(appId, value) => void setNotifyAny(appId, value)}
        />
      )}

      <Toasts items={radar.toasts} />
    </div>
  );
}

function RadarMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
      <circle cx="12" cy="12" r="4.6" stroke="currentColor" strokeWidth="1.6" opacity="0.8" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <path d="M12 12 L18.4 5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
