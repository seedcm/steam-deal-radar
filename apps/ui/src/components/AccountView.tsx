import { useEffect, useMemo, useState } from "react";
import type { LibraryGame, SteamAccount, WishlistItem } from "@radar/core";
import { friendlyError } from "@radar/core";
import { BookOpen, ExternalLink, Heart, Loader2, LogOut, RefreshCw, Star, User } from "lucide-react";
import { api } from "../lib/client";
import { Img } from "./Img";

interface AccountViewProps {
  account: SteamAccount | null;
  platform: "electron" | "harmony" | "web";
  watchIds: Set<number>;
  onLogin: () => Promise<void>;
  onLogout: () => Promise<void>;
  onWatchWishlist: (item: WishlistItem) => void;
  onOpenStore: (appId: number) => void;
}

type Tab = "library" | "wishlist";

function hintForPrivacy(account: SteamAccount): string {
  if (account.privacyState === 3) return "";
  return "你的 Steam 隐私设置为「私密/仅好友」，游戏库和愿望单需要设为公开才能在这里看到。";
}

export function AccountView({
  account,
  platform,
  watchIds,
  onLogin,
  onLogout,
  onWatchWishlist,
  onOpenStore,
}: AccountViewProps) {
  const [tab, setTab] = useState<Tab>("library");
  const [library, setLibrary] = useState<LibraryGame[]>([]);
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steamId = account?.steamId;

  useEffect(() => {
    if (!steamId) {
      setLibrary([]);
      setWishlist([]);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.allSettled([api.steamLibrary(steamId), api.steamWishlist(steamId)]).then(([lib, wish]) => {
      if (!alive) return;
      setLoading(false);
      if (lib.status === "fulfilled") setLibrary(lib.value);
      if (wish.status === "fulfilled") setWishlist(wish.value);
      const failures = [lib, wish]
        .filter((item): item is PromiseRejectedResult => item.status === "rejected")
        .map((item) => friendlyError(item.reason));
      setError(failures.length > 0 ? failures.join("；") : null);
    });
    return () => {
      alive = false;
    };
  }, [steamId]);

  const keyword = filter.trim().toLowerCase();
  const libraryShown = useMemo(
    () => (keyword ? library.filter((item) => item.name.toLowerCase().includes(keyword)) : library),
    [library, keyword],
  );
  const wishlistShown = useMemo(
    () => (keyword ? wishlist.filter((item) => item.name.toLowerCase().includes(keyword)) : wishlist),
    [wishlist, keyword],
  );

  if (!account) {
    return (
      <div className="settings">
        <section className="panel">
          <div className="panel__head">
            <span className="panel__icon">
              <User size={16} />
            </span>
            <div>
              <h2>Steam 账号</h2>
              <p>登录后可以查看自己的游戏库和愿望单</p>
            </div>
          </div>

          <p className="hint">
            点击「登录 Steam」会在应用内打开 Steam 官方登录页，应用只保存你的 Steam ID，不会接触账号密码。
            游戏库与愿望单需要你在 Steam 隐私设置里公开对应内容。
          </p>

          {platform === "electron" && (
            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void handleLogin()}>
                {busy ? <Loader2 size={13} className="spin" /> : <User size={13} />}
                {busy ? "请在弹出的窗口中完成登录…" : "登录 Steam"}
              </button>
            </div>
          )}

          {platform !== "electron" && <p className="hint hint--error">Steam 登录与游戏库/愿望单目前仅桌面端支持。</p>}
          {error && <p className="hint hint--error">{error}</p>}
        </section>
      </div>
    );

    async function handleLogin() {
      setBusy(true);
      setError(null);
      try {
        await onLogin();
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <div className="settings">
      <section className="panel">
        <div className="panel__head">
          <span className="panel__icon">
            <User size={16} />
          </span>
          <div>
            <h2>{account.personaName}</h2>
            <p>Steam ID {account.steamId} · 登录于 {new Date(account.loggedInAt).toLocaleString("zh-CN")}</p>
          </div>
          <div className="panel__head-actions">
            <button type="button" className="btn btn--sm" onClick={() => void onLogout()}>
              <LogOut size={13} /> 退出登录
            </button>
          </div>
        </div>

        {account.avatar && (
          <img className="account-avatar" src={account.avatar} alt={account.personaName} referrerPolicy="no-referrer" />
        )}

        {hintForPrivacy(account) && <p className="hint hint--error">{hintForPrivacy(account)}</p>}

        <div className="seg" style={{ marginTop: 12 }}>
          <button type="button" className={tab === "library" ? "is-active" : ""} onClick={() => setTab("library")}>
            <BookOpen size={13} /> 游戏库（{library.length}）
          </button>
          <button type="button" className={tab === "wishlist" ? "is-active" : ""} onClick={() => setTab("wishlist")}>
            <Heart size={13} /> 愿望单（{wishlist.length}）
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <input
            className="text-input field-input"
            style={{ width: 240 }}
            value={filter}
            placeholder="按名称筛选"
            onChange={(event) => setFilter(event.target.value)}
            aria-label="筛选游戏"
          />
          <button
            type="button"
            className="btn btn--sm"
            disabled={loading}
            onClick={() => {
              if (!steamId) return;
              setLoading(true);
              Promise.allSettled([api.steamLibrary(steamId), api.steamWishlist(steamId)]).then(([lib, wish]) => {
                setLoading(false);
                if (lib.status === "fulfilled") setLibrary(lib.value);
                if (wish.status === "fulfilled") setWishlist(wish.value);
              });
            }}
          >
            <RefreshCw size={12} /> 刷新
          </button>
        </div>

        {loading && (
          <p className="hint">
            <Loader2 size={12} className="spin" /> 读取中…
          </p>
        )}
        {error && <p className="hint hint--error">{error}</p>}

        {tab === "library" && (
          <div className="account-list">
            {libraryShown.map((game) => (
              <div className="account-row" key={game.appId}>
                <Img src={game.logo} alt={game.name} className="account-row__thumb" />
                <div className="account-row__info">
                  <b>{game.name}</b>
                  <span>已游玩 {Math.round(game.hoursOnRecord * 10) / 10} 小时</span>
                </div>
                <button type="button" className="icon-btn icon-btn--bare" title="在 Steam 打开" onClick={() => onOpenStore(game.appId)}>
                  <ExternalLink size={15} />
                </button>
              </div>
            ))}
            {!loading && libraryShown.length === 0 && (
              <p className="hint">游戏库为空或没有匹配的游戏；请在 Steam 隐私设置中公开「游戏详情」。</p>
            )}
          </div>
        )}

        {tab === "wishlist" && (
          <div className="account-list">
            {wishlistShown.map((item) => {
              const watched = watchIds.has(item.appId);
              return (
                <div className="account-row" key={item.appId}>
                  <Img src={item.capsule} alt={item.name} className="account-row__thumb" />
                  <div className="account-row__info">
                    <b>{item.name}</b>
                    <span>{watched ? "已在关注列表" : "加入关注后可设置目标价"}</span>
                  </div>
                  <button
                    type="button"
                    className={`icon-btn icon-btn--bare ${watched ? "is-active" : ""}`}
                    title={watched ? "已在关注列表" : "加入关注"}
                    onClick={() => onWatchWishlist(item)}
                  >
                    <Star size={15} fill={watched ? "currentColor" : "none"} />
                  </button>
                  <button type="button" className="icon-btn icon-btn--bare" title="在 Steam 打开" onClick={() => onOpenStore(item.appId)}>
                    <ExternalLink size={15} />
                  </button>
                </div>
              );
            })}
            {!loading && wishlistShown.length === 0 && (
              <p className="hint">愿望单为空或没有匹配的游戏；请在 Steam 隐私设置中公开「愿望单」。</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
