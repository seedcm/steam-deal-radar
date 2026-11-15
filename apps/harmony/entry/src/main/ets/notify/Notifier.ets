/**
 * 系统通知。
 * 通知 id 使用 appId；点击通知通过 WantAgent 拉起 EntryAbility。
 * 首次启动时由 EntryAbility 在页面加载完成后调用 ensureEnabled() 申请通知授权。
 */

import notificationManager from '@ohos.notificationManager';
import wantAgent, { WantAgent } from '@ohos.app.ability.wantAgent';
import Want from '@ohos.app.ability.Want';
import common from '@ohos.app.ability.common';
import { BusinessError } from '@ohos.base';
import { AppNotification, BUNDLE_NAME } from '../data/Types';

export class Notifier {
  /**
   * 没有通知权限时拉起系统授权弹窗。
   * 注意：requestEnableNotification 必须在 loadContent 成功之后调用，否则会报错。
   */
  static async ensureEnabled(context: common.UIAbilityContext): Promise<boolean> {
    try {
      const enabled = await notificationManager.isNotificationEnabled();
      if (enabled) {
        return true;
      }
      await notificationManager.requestEnableNotification(context);
      console.info('[radar] 已申请通知权限');
      return true;
    } catch (err) {
      const error = err as BusinessError;
      console.warn(`[radar] 申请通知权限失败: code=${error.code} message=${error.message}`);
      return false;
    }
  }

  /** 发布一条系统通知；标题/正文与 core/store.ts 的 buildNotification 一致 */
  async publish(notification: AppNotification): Promise<void> {
    try {
      let agent: WantAgent | undefined = undefined;
      try {
        const want: Want = {
          bundleName: BUNDLE_NAME,
          abilityName: 'EntryAbility'
        };
        const info: wantAgent.WantAgentInfo = {
          wants: [want],
          actionType: wantAgent.OperationType.START_ABILITY,
          requestCode: 0,
          actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
        };
        agent = await wantAgent.getWantAgent(info);
      } catch (agentError) {
        // 拿不到 WantAgent 不影响通知本身，只是点击后无法自动拉起应用
        const error = agentError as BusinessError;
        console.warn(`[radar] 创建 WantAgent 失败: ${error.message}`);
      }

      const request: notificationManager.NotificationRequest = {
        id: notification.appId,
        content: {
          notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: {
            title: notification.title,
            text: notification.body
          }
        }
      };
      if (agent !== undefined) {
        request.wantAgent = agent;
      }
      await notificationManager.publish(request);
      console.info(`[radar] 已发送通知 appId=${notification.appId} title=${notification.title}`);
    } catch (err) {
      const error = err as BusinessError;
      console.warn(`[radar] 发送通知失败: code=${error.code} message=${error.message}`);
    }
  }

  /** 用户取消关注时清掉对应通知（可选能力，失败忽略） */
  async cancel(appId: number): Promise<void> {
    try {
      await notificationManager.cancel(appId, '');
    } catch (err) {
      const error = err as BusinessError;
      console.warn(`[radar] 取消通知失败: code=${error.code} message=${error.message}`);
    }
  }
}
