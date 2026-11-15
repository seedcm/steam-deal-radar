import { useCallback, useEffect, useRef, useState } from "react";
import type { AppInfo, Deal, Snapshot, UpdateStatus } from "@radar/core";
import { api } from "../lib/client";
import { onEvent } from "../lib/bridge";

export interface ToastItem {
  id: number;
  message: string;
  tone: "info" | "error" | "success";
}

export type ToastFn = (message: string, tone?: ToastItem["tone"]) => void;

const TOAST_TTL = 4200;

export function useRadar() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [booting, setBooting] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [update, setUpdate] = useState<UpdateStatus>({ phase: "idle" });
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const toast = useCallback<ToastFn>((message, tone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), TOAST_TTL);
  }, []);

  const sync = useCallback(async () => {
    const next = await api.snapshot();
    setSnapshot(next);
    return next;
  }, []);

  const refresh = useCallback(
    async (manual = false) => {
      setRefreshing(true);
      try {
        const result = await api.refresh();
        const next = await api.snapshot();
        setSnapshot(next);
        if (!result.ok) {
          toast(result.error ?? "更新失败，先看看上次的数据吧", "error");
        } else if (manual) {
          const extra = result.newLowCount > 0 ? `，其中 ${result.newLowCount} 个刷新了史低` : "";
          toast(`已更新 ${result.dealCount} 个折扣${extra}`, "success");
        }
      } catch (error) {
        toast(error instanceof Error ? error.message : "更新失败", "error");
      } finally {
        setRefreshing(false);
      }
    },
    [toast],
  );

  refreshRef.current = () => refresh(false);

  useEffect(() => {
    let alive = true;
    api
      .appInfo()
      .then((info) => alive && setAppInfo(info))
      .catch(() => {});

    api
      .snapshot()
      .then((next) => {
        if (!alive) return;
        setSnapshot(next);
        setBooting(false);
        const stale =
          !next.meta.lastRefreshAt || Date.now() - next.meta.lastRefreshAt > next.settings.refreshMinutes * 60_000;
        if (stale || next.meta.dealCount === 0) void refreshRef.current();
      })
      .catch((error) => {
        if (!alive) return;
        setBooting(false);
        toast(error instanceof Error ? error.message : "读取本地数据失败", "error");
      });

    const off = onEvent((event) => {
      if (event.type === "snapshot") setSnapshot(event.snapshot);
      if (event.type === "refreshing") setRefreshing(event.value);
      if (event.type === "update") setUpdate(event.status);
      if (event.type === "toast") toast(event.message, event.tone);
      if (event.type === "notification") toast(`${event.notification.title} · ${event.notification.body}`, "info");
    });

    return () => {
      alive = false;
      off();
    };
  }, [toast]);

  const toggleWatch = useCallback(
    async (deal: Pick<Deal, "appId" | "name" | "image">) => {
      const watched = snapshot?.watchlist.some((item) => item.appId === deal.appId);
      try {
        if (watched) {
          await api.unwatch(deal.appId);
          toast("已取消关注");
        } else {
          await api.watch({ appId: deal.appId, name: deal.name, image: deal.image });
          toast("已加入关注，打折时会提醒你", "success");
        }
        await sync();
      } catch (error) {
        toast(error instanceof Error ? error.message : "操作失败", "error");
      }
    },
    [snapshot?.watchlist, sync, toast],
  );

  const updateWatch = useCallback(
    async (appId: number, patch: Record<string, unknown>) => {
      try {
        await api.updateWatch(appId, patch as never);
        await sync();
      } catch (error) {
        toast(error instanceof Error ? error.message : "保存失败", "error");
      }
    },
    [sync, toast],
  );

  const updateSettings = useCallback(
    async (patch: Parameters<typeof api.updateSettings>[0]) => {
      try {
        await api.updateSettings(patch);
        await sync();
      } catch (error) {
        toast(error instanceof Error ? error.message : "保存设置失败", "error");
      }
    },
    [sync, toast],
  );

  const checkUpdate = useCallback(async () => {
    try {
      const status = await api.checkUpdate();
      setUpdate(status);
      if (status.phase === "none") toast("已是最新版本", "success");
      if (status.phase === "error") toast(status.message ?? "检查更新失败", "error");
      if (status.phase === "unsupported") toast("当前平台由应用商店负责更新", "info");
      return status;
    } catch (error) {
      toast(error instanceof Error ? error.message : "检查更新失败", "error");
      return { phase: "error" } satisfies UpdateStatus;
    }
  }, [toast]);

  const exportData = useCallback(async () => {
    try {
      const json = await api.exportData();
      await api.copyText(json);
      toast("数据已复制到剪贴板，可粘贴保存为 .json", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "复制失败，请检查剪贴板权限", "error");
    }
  }, [toast]);

  const importData = useCallback(
    async (json: string) => {
      await api.importData(json);
      await sync();
      toast("数据已导入", "success");
    },
    [sync, toast],
  );

  return {
    snapshot,
    booting,
    refreshing,
    toasts,
    update,
    appInfo,
    toast,
    refresh,
    toggleWatch,
    updateWatch,
    updateSettings,
    checkUpdate,
    exportData,
    importData,
    sync,
  };
}
