import { useState } from "react";
import type { SteamAccount } from "@radar/core";
import { friendlyError } from "@radar/core";
import { Loader2, LogOut, User } from "lucide-react";

interface AccountViewProps {
  account: SteamAccount | null;
  platform: "electron" | "harmony" | "web";
  onLogin: () => Promise<void>;
  onLogout: () => Promise<void>;
}

function hintForPrivacy(account: SteamAccount): string {
  if (account.privacyState === 3) return "";
  return "你的 Steam 隐私设置为「私密/仅好友」，游戏库和愿望单需要设为公开才能在顶栏看到。";
}

export function AccountView({ account, platform, onLogin, onLogout }: AccountViewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      await onLogin();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings">
      <section className="panel">
        <div className="panel__head">
          <span className="panel__icon">
            <User size={16} />
          </span>
          <div>
            <h2>Steam 账号</h2>
            <p>登录后查看顶栏的「游戏库 / 愿望单」，卡片上会标记已收藏与购物车</p>
          </div>
        </div>

        {account ? (
          <>
            <div className="account-profile">
              {account.avatar && (
                <img className="account-avatar" src={account.avatar} alt={account.personaName} referrerPolicy="no-referrer" />
              )}
              <div className="account-profile__info">
                <b>{account.personaName}</b>
                <span>Steam ID {account.steamId} · 登录于 {new Date(account.loggedInAt).toLocaleString("zh-CN")}</span>
              </div>
              <button type="button" className="btn btn--sm" onClick={() => void onLogout()}>
                <LogOut size={13} /> 退出登录
              </button>
            </div>
            {hintForPrivacy(account) && <p className="hint hint--error">{hintForPrivacy(account)}</p>}
            <p className="hint">
              游戏库与愿望单入口在顶栏（排序按钮左侧）；刷新列表会同时更新卡片上的「已收藏 / 购物车」标记。
              应用只保存 Steam ID，不保存账号密码。
            </p>
          </>
        ) : (
          <>
            <p className="hint">
              点击「登录 Steam」会在应用内打开 Steam 官方登录页，应用只保存你的 Steam ID，不会接触账号密码。
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
          </>
        )}
      </section>
    </div>
  );
}
