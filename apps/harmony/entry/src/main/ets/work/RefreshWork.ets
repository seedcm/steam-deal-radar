/**
 * 后台周期刷新：WorkSchedulerExtensionAbility。
 *
 * - 注册的循环间隔取 max(20, settings.refreshMinutes) 分钟（系统允许的最小粒度是 20 分钟）；
 * - 系统会按应用活跃度 / 电量 / 网络情况调度，实际触发时间并不精确；
 * - 单次回调最长运行约 2 分钟，因此复用与前台相同的引擎，但把 UI 事件接到空实现上。
 */

import WorkSchedulerExtensionAbility from '@ohos.WorkSchedulerExtensionAbility';
import workScheduler from '@ohos.resourceschedule.workScheduler';
import { BusinessError } from '@ohos.base';
import { RadarEngine } from '../data/RadarEngine';
import { StateStore } from '../data/StateStore';
import { SteamClient } from '../data/SteamClient';
import { APP_VERSION, BUNDLE_NAME, EventSink } from '../data/Types';
import { Notifier } from '../notify/Notifier';

/** 延迟任务 id，与 EntryAbility 注册时保持一致 */
export const REFRESH_WORK_ID: number = 1001;
/** 扩展 Ability 名称，必须与 module.json5 的 extensionAbilities.name 一致 */
const WORK_ABILITY_NAME: string = 'RefreshWork';
/** WorkScheduler 的最小循环间隔（分钟） */
const MIN_REPEAT_MINUTES: number = 20;

function buildWorkInfo(refreshMinutes: number): workScheduler.WorkInfo {
  const minutes = Math.max(MIN_REPEAT_MINUTES, Math.floor(refreshMinutes));
  const workInfo: workScheduler.WorkInfo = {
    workId: REFRESH_WORK_ID,
    bundleName: BUNDLE_NAME,
    abilityName: WORK_ABILITY_NAME,
    isRepeat: true,
    repeatCycleTime: minutes * 60_000,
    networkType: workScheduler.NetworkType.NETWORK_TYPE_ANY,
    isPersisted: true
  };
  return workInfo;
}

/**
 * 重新注册后台刷新任务。
 * 先 stopWork 再 startWork，确保修改刷新间隔后立即生效；
 * 首次注册时 stopWork 会因为没有旧任务而抛错，直接忽略。
 */
export function scheduleBackgroundRefresh(refreshMinutes: number): void {
  const workInfo = buildWorkInfo(refreshMinutes);
  try {
    workScheduler.stopWork(workInfo, true);
  } catch (stopError) {
    // 没有旧任务属于正常情况
  }
  try {
    workScheduler.startWork(workInfo);
    const minutes = Math.max(MIN_REPEAT_MINUTES, Math.floor(refreshMinutes));
    console.info(`[radar] 已注册后台刷新任务，间隔 ${minutes} 分钟`);
  } catch (err) {
    const error = err as BusinessError;
    console.error(`[radar] 注册后台刷新任务失败: code=${error.code} message=${error.message}`);
  }
}

/** 取消后台刷新任务（当前流程未调用，保留给以后做「暂停自动刷新」） */
export function cancelBackgroundRefresh(): void {
  try {
    workScheduler.stopWork(buildWorkInfo(MIN_REPEAT_MINUTES), true);
    console.info('[radar] 已取消后台刷新任务');
  } catch (err) {
    const error = err as BusinessError;
    console.warn(`[radar] 取消后台刷新任务失败: code=${error.code} message=${error.message}`);
  }
}

export default class RefreshWork extends WorkSchedulerExtensionAbility {
  onWorkStart(work: workScheduler.WorkInfo): void {
    console.info(`[radar] 后台刷新开始 workId=${work.workId} bundle=${work.bundleName}`);
    this.runRefresh().catch((err: Object): void => {
      const error = err as BusinessError;
      console.error(`[radar] 后台刷新失败: message=${error.message}`);
    });
  }

  onWorkStop(work: workScheduler.WorkInfo): void {
    console.info(`[radar] 后台刷新结束 workId=${work.workId}`);
  }

  private async runRefresh(): Promise<void> {
    const store = new StateStore(this.context);
    // 后台没有 WebView，事件推送接空实现；通知由 Notifier 直接发系统通知
    const sink: EventSink = (): void => {};
    const engine = new RadarEngine(store, new SteamClient(), new Notifier(), APP_VERSION, sink);
    await engine.init();
    const result = await engine.refresh();
    console.info(`[radar] 后台刷新完成 ok=${result.ok} dealCount=${result.dealCount}`);
  }
}
